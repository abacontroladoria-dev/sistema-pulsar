-- REVOKE EXECUTE nas funcoes de match de agendamento.
--
-- POR QUE
-- `fn_agendamentos_da_sessao` (20260915180000) nasceu executavel por qualquer
-- um com a chave publica: conferido apos aplicar, `anon` chamou a funcao pelo
-- PostgREST e ela EXECUTOU. Todas as outras funcoes desta integracao —
-- integracao_autenticar, integracao_identificar, integracao_faltas — tem
-- REVOKE explicito; esta ficou de fora por esquecimento meu.
--
-- Nao houve vazamento: ela devolve ids de agendamento e exige acertar
-- paciente_id + data + horario + nome da terapia exatos para devolver algo.
-- Mas e superficie desnecessaria, e o padrao do repo e nao deixar funcao de
-- integracao alcancavel pela chave do bundle.
--
-- A causa raiz e conhecida e ja esta registrada em
-- 20260817000000_advisors_warnings_grant_execute_public.sql: o Postgres da
-- EXECUTE a PUBLIC por padrao em toda funcao criada. Nao e a migration que
-- concede — e o default que precisa ser revogado a cada CREATE FUNCTION.
--
-- ============================================================
-- ATENCAO AO ESCOPO DIFERENTE DAS DUAS
-- ============================================================
-- `fn_agendamentos_da_sessao`: revoke TOTAL. So a view
-- `vw_integracao_faltas` a usa, e ela e lida exclusivamente pela RPC
-- `integracao_faltas`, que e SECURITY DEFINER — roda como owner e nao depende
-- de grant nenhum para `anon`/`authenticated`. Nenhum caminho do app a chama:
-- grep em supabase/, frontend/app, lib, services, hooks e components nao
-- encontrou uma unica referencia fora da propria view.
--
-- `fn_match_tita_agendamento_id`: revoke APENAS de PUBLIC e anon.
-- `authenticated` PRECISA continuar com EXECUTE, e tirar seria quebrar o
-- registro de falta inteiro. A cadeia:
--
--   /solicitar usa getSupabaseClient() (client do browser, lib/supabase/client)
--     -> INSERT em fila_autorizacoes roda como `authenticated`
--       -> dispara trg_set_tita_agendamento_id (BEFORE INSERT)
--         -> fn_set_tita_agendamento_id, que e LANGUAGE plpgsql SEM
--            SECURITY DEFINER, portanto executa como o INVOCADOR
--           -> chama fn_match_tita_agendamento_id
--
-- Sem EXECUTE para `authenticated`, o trigger levanta 42501 e o INSERT falha.
-- O sintoma seria a recepcao clicando em "Faltou" e nada gravando — o mesmo
-- genero de falha que a memoria reference_rls_leitura_sem_escrita_ocupacao_salas
-- registra: a tela abre, a acao nao grava, e a mensagem de erro mente.
--
-- Por isso este arquivo NAO tem uma linha simetrica para as duas funcoes. A
-- assimetria e deliberada e a razao esta acima.

-- ------------------------------------------------------------
-- 1. A funcao nova: ninguem de fora precisa dela
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.fn_agendamentos_da_sessao(text, date, time, text)
  FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 2. A funcao antiga: fecha para anon, preserva o trigger
-- ------------------------------------------------------------
-- `authenticated` fica de fora do REVOKE de proposito — ver o bloco acima.
REVOKE EXECUTE ON FUNCTION public.fn_match_tita_agendamento_id(text, date, time, text)
  FROM PUBLIC, anon;

COMMENT ON FUNCTION public.fn_match_tita_agendamento_id(text, date, time, text) IS
  'Casa uma linha de fila_autorizacoes com o agendamento do TiTa por '
  '(paciente, data, hora, terapia). Chamada pelo trigger trg_set_tita_agendamento_id, '
  'que roda como INVOCADOR: `authenticated` PRECISA manter EXECUTE, senao o INSERT '
  'de falta pelo /solicitar falha com 42501. Nao casa sessao combinada (terapia_nome '
  'com " + "); para isso ver fn_agendamentos_da_sessao.';
