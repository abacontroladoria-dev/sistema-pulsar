-- =============================================================================
-- get_faltas_auditoria_assim devolve o id da fila e some com a adiantada
-- =============================================================================
-- Duas mudanças, ambas exigidas por 20260916120000.
--
--   1. `fila_id`. A tela monta o cartão de falta como bloco sintético
--      (`falta_<paciente>_<data>_<hora>_<tuss>`, auditoria-assim.service.ts:38),
--      que não tem contraparte no banco. Para chamar marcar_sessao_adiantada o
--      frontend precisa da linha exata. Resolver por (paciente, data, horário,
--      tuss) no cliente é como nascem as divergências — a RPC já sabe qual linha
--      é, então ela devolve.
--
--   2. `AND f.data_atendimento_real IS NULL`. Sem isto a sessão adiantada
--      apareceria DUAS vezes na grade: como cartão de falta (por esta RPC) e como
--      bloco real (por get_auditoria_assim_periodo, que 20260916120200 ensinou a
--      trazê-la de volta). O operador veria a mesma sessão em dois estados
--      contraditórios no mesmo horário.
--
-- Corpo idêntico a 20260819100000:246-280 no resto. DROP antes do CREATE porque a
-- assinatura de retorno muda (coluna nova); CREATE OR REPLACE recusaria.
-- =============================================================================

drop function if exists public.get_faltas_auditoria_assim(date);

CREATE OR REPLACE FUNCTION public.get_faltas_auditoria_assim(p_data date)
 RETURNS TABLE(fila_id uuid, paciente_id text, paciente_nome text, data_atendimento date, hora_inicial time without time zone, tuss text, terapia_nome text, tipo_falta text, profissional_nome text)
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
       AND at2.hora_inicial = f.horario) AS profissional_nome
  FROM public.fila_autorizacoes f
  WHERE f.data_atendimento = p_data
    AND (f.tipo_falta ILIKE '%paciente%' OR f.tipo_falta ILIKE '%terapeuta%')
    -- Sessão adiantada já voltou como bloco real na Conferência; se continuasse
    -- aqui, a grade mostraria a mesma sessão duas vezes, em estados opostos.
    AND f.data_atendimento_real IS NULL
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
$function$
;

comment on function public.get_faltas_auditoria_assim(date) is
  'Faltas do dia na Conferência ASSIM. Devolve fila_id para que a tela possa marcar a sessão como adiantada (20260916120000). Sessão com data_atendimento_real não aparece aqui: ela já volta como bloco real.';

GRANT EXECUTE ON FUNCTION public.get_faltas_auditoria_assim(date) TO anon, authenticated;
