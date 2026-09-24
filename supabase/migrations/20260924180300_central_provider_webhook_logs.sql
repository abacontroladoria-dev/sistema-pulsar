-- ============================================================================
-- Central: log cru dos webhooks de provider (doc 06, seções 14-16)
--
-- A Evolution não assina o corpo, e o formato dela muda entre versões. Guardar
-- o payload como chegou é o que permite diagnosticar "a mensagem não apareceu"
-- sem reproduzir o caso — e reprocessar se a normalização estava errada.
--
-- Só service_role: o payload tem conteúdo de conversa de gente identificada.
-- ============================================================================

create table if not exists central.provider_webhook_logs (
  id              bigint generated always as identity primary key,
  organization_id uuid,
  provider        central.provider_type not null,
  instance        text,
  event_type      text,
  payload         jsonb not null,
  processed       boolean not null default false,
  error_message   text,
  received_at     timestamptz not null default now()
);

create index if not exists idx_provider_webhook_logs_received
  on central.provider_webhook_logs (received_at);

create index if not exists idx_provider_webhook_logs_pendentes
  on central.provider_webhook_logs (received_at)
  where processed = false;

alter table central.provider_webhook_logs enable row level security;

revoke all on central.provider_webhook_logs from anon, authenticated;
