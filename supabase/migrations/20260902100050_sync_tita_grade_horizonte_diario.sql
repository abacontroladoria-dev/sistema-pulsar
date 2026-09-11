-- O horizonte da grade da TiTa não pode avançar só na segunda-feira.
--
-- Sintoma (02/09/2026, Ocupação de Paciente): "Confirmar implantação" de uma
-- terapia nova falhava com "Este horário ainda não está disponível para
-- implantação. Aguarde alguns minutos e tente novamente. (1/1 sessões
-- afetadas)" — para um horário genuinamente livre. Esperar "alguns minutos",
-- como a mensagem manda, nunca resolveria: faltavam até 6 dias.
--
-- É a MESMA falha de 20260805150000, por outro caminho. Aquela migration
-- corrigiu a FÓRMULA do horizonte (as duas fontes passaram a mirar "hoje → fim
-- do mês seguinte"). O que ficou de fora foi a CADÊNCIA:
--
--   sync-grade-csv-daily      → DIÁRIO. csv_grades_profissionais, de onde
--                               buildSugestoes() tira as sugestões, alcançava
--                               30/10 em 02/09.
--   sync-tita-grade-semanal   → '35 6 * * 1', SEGUNDA. grade_profissionais_tita,
--                               de onde resolverGradeTerapeuta tira o
--                               id_grade_terapeuta, parava em 30/09.
--
-- A última execução de horizonte completo foi 31/08, quando "fim do mês
-- seguinte" ainda era 30/09. Em 01/09 a fórmula passou a valer 31/10, mas
-- ninguém a reexecutou — o próximo disparo era 08/09, 06:35. Medido em produção
-- em 02/09: 2026-09-30 tinha 868 linhas na grade da TiTa contra 903 no CSV; a
-- partir de 2026-10-01, ZERO contra 855.
--
-- Toda sugestão de outubro caía então em id_grade_terapeuta_nao_encontrado. A
-- janela de quebra é estrutural, não um azar deste mês: do dia 1º até a primeira
-- segunda-feira, TODO mês, o mês seguinte inteiro fica inimplantável — até 6
-- dias por mês, calados, porque a tela sugere o horário e só a confirmação falha.
--
-- Correção: a cadência do horizonte completo passa a ser DIÁRIA, igual à da
-- fonte que alimenta as sugestões. Não é um sync mais pesado por dia útil — é o
-- mesmo trabalho que já rodava, agora com a periodicidade da fonte com que ele
-- precisa concordar. O laço de 7 em 7 dias (20260805150000) continua sendo o que
-- impede o timeout da Edge Function, e o upsert por
-- (grade_terapeuta_id, data, hora_inicial) torna a reexecução inofensiva.
--
-- Horário: 06:20, quinze minutos antes do 06:35 que a versão semanal usava, para
-- não concorrer com o sync-tita-grade-diario das 07:05 nem com quem chega.
--
-- fn_sync_tita_grade() e fn_sync_tita_grade_hoje() NÃO mudam de corpo — o que
-- muda é quando a primeira roda.

SELECT cron.unschedule('sync-tita-grade-semanal')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-tita-grade-semanal');

SELECT cron.schedule(
  'sync-tita-grade-horizonte-diario',
  '20 6 * * *',
  'SELECT public.fn_sync_tita_grade()'
);

-- Fecha a lacuna de agora (01/10–31/10) sem esperar o primeiro disparo de
-- amanhã: é o mesmo motivo do backfill no fim de 20260805150000.
--
-- Só roda onde há o segredo no Vault, isto é, em produção. Num banco novo
-- (reset local, CI) `fn_sync_tita_grade` estoura com "segredo
-- cron_service_role_key ausente" e trava as migrations seguintes — e mesmo que
-- não estourasse, disparar um sync real contra a TiTa a partir de um banco
-- local não é o que se quer. O cron agendado acima continua idêntico.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'cron_service_role_key') THEN
    PERFORM public.fn_sync_tita_grade();
  ELSE
    RAISE NOTICE 'cron_service_role_key ausente; backfill de fn_sync_tita_grade pulado neste banco';
  END IF;
END
$$;
