-- =============================================================================
-- Conferência de Filipetas não abria: get_tokens_mensal varria a agenda inteira.
--
-- SINTOMA (25/09): o modal da /auditoria-assim "não abria" (relato).
-- get_tokens_mensal('2026-09-01') levava ~11 s com service_role (sem RLS,
-- medido 3x); como `authenticated`, com as policies por cima, é o que chega
-- perto do statement_timeout de 30 s da função.
--
-- CAUSA: 20260925100000 trocou tuss_da_sessao(3 args) — sql IMMUTABLE, que o
-- planner embute na query — pela sobrecarga de 5 args, SECURITY DEFINER com
-- SET search_path, que NÃO pode ser embutida: vira uma chamada de função por
-- linha. Em `chaves_vinculo` o join com os vínculos do mês é por
--   vm.bloco_id = concat_ws('_', paciente_id, data, tuss_da_sessao(...), hora)
-- sobre TODO o histórico ASSIM de agenda_tita (sem filtro de data), então a
-- função rodava duas vezes por linha da agenda inteira.
--
-- CORREÇÃO: antes da igualdade do bloco_id, casar paciente e data pelos dois
-- primeiros campos do próprio bloco_id. É só uma restrição a mais — o bloco_id
-- já contém esses dois valores na mesma formatação (concat_ws usa o mesmo
-- output de texto), então o resultado é idêntico; o planner faz o hash join por
-- (paciente, data) e só chama tuss_da_sessao para as poucas linhas que casam.
-- Comparação em TEXTO de propósito: nenhum cast que possa estourar num
-- bloco_id malformado.
--
-- TÉCNICA: edição por regex sobre pg_get_functiondef (o corpo em produção pode
-- ter \r\n — ver 20260925130000). pg_get_functiondef devolve os SET de
-- proconfig, então statement_timeout/search_path sobrevivem. Sem DROP.
-- =============================================================================

set lock_timeout = '5s';

DO $migr$
DECLARE
  v_def text;
  v_n   int;
  re_join text := 'JOIN\s+vinculos_mes\s+vm\s+ON\s+vm\.bloco_id\s*=';
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

  IF position('20260925140000' in v_def) > 0 THEN
    RAISE NOTICE 'get_tokens_mensal já pré-filtra o vínculo por paciente e data';
    RETURN;
  END IF;

  v_n := (SELECT count(*) FROM regexp_matches(v_def, re_join, 'gi'));
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'get_tokens_mensal: join de vinculos_mes esperado 1x, achei %. Extraia com pg_get_functiondef e reveja à mão.', v_n;
  END IF;

  v_def := regexp_replace(v_def, re_join,
    E'JOIN vinculos_mes vm\n'
    || E'      -- 20260925140000: paciente e data do próprio bloco_id primeiro, para\n'
    || E'      -- tuss_da_sessao só rodar nas linhas que casam (não na agenda inteira).\n'
    || E'      ON  at.paciente_id::text      = split_part(vm.bloco_id, ''_'', 1)\n'
    || E'      AND at.data_atendimento::text = split_part(vm.bloco_id, ''_'', 2)\n'
    || E'      AND vm.bloco_id =', 'i');

  EXECUTE v_def;
  RAISE NOTICE 'get_tokens_mensal: vínculo pré-filtrado por paciente e data';
END
$migr$;
