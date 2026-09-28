-- =============================================================================
-- Guia pode cobrir sessão POSTERIOR à data dela, dentro da mesma semana, com
-- observação obrigatória.
--
-- CASO: Miguel Rodrigues De Queiroz (11692). A sessão de SEG 21/09 13:40
-- (Aplicador ABA (AE), que para ele é TO) foi autorizada como Psicologia, e a
-- ASSIM aceitou consumindo a cota de Psicologia da semana — a que era da
-- Coordenação de Caso de QUI 24/09 14:20, que glosou por reincidência (1601).
-- A recepção tirou uma avulsa de TO para a segunda; a guia de Psicologia de
-- segunda passa a ser a da quinta. Ou seja: uma guia de 21/09 cobre uma sessão
-- de 24/09. Ver snippet 20260925_miguel_excecao_tuss_desde_2109.sql.
--
-- A REGRA ANTERIOR ERA SÓ RETROATIVA, e de propósito (20260916120000: "não
-- existe cobrir sessão que ainda não aconteceu"). Continua valendo como padrão:
-- o que se abre aqui é estreito —
--   - só até o domingo da semana da guia (a cota da ASSIM é semanal, e é dela
--     que o remanejamento sai);
--   - só com observação — o vínculo para a frente é sempre um remanejamento
--     manual, e o porquê precisa ficar escrito.
-- Faltas (vincular_autorizacao_falta/substituicao) seguem só retroativas.
--
-- TÉCNICA: edição por REGEX sobre pg_get_functiondef (os corpos em produção
-- podem ter \r\n — ver 20260925130000), contagem exata, RAISE se não bater.
-- =============================================================================

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. vincular_autorizacao — a guarda de janela
-- ---------------------------------------------------------------------------
DO $migr$
DECLARE
  v_def text;
  v_n   int;
  re_cond text := 'if\s+v_efetiva\s*>\s*date\(v_g\.data_execucao\)';
  re_msg  text := '''Sessão de % fora da janela de % dias da autorização \(%\)''';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'vincular_autorizacao'
     AND pg_get_function_identity_arguments(p.oid)
         = 'p_guia text, p_bloco_id text, p_fila_id uuid, p_observacao text, p_janela_dias integer';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'vincular_autorizacao não existe';
  END IF;
  IF position('20260925140100' in v_def) > 0 THEN
    RAISE NOTICE 'vincular_autorizacao já aceita sessão posterior na semana';
    RETURN;
  END IF;

  v_n := (SELECT count(*) FROM regexp_matches(v_def, re_cond, 'g'));
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'vincular_autorizacao: condição de janela esperada 1x, achei %', v_n;
  END IF;
  v_n := (SELECT count(*) FROM regexp_matches(v_def, re_msg, 'g'));
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'vincular_autorizacao: mensagem de janela esperada 1x, achei %', v_n;
  END IF;

  -- Depois da guia só passa se for na mesma semana E houver observação.
  v_def := regexp_replace(v_def, re_cond,
    'if /* 20260925140100 */ (v_efetiva > date(v_g.data_execucao)'
    || ' and (v_efetiva > date_trunc(''week'', v_g.data_execucao)::date + 6'
    || ' or nullif(btrim(p_observacao), '''') is null))');
  v_def := regexp_replace(v_def, re_msg,
    '''Sessão de % fora da janela: até % dias antes da autorização (%), ou depois dela na mesma semana com observação''');

  EXECUTE v_def;
  RAISE NOTICE 'vincular_autorizacao: sessão posterior na mesma semana, com observação';
END
$migr$;

-- ---------------------------------------------------------------------------
-- 2. get_candidatas_vinculo — oferece também as sessões do resto da semana
-- ---------------------------------------------------------------------------
-- Só o ramo das SESSÕES. `v_de`/`v_ate` seguem sendo a janela das faltas.
DO $migr$
DECLARE
  v_def text;
  v_n   int;
  re_serie  text := 'generate_series\(v_de,\s*v_ate\s*\+\s*1,';
  re_filtro text := 'c\.data_efetiva\s+between\s+v_ate\s*-\s*p_janela_dias\s+and\s+v_ate\y';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_candidatas_vinculo'
     AND pg_get_function_identity_arguments(p.oid) = 'p_guia text, p_janela_dias integer';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'get_candidatas_vinculo não existe';
  END IF;
  IF position('20260925140100' in v_def) > 0 THEN
    RAISE NOTICE 'get_candidatas_vinculo já oferece o resto da semana';
    RETURN;
  END IF;

  v_n := (SELECT count(*) FROM regexp_matches(v_def, re_serie, 'g'));
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'get_candidatas_vinculo: generate_series esperado 1x, achei %', v_n;
  END IF;
  v_n := (SELECT count(*) FROM regexp_matches(v_def, re_filtro, 'g'));
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'get_candidatas_vinculo: filtro de data efetiva esperado 1x, achei %', v_n;
  END IF;

  -- Varre até o domingo da semana da guia (no mínimo +1 dia, como antes, para
  -- alcançar sessão adiantada).
  v_def := regexp_replace(v_def, re_serie,
    'generate_series(v_de, /* 20260925140100 */ greatest(v_ate + 1, date_trunc(''week'', v_ate::timestamp)::date + 6),');
  v_def := regexp_replace(v_def, re_filtro,
    'c.data_efetiva between v_ate - p_janela_dias and /* 20260925140100 */ (date_trunc(''week'', v_ate::timestamp)::date + 6)');

  EXECUTE v_def;
  RAISE NOTICE 'get_candidatas_vinculo: oferece sessões posteriores na mesma semana';
END
$migr$;
