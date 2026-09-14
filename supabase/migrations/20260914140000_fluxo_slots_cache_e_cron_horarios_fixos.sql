-- Alivia o banco na home (`/`): cron dos KPIs em horarios fixos + gráfico do Fluxo real.
--
-- Contexto (dois problemas distintos, mesma tela):
--
-- 1) O cron `refresh-dashboard-kpis` (criado em 20260708010000) roda a cada 30 min,
--    15h/dia, 7 dias/semana — ~210 execucoes/semana do calculo pesado sobre a
--    grade_profissionais_tita, inclusive de madrugada e no fim de semana, quando
--    ninguem abre o dashboard. Passa a rodar as 08:30/10:30/12:30/14:30/16:30 BRT,
--    seg-sex: 25 execucoes/semana (-88%). O caminho do usuario nao muda — o front
--    ja le uma tabela-cache de 4 linhas.
--
-- 2) O grafico do card "Fluxo Operacional do Dia" era MOCKADO: o front setava
--    slotData = [] e o componente caia no fallback FLUXO_MOCK_DATA (13 barras
--    hardcoded em data.ts). Havia numero inventado em producao. Aqui damos a ele
--    uma fonte real pelo mesmo desenho da 20260708010000: o cron calcula, o
--    usuario le. O custo marginal para quem abre a home e' um SELECT em 13 linhas.
--    Em troca, o seletor Semana/Mes do card sai do front — ele varria a
--    vw_central_autorizacoes com paginacao sequencial e sem teto.

-- ============================================================================
-- 1. Tabela-cache dos slots do dia. RLS ligada SEM policy: apenas as funcoes
--    SECURITY DEFINER (owner = postgres) leem/escrevem, bypassando RLS.
--    Mesmo padrao de public.dashboard_kpis_cache.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.fluxo_slots_cache (
  slot          text PRIMARY KEY,
  realengo      bigint      NOT NULL DEFAULT 0,
  fazendinha    bigint      NOT NULL DEFAULT 0,
  padre_miguel  bigint      NOT NULL DEFAULT 0,
  refreshed_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fluxo_slots_cache ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. refresh_dashboard_kpis(): mesma logica dos 4 KPIs (identica a 20260708010000,
--    para preservar exatamente os mesmos numeros), agora tambem gravando a
--    distribuicao por slot na fluxo_slots_cache.
--
--    O CTE `slots` e' o CTE `atend` com GROUP BY hora_inicial: mesma populacao
--    (mesmo filtro de status e mesma blacklist), so que aberta por horario —
--    logo a soma dos slots bate com o KPI "Atendimentos Previstos Hoje".
--    A coluna e' `hora_inicial` (time), nao `horario`.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.refresh_dashboard_kpis()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
BEGIN
  WITH
  blacklist_names AS (
    SELECT crt.terapia_nome
    FROM config_regras_terapias crt
    WHERE crt.categoria = 'BLACKLIST_AUTORIZACAO' AND crt.ativo = true
  ),
  blacklisted AS (
    SELECT DISTINCT gpt.id
    FROM grade_profissionais_tita gpt
    JOIN blacklist_names bl ON gpt.nome_terapia ILIKE ('%' || bl.terapia_nome || '%')
  ),
  target_date AS (
    SELECT COALESCE(MIN(gpt2.data), CURRENT_DATE) AS dt
    FROM grade_profissionais_tita gpt2
    WHERE gpt2.data >= CURRENT_DATE
  ),
  atend AS (
    SELECT
      COUNT(*) FILTER (WHERE gpt.sala ILIKE '%Realengo%')     AS realengo,
      COUNT(*) FILTER (WHERE gpt.sala ILIKE '%Fazendinha%')   AS fazendinha,
      COUNT(*) FILTER (WHERE gpt.sala ILIKE '%Padre Miguel%') AS "padreMiguel",
      COUNT(*)                                                 AS total
    FROM grade_profissionais_tita gpt
    CROSS JOIN target_date td
    WHERE gpt.data = td.dt
      AND gpt.status_agendamento <> 'Livre'
      AND gpt.id NOT IN (SELECT id FROM blacklisted)
  ),
  faltas AS (
    SELECT
      COUNT(DISTINCT fa.paciente_nome) FILTER (WHERE COALESCE(a.sala_nome, '') ILIKE '%Realengo%')     AS realengo,
      COUNT(DISTINCT fa.paciente_nome) FILTER (WHERE COALESCE(a.sala_nome, '') ILIKE '%Fazendinha%')   AS fazendinha,
      COUNT(DISTINCT fa.paciente_nome) FILTER (WHERE COALESCE(a.sala_nome, '') ILIKE '%Padre Miguel%') AS "padreMiguel",
      COUNT(DISTINCT fa.paciente_nome)                                                                  AS total
    FROM fila_autorizacoes fa
    LEFT JOIN agenda_tita a ON a.tita_agendamento_id = fa.tita_agendamento_id AND a.ativo = true
    WHERE fa.data_atendimento = CURRENT_DATE
      AND fa.tipo_falta = 'paciente'
  ),
  terapeutas AS (
    SELECT
      COUNT(DISTINCT gpt.nome_profissional) FILTER (WHERE gpt.sala ILIKE '%Realengo%')     AS realengo,
      COUNT(DISTINCT gpt.nome_profissional) FILTER (WHERE gpt.sala ILIKE '%Fazendinha%')   AS fazendinha,
      COUNT(DISTINCT gpt.nome_profissional) FILTER (WHERE gpt.sala ILIKE '%Padre Miguel%') AS "padreMiguel",
      COUNT(DISTINCT gpt.nome_profissional)                                                AS total
    FROM grade_profissionais_tita gpt
    CROSS JOIN target_date td
    WHERE gpt.data = td.dt
      AND gpt.status_agendamento = 'Agendado'
  ),
  indisponiveis AS (
    SELECT
      COUNT(DISTINCT a.profissional_id) FILTER (WHERE a.sala_nome ILIKE '%Realengo%')     AS realengo,
      COUNT(DISTINCT a.profissional_id) FILTER (WHERE a.sala_nome ILIKE '%Fazendinha%')   AS fazendinha,
      COUNT(DISTINCT a.profissional_id) FILTER (WHERE a.sala_nome ILIKE '%Padre Miguel%') AS "padreMiguel",
      COUNT(DISTINCT a.profissional_id)                                                    AS total
    FROM controle_terapeutico ct
    JOIN agenda_tita a ON a.tita_agendamento_id = ct.tita_agendamento_id AND a.ativo = true
    WHERE ct.data_atendimento = CURRENT_DATE
      AND ct.status = 'indisponivel'
  ),
  computed AS (
    SELECT 'kpi_atendimentos'::text AS metric_type, atend.realengo, atend.fazendinha, atend."padreMiguel", atend.total FROM atend
    UNION ALL
    SELECT 'kpi_faltas'::text, faltas.realengo, faltas.fazendinha, faltas."padreMiguel", faltas.total FROM faltas
    UNION ALL
    SELECT 'kpi_terapeutas'::text, terapeutas.realengo, terapeutas.fazendinha, terapeutas."padreMiguel", terapeutas.total FROM terapeutas
    UNION ALL
    SELECT 'kpi_terapeutas_indisponiveis'::text, indisponiveis.realengo, indisponiveis.fazendinha, indisponiveis."padreMiguel", indisponiveis.total FROM indisponiveis
  )
  INSERT INTO public.dashboard_kpis_cache (metric_type, realengo, fazendinha, padre_miguel, total, refreshed_at)
  SELECT metric_type, realengo, fazendinha, "padreMiguel", total, now()
  FROM computed
  ON CONFLICT (metric_type) DO UPDATE
    SET realengo     = EXCLUDED.realengo,
        fazendinha   = EXCLUDED.fazendinha,
        padre_miguel = EXCLUDED.padre_miguel,
        total        = EXCLUDED.total,
        refreshed_at = EXCLUDED.refreshed_at;

  -- Slots do dia. DELETE + INSERT (e nao UPSERT): um slot que existia ontem e
  -- nao existe hoje precisa DESAPARECER, senao ficaria congelado na tela.
  DELETE FROM public.fluxo_slots_cache;

  WITH
  blacklist_names AS (
    SELECT crt.terapia_nome
    FROM config_regras_terapias crt
    WHERE crt.categoria = 'BLACKLIST_AUTORIZACAO' AND crt.ativo = true
  ),
  blacklisted AS (
    SELECT DISTINCT gpt.id
    FROM grade_profissionais_tita gpt
    JOIN blacklist_names bl ON gpt.nome_terapia ILIKE ('%' || bl.terapia_nome || '%')
  ),
  target_date AS (
    SELECT COALESCE(MIN(gpt2.data), CURRENT_DATE) AS dt
    FROM grade_profissionais_tita gpt2
    WHERE gpt2.data >= CURRENT_DATE
  )
  INSERT INTO public.fluxo_slots_cache (slot, realengo, fazendinha, padre_miguel, refreshed_at)
  SELECT
    to_char(gpt.hora_inicial, 'HH24:MI')                    AS slot,
    COUNT(*) FILTER (WHERE gpt.sala ILIKE '%Realengo%')     AS realengo,
    COUNT(*) FILTER (WHERE gpt.sala ILIKE '%Fazendinha%')   AS fazendinha,
    COUNT(*) FILTER (WHERE gpt.sala ILIKE '%Padre Miguel%') AS padre_miguel,
    now()
  FROM grade_profissionais_tita gpt
  CROSS JOIN target_date td
  WHERE gpt.data = td.dt
    AND gpt.status_agendamento <> 'Livre'
    AND gpt.id NOT IN (SELECT id FROM blacklisted)
  GROUP BY 1;
END;
$$;

-- ============================================================================
-- 3. get_fluxo_slots(): SELECT trivial na cache. "padreMiguel" quoted para casar
--    com o tipo FluxoSlotPoint do front, como faz get_dashboard_kpis().
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_fluxo_slots();

CREATE FUNCTION public.get_fluxo_slots()
RETURNS TABLE (
  slot          text,
  realengo      bigint,
  fazendinha    bigint,
  "padreMiguel" bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.slot, c.realengo, c.fazendinha, c.padre_miguel
  FROM public.fluxo_slots_cache c
  ORDER BY c.slot;
$$;

GRANT EXECUTE ON FUNCTION public.get_fluxo_slots() TO anon, authenticated;

-- ============================================================================
-- 4. Semeia a cache e reagenda o cron para os 5 horarios fixos, seg-sex.
--    O cron do Supabase e' UTC; BRT = UTC-3, entao 11,13,15,17,19 UTC =
--    08:30/10:30/12:30/14:30/16:30 BRT.
-- ============================================================================
SELECT public.refresh_dashboard_kpis();

DO $$
BEGIN
  PERFORM cron.unschedule('refresh-dashboard-kpis');
  EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;

SELECT cron.schedule(
  'refresh-dashboard-kpis',
  '30 11,13,15,17,19 * * 1-5',
  'SELECT public.refresh_dashboard_kpis()'
);
