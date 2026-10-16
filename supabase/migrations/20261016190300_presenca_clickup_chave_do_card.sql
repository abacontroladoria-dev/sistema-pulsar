-- =============================================================================
-- 1ª presença → ClickUp: o nome do paciente é só o 1º trecho do card
-- =============================================================================
-- O diagnóstico de 20261016190200 mostrou, na estreia (16/10/2026), que os 14
-- cards em 'AGENDAMENTO CONCLUÍDO' não se chamam "Nome", e sim
-- "Nome - Serviço - Convênio" ("Fulano de Tal - Entrevista Familiar - LEVE
-- SAÚDE"), às vezes com espaço ou TAB na frente. Comparado inteiro, nenhum casa.
--
-- A chave passa a ser: o trecho antes do primeiro " - " (traço com espaços dos
-- dois lados, aceitando – e —, para não partir nome composto com hífen), sem o
-- sufixo "(ABA)", normalizado e aparado. normalizar_nome_paciente colapsa espaço
-- mas não apara a ponta, daí o btrim.
--
-- Uma função só, usada pelas duas leituras, para elas não divergirem.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.presenca_clickup_chave(p_nome text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT nullif(btrim(public.normalizar_nome_paciente(
           regexp_replace(
             (regexp_split_to_array(btrim(coalesce(p_nome, '')), '\s+[-–—]\s+'))[1],
             '\s*\([^)]*\)\s*$', ''))), '');
$$;

COMMENT ON FUNCTION public.presenca_clickup_chave(text) IS
  'Chave de casamento do card do ClickUp: trecho antes do 1º " - " (o card é "Nome - Serviço - Convênio"), sem sufixo entre parênteses, normalizado e aparado.';

REVOKE ALL ON FUNCTION public.presenca_clickup_chave(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.presenca_clickup_chave(text) TO service_role;

-- ── As duas leituras passam a usar a chave ───────────────────────────────────
-- Substituição por texto no corpo vivo: as funções são deste mesmo conjunto
-- (20261016190100/190200), e o trecho trocado é contado 1x antes.
DO $migr$
DECLARE
  v_alvo text := $a$public.normalizar_nome_paciente(
             regexp_replace(c->>'nome', '\s*\([^)]*\)\s*$', '')) AS chave$a$;
  v_novo text := $a$public.presenca_clickup_chave(c->>'nome') AS chave$a$;
  v_fn   text;
  v_def  text;
  v_n    int;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['presenca_clickup_casar', 'presenca_clickup_nomes_sem_agenda'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_fn;

    IF v_def IS NULL THEN
      RAISE EXCEPTION '% não existe', v_fn;
    END IF;
    IF position('presenca_clickup_chave' in v_def) > 0 THEN
      RAISE NOTICE '% já usa presenca_clickup_chave', v_fn;
      CONTINUE;
    END IF;

    v_def := replace(v_def, E'\r\n', E'\n');
    v_n := (length(v_def) - length(replace(v_def, v_alvo, ''))) / length(v_alvo);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: trecho esperado 1x, achei %. Reveja à mão.', v_fn, v_n;
    END IF;

    EXECUTE replace(v_def, v_alvo, v_novo);
  END LOOP;
END
$migr$;
