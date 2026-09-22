-- =============================================================================
-- APLICAR NO SQL EDITOR — copia de
-- supabase/migrations/20260922230000_substituicao_sai_das_faltas.sql
--
-- Este e o conserto que faltava para o card "Falta Terapeuta" da aba Auditoria.
-- 20260922220000 (ja aplicada) corrigiu a fonte das SESSOES; o card vem da
-- outra fonte, a das FALTAS, que e esta funcao.
--
-- Rodar inteiro. Depende do tipo 'substituicao' (20260922210000, ja aplicada).
--
-- CONFERIR DEPOIS, em /auditoria-assim/?tab=auditoria no dia 21/09:
--   "Falta Terapeuta" deve cair em 1 e o TOTAL subir em 1 -- a sessao do Joao
--   Lucas deixa de ser falta e passa a contar como realizada.
--
-- Query equivalente, sem abrir a tela:
--   SELECT count(*) FROM public.get_faltas_auditoria_assim('2026-09-21')
--   WHERE tipo_falta ILIKE '%terapeuta%';
--   -- deve devolver um a menos do que antes
-- =============================================================================


-- =============================================================================
-- O card "Falta Terapeuta" tem OUTRA fonte -- e era ela o tempo todo
-- =============================================================================
--
-- 20260922220000 ensinou `substituicao` a get_auditoria_assim_periodo e o card
-- continuou marcando 1. O motivo: a aba Auditoria tem DUAS fontes, e o card de
-- falta vem da que eu nao havia tocado.
--
--   get_auditoria_assim_periodo -> as SESSOES (que existem na agenda)
--   get_faltas_auditoria_assim  -> as FALTAS (sintetizadas da fila)
--
-- O anti-join `agenda_sem_falta` tira a falta da primeira, entao a segunda e a
-- unica que a produz. Ela le `fila_autorizacoes` direto e nunca consultou
-- `autorizacoes_vinculos`: toda linha com `tipo_falta = 'terapeuta'` virava
-- FALTA_TERAPEUTA, houvesse substituto ou nao.
--
-- O cliente so repassa: auditoria-assim.service.ts:65 carimba a situacao a
-- partir de `tipo_falta`, e `acumularKpis` conta pela situacao. Nenhum dos dois
-- tem como saber do vinculo -- o dado nao chega ali.
--
-- POR QUE O DEFEITO SOBREVIVEU A DUAS CORRECOES
-- Porque as duas anteriores foram nos leitores que EU encontrei procurando por
-- `tipo = 'vinculo'`. Esta funcao nao aparecia nessa busca justamente por nao
-- filtrar tipo nenhum: ela nao le a tabela. Procurar pelo predicado achou os
-- leitores que ja sabiam da tabela, e nao o que precisava passar a saber.
--
-- O QUE MUDA
-- Uma clausula: a falta com triagem `substituicao` ativa sai do resultado. Ela
-- ja volta pela outra fonte como LIBERADA (20260922220000), entao mante-la aqui
-- faria a MESMA sessao aparecer duas vezes, em estados opostos -- o mesmo
-- defeito que o filtro de `data_atendimento_real` logo acima ja previne para a
-- sessao adiantada.
--
-- `falta_terapeuta` continua saindo normalmente: ali ninguem assumiu.
-- =============================================================================


CREATE OR REPLACE FUNCTION public.get_faltas_auditoria_assim(p_data date)
 RETURNS TABLE(fila_id uuid, paciente_id text, paciente_nome text, data_atendimento date, hora_inicial time without time zone, tuss text, terapia_nome text, tipo_falta text, profissional_nome text, motivo_falta text, justificativa_falta text)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    f.id AS fila_id,
    f.paciente_id::text,
    f.paciente_nome,
    f.data_atendimento,
    f.horario AS hora_inicial,
    f.tuss,
    f.terapia_nome,
    f.tipo_falta,
    (SELECT string_agg(DISTINCT at2.profissional_nome, ' | ' ORDER BY at2.profissional_nome)
     FROM public.agenda_tita at2
     WHERE at2.paciente_id = f.paciente_id::bigint
       AND at2.data_atendimento = f.data_atendimento
       AND at2.hora_inicial = f.horario) AS profissional_nome,
    -- O que a recepcao escreveu ao registrar a falta.
    f.motivo_falta,
    f.justificativa_falta
  FROM public.fila_autorizacoes f
  WHERE f.data_atendimento = p_data
    AND (f.tipo_falta ILIKE '%paciente%' OR f.tipo_falta ILIKE '%terapeuta%')
    -- Sessão adiantada já voltou como bloco real na Conferência; se continuasse
    -- aqui, a grade mostraria a mesma sessão duas vezes, em estados opostos.
    AND f.data_atendimento_real IS NULL
    -- A FALTA COM SUBSTITUTO NAO E FALTA NESTA TELA (2026-09-22).
    --
    -- Esta RPC e a SEGUNDA fonte da aba Auditoria: ela sintetiza as linhas de
    -- falta direto da fila, sem passar por get_auditoria_assim_periodo. Por
    -- isso 20260922220000 -- que ensinou `substituicao` aquela funcao -- nao
    -- resolveu o card "Falta Terapeuta": o numero vem DAQUI.
    --
    -- Quando a triagem afirma que houve substituto, a sessao ACONTECEU e ja
    -- volta pela outra fonte como LIBERADA. Mante-la aqui faria a mesma sessao
    -- aparecer duas vezes na tela, em estados opostos -- o mesmo defeito que o
    -- filtro de `data_atendimento_real` logo acima existe para impedir.
    --
    -- So `substituicao` sai. `falta_terapeuta` continua: ali ninguem assumiu, a
    -- sessao nao aconteceu, e o card de falta esta certo em conta-la.
    --
    -- A falta do titular segue registrada em fila_autorizacoes, intacta: o que
    -- muda e o que a AUDITORIA conta, nao o que a recepcao lancou.
    AND NOT EXISTS (
      SELECT 1 FROM public.autorizacoes_vinculos v
      WHERE v.fila_id = f.id
        AND v.desfeito_em IS NULL
        AND v.tipo = 'substituicao'
    )
    AND f.terapia_nome NOT ILIKE '%Equoterapia%'
    AND f.terapia_nome NOT ILIKE '%Fisioterapia Aquática%'
    AND f.terapia_nome NOT ILIKE '%Avaliação Neuropsicológica%'
    AND NOT EXISTS (
      SELECT 1 FROM public.agenda_tita at
      JOIN public.config_regras_terapias r
        ON at.terapia_nome ILIKE ('%' || r.terapia_nome || '%')
      WHERE r.categoria = 'BLACKLIST_AUTORIZACAO' AND r.ativo = true
        AND at.paciente_id = f.paciente_id::bigint
        AND at.data_atendimento = f.data_atendimento
        AND at.hora_inicial = f.horario
    )
$function$;


COMMENT ON FUNCTION public.get_faltas_auditoria_assim(date) IS
  'As faltas de paciente e de terapeuta de um dia, sintetizadas da fila para a Conferencia ASSIM. A falta triada como `substituicao` NAO sai aqui (20260922230000): a sessao aconteceu com outro profissional e ja volta como LIBERADA por get_auditoria_assim_periodo. A falta do titular continua registrada em fila_autorizacoes.';
