-- =============================================================================
-- get_tokens_mensal: tuss_da_sessao só depois do join com os vínculos.
--
-- 20260925140000 pôs paciente+data do bloco_id na condição do join, mas não
-- adiantou (~11 s continuaram). O EXPLAIN ANALYZE de 25/09 mostrou por quê:
--   - o planner fez hash join com a AGENDA (40.294 linhas ASSIM ativas) do lado
--     do hash, e a chave do hash inclui o concat_ws(... tuss_da_sessao ...) —
--     a função rodou para todas as linhas mesmo assim (~4,7 s);
--   - o `WHERE codigo_tuss IS NOT NULL` do UNION em `chaves` foi empurrado para
--     dentro da varredura da agenda, outra chamada por linha (~5,1 s).
-- `chaves_vinculo` sozinha: 9,8 s dos 15 s do plano.
--
-- CORREÇÃO: CTE MATERIALIZED `vinculo_agenda` casa agenda × vínculos do mês só
-- por paciente e data (texto, sem função). CTE materializada é barreira: nem o
-- filtro de fora entra nela nem a função é avaliada lá dentro. `chaves_vinculo`
-- aplica a igualdade do bloco_id (a mesma de antes) sobre essas poucas linhas.
-- Resultado idêntico: paciente e data já estão contidos no bloco_id.
--
-- TÉCNICA: corte por posição sobre pg_get_functiondef, de `chaves_vinculo AS (`
-- até `-- Semente 4:` (cada um conferido 1x). Mantém os SET de proconfig.
-- =============================================================================

set lock_timeout = '5s';

DO $migr$
DECLARE
  v_def   text;
  v_ini   int;
  v_fim   int;
  c_ini   constant text := 'chaves_vinculo AS (';
  c_fim   constant text := '-- Semente 4:';
  v_novo  constant text := $novo$vinculo_agenda AS MATERIALIZED (
    -- 20260925150000: casa agenda × vínculos do mês só por paciente e data,
    -- sem função. MATERIALIZED é a barreira que impede o planner de avaliar
    -- tuss_da_sessao na agenda inteira (era 9,8 s dos 11 s da RPC).
    SELECT at.numero_carteirinha, at.data_atendimento, at.hora_inicial,
           at.paciente_id, at.terapia_exibicao_nome, at.terapia_id,
           at.terapia_nome, vm.bloco_id
    FROM agenda_tita at
    JOIN vinculos_mes vm
      ON  at.paciente_id::text      = split_part(vm.bloco_id, '_', 1)
      AND at.data_atendimento::text = split_part(vm.bloco_id, '_', 2)
    WHERE at.ativo = true
      AND at.convenio_nome ILIKE '%assim%'
  ),
  chaves_vinculo AS (
    SELECT DISTINCT
      substring(va.numero_carteirinha, 1, 6)                         AS empresa,
      substring(va.numero_carteirinha, 7, 7)                         AS matricula_base,
      right(regexp_replace(va.numero_carteirinha, '\D', '', 'g'), 2)  AS dep,
      va.data_atendimento                                            AS dia,
      public.tuss_da_sessao(va.terapia_exibicao_nome, va.terapia_id, va.terapia_nome, va.paciente_id, va.data_atendimento) AS codigo_tuss
    FROM vinculo_agenda va
    WHERE va.bloco_id = concat_ws('_', va.paciente_id, va.data_atendimento,
            public.tuss_da_sessao(va.terapia_exibicao_nome, va.terapia_id, va.terapia_nome, va.paciente_id, va.data_atendimento),
            va.hora_inicial)
  ),
  $novo$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'get_tokens_mensal'
     AND pg_get_function_identity_arguments(p.oid) = 'p_mes date';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'get_tokens_mensal(date) não existe';
  END IF;

  IF position('20260925150000' in v_def) > 0 THEN
    RAISE NOTICE 'get_tokens_mensal já materializa o vínculo';
    RETURN;
  END IF;

  IF (length(v_def) - length(replace(v_def, c_ini, ''))) / length(c_ini) <> 1 THEN
    RAISE EXCEPTION 'get_tokens_mensal: "%" esperado 1x. Reveja à mão.', c_ini;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_fim, ''))) / length(c_fim) <> 1 THEN
    RAISE EXCEPTION 'get_tokens_mensal: "%" esperado 1x. Reveja à mão.', c_fim;
  END IF;

  v_ini := position(c_ini in v_def);
  v_fim := position(c_fim in v_def);
  IF v_fim <= v_ini THEN
    RAISE EXCEPTION 'get_tokens_mensal: "%" antes de "%". Reveja à mão.', c_fim, c_ini;
  END IF;

  v_def := substr(v_def, 1, v_ini - 1) || v_novo || substr(v_def, v_fim);

  EXECUTE v_def;
  RAISE NOTICE 'get_tokens_mensal: vínculo materializado antes de tuss_da_sessao';
END
$migr$;
