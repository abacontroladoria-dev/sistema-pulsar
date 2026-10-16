-- =============================================================================
-- 1ª presença → ClickUp: o resumo da última rodada fica na própria config
-- =============================================================================
-- net._http_response guarda a resposta de TODA chamada pg_net do banco (glosa,
-- inclusão, painel...), sem a URL, e só por algumas horas. "A última linha" de
-- lá é de quem chamou por último, não desta automação. A Edge Function passa a
-- gravar o resumo aqui ao fim de cada rodada, com sucesso ou erro:
--
--   select ultima_rodada_em, ultimo_resumo from presenca_clickup_config;
-- =============================================================================

ALTER TABLE public.presenca_clickup_config
  ADD COLUMN IF NOT EXISTS ultima_rodada_em timestamptz,
  ADD COLUMN IF NOT EXISTS ultimo_resumo    jsonb;

COMMENT ON COLUMN public.presenca_clickup_config.ultimo_resumo IS
  'Resumo JSON da última rodada da Edge Function primeira-presenca-clickup: cards no status, resultados, nomes_sem_agenda, erro_fatal.';
