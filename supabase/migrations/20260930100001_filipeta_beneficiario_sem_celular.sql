-- =============================================================================
-- `3-BENEFICIARIO SEM CELULAR` exige filipeta, com ou sem token
-- =============================================================================
-- Mesma família de 20260903000000 (`8-DISPOSITIVO INDISPONIVEL`): sem celular
-- para o QR Code/biometria, a ASSIM emite o papel. Caso real: MARIA CLARA
-- BERTELLI, 23/09/2026 16:03 — o papel existia e a Conferência de Filipetas
-- não o cobrava.
--
-- DUAS FONTES, a mesma régua das que já existem:
--   - `biofacial` com prefixo `3` (RELATÓRIO da ASSIM, resposta): entra sem gate
--     de recusa, exatamente como o `8-` — trocas 1, 2 e 3 (`= '8'` -> IN).
--   - `forma_autorizacao ILIKE '%sem celular%'` (modal da RECEPÇÃO, intenção):
--     entra pela semente e pelo ramo da fila do erro facial, DENTRO do mesmo
--     gate de recusa — trocas 4 e 5. Em OPCOES_VALIDACAO (rpa.js) só uma opção
--     contém "sem celular".
--
-- BLAST RADIUS: só ACRESCENTA linhas. Cada troca alarga uma condição com OR/IN;
-- nenhum ramo existente muda, e partição nova não renumera partição existente
-- (filtra-se partição inteira — 20260820100000). Provado antes de aplicar por
-- supabase/snippets/20260930_diagnostico_filipeta_sem_celular.sql
-- (perdidas_ou_alteradas = 0).
--
-- TÉCNICA: replace sobre pg_get_functiondef VIVO — não CREATE OR REPLACE a
-- partir de 20260925100000, que apagaria as edições por texto de
-- 20260925120000/140000/150000. Cada trecho conferido 1x antes de qualquer
-- troca; senão RAISE e nada muda. pg_get_functiondef devolve os SET de
-- proconfig; CREATE OR REPLACE preserva os grants. Idempotente pelo próprio
-- texto novo ('%sem celular%').
-- =============================================================================

set lock_timeout = '5s';

DO $migr$
DECLARE
  v_def  text;
  v_par  text[];
  v_n    int;
  trocas text[][] := ARRAY[
    ARRAY[$a$OR split_part(btrim(COALESCE(aa.biofacial, '')), '-', 1) = '8'$a$,
          $a$OR split_part(btrim(COALESCE(aa.biofacial, '')), '-', 1) IN ('3', '8')$a$],
    ARRAY[$a$WHERE split_part(btrim(COALESCE(biofacial, '')), '-', 1) = '8'$a$,
          $a$WHERE split_part(btrim(COALESCE(biofacial, '')), '-', 1) IN ('3', '8')$a$],
    ARRAY[$a$OR split_part(btrim(COALESCE(vin.biofacial, mt.biofacial, '')), '-', 1) = '8'$a$,
          $a$OR split_part(btrim(COALESCE(vin.biofacial, mt.biofacial, '')), '-', 1) IN ('3', '8')$a$],
    ARRAY[$a$AND f.forma_autorizacao ILIKE '%reconhecimento facial%'$a$,
          $a$AND (f.forma_autorizacao ILIKE '%reconhecimento facial%' OR f.forma_autorizacao ILIKE '%sem celular%')$a$],
    ARRAY[$a$fo.forma_autorizacao ILIKE '%reconhecimento facial%'$a$,
          $a$(fo.forma_autorizacao ILIKE '%reconhecimento facial%' OR fo.forma_autorizacao ILIKE '%sem celular%')$a$]
  ];
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

  IF position('%sem celular%' in v_def) > 0 THEN
    RAISE NOTICE 'get_tokens_mensal já cobra filipeta de beneficiário sem celular';
    RETURN;
  END IF;

  -- Conta TODAS antes de trocar qualquer uma.
  FOREACH v_par SLICE 1 IN ARRAY trocas LOOP
    v_n := (length(v_def) - length(replace(v_def, v_par[1], ''))) / length(v_par[1]);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'get_tokens_mensal: trecho esperado 1x, achei %: %. Reveja à mão.', v_n, v_par[1];
    END IF;
  END LOOP;

  FOREACH v_par SLICE 1 IN ARRAY trocas LOOP
    v_def := replace(v_def, v_par[1], v_par[2]);
  END LOOP;

  EXECUTE v_def;
  RAISE NOTICE 'get_tokens_mensal: beneficiário sem celular exige filipeta';
END
$migr$;
