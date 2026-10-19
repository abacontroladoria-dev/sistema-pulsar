-- =============================================================================
-- Consulta médica (Psiquiatra/Neurologista, 2695) na /solicitar — só presença/falta
-- =============================================================================
-- Pedido de 16/10/2026: a recepção precisa dar presença na consulta médica. Ela
-- é o 1º contato de parte dos pacientes novos e decide o card do ClickUp
-- (20261016190100: consulta médica → 'Atendimento Realizado'). Até aqui a sessão
-- nunca chegava à tela: 297 sessões no TiTa, zero linhas em fila_autorizacoes.
--
-- Um bloqueio só: a view agenda_tita_autorizacao exige codigo_tuss, e
-- tuss_da_sessao() não tem código para 2695. O resto já está pronto desde
-- 20261013120000 — 2695 não está na blacklist de listar_central_autorizacoes, e
-- card sem TUSS nenhum vira tipo_fluxo='presenca' em qualquer convênio, ASSIM
-- inclusive (sem TUSS não há o que pedir à operadora).
--
-- 2695 aparece no TiTa com um nome só (terapia e exibição 'Psiquiatra/
-- Neurologista', medido em 16/10/2026), então o id basta.
--
-- TÉCNICA: replace sobre o corpo VIVO (pg_get_viewdef), como 20261013120000 —
-- preserva as exceções 2279 e 2800. Trecho contado 1x antes; senão RAISE e nada
-- muda. Idempotente pelo próprio texto novo.
-- =============================================================================

set lock_timeout = '5s';

DO $migr$
DECLARE
  v_def  text;
  v_n    int;
  v_alvo text := '((a.terapia_id = 2279) AND (a.terapia_exibicao_id = 2279))';
  v_novo text := '((a.terapia_id = 2279) AND (a.terapia_exibicao_id = 2279)) OR ((a.terapia_id = 2695) AND (a.terapia_exibicao_id = 2695))';
BEGIN
  v_def := pg_get_viewdef('public.agenda_tita_autorizacao'::regclass);

  IF position('2695' in v_def) > 0 THEN
    RAISE NOTICE 'agenda_tita_autorizacao já deixa passar a consulta médica';
    RETURN;
  END IF;

  v_n := (length(v_def) - length(replace(v_def, v_alvo, ''))) / length(v_alvo);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'agenda_tita_autorizacao: trecho esperado 1x, achei %: %. Reveja à mão.', v_n, v_alvo;
  END IF;

  EXECUTE 'CREATE OR REPLACE VIEW public.agenda_tita_autorizacao AS ' -- seguranca: security_invoker é religado logo abaixo (ALTER VIEW)
          || replace(v_def, v_alvo, v_novo);
  -- CREATE OR REPLACE zera reloptions.
  EXECUTE 'ALTER VIEW public.agenda_tita_autorizacao SET (security_invoker = true)';
  RAISE NOTICE 'agenda_tita_autorizacao: consulta médica (2695/2695) passa sem TUSS';
END
$migr$;
