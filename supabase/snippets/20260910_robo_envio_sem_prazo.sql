-- =============================================================================
-- Robô 1.1.8: a espera pelo clique em "enviar" não tem mais prazo
-- =============================================================================
--
-- Empacota a migration 20260910170000_robo_envio_sem_prazo.sql para ser colada
-- de uma vez no SQL Editor. Não é uma migration nova — ver supabase/snippets/README.md.
--
-- CONTEXTO. Depois da leitura facial/QR o robô preenche o formulário e PARA:
-- quem clica em "enviar" é a recepcionista. Essa espera tinha prazo de 120s
-- (`envio_timeout_ms`). Estourado, o rpa.js lançava, o worker chamava
-- sessao.descartar() e o contexto do Chrome fechava — a JANELA SUMIA na cara do
-- operador, com o formulário preenchido dentro, sem contagem visível nenhuma.
--
-- A partir do robô 1.1.8 o código IGNORA esta coluna. Este script só alinha o
-- banco ao comportamento real: deixar 120000 gravado descreveria algo que não
-- existe mais.
--
-- ORDEM EM RELAÇÃO AO DEPLOY DO ROBÔ: indiferente. O código novo não lê o valor
-- e o código velho (<= 1.1.7) lendo 0 cairia no `|| 120000` do rpa.js, mantendo
-- o comportamento antigo. Não há janela de risco.
--
-- A coluna NÃO é removida: robô <= 1.1.7 ainda em campo lê a config pela RPC
-- robo_obter_config_assim, e derrubá-la quebraria o parse dessas máquinas
-- durante a atualização da frota.

begin;

UPDATE public.robo_config
   SET envio_timeout_ms = 0,
       updated_at       = now()
 WHERE envio_timeout_ms IS DISTINCT FROM 0;

COMMENT ON COLUMN public.robo_config.envio_timeout_ms IS
  'OBSOLETO desde o robô 1.1.8 (2026-09-10): o robô IGNORA este valor. A espera '
  'pelo clique em "enviar" não tem prazo — termina quando a ASSIM responde ou '
  'quando uma pessoa fecha a aba. Mantida só para o parse dos robôs <= 1.1.7 '
  'ainda em campo. Até a 1.1.7 valia 120000, e o estouro FECHAVA a janela da '
  'recepção com o formulário preenchido dentro.';

insert into supabase_migrations.schema_migrations (version)
values ('20260910170000')
on conflict (version) do nothing;

commit;

-- Conferência (rodar depois do commit):
--   select envio_timeout_ms, updated_at from public.robo_config;
--   -- espera-se envio_timeout_ms = 0
