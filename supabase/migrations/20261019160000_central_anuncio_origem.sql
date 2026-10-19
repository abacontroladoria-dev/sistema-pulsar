-- Anúncio de origem (Click-to-WhatsApp) na conversa + catálogo de anúncios.
--
-- O clique num anúncio da Meta deixa o ID do anúncio na primeira mensagem:
-- Meta Cloud API em `messages[].referral`, Evolution em
-- `contextInfo.externalAdReply`. Os normalizadores descartavam esse bloco, e
-- lead de anúncio pago ficava indistinguível do orgânico. A partir daqui:
--
--   central.conversations.anuncio   o PRIMEIRO anúncio da conversa (jsonb),
--                                   gravado só quando está nulo
--   central.meta_ad_catalog         ad_id → nomes de anúncio/conjunto/campanha,
--                                   pela Marketing API (env META_ADS_TOKEN,
--                                   System User com ads_read). Sem o token a
--                                   conversa fica só com o ID.

-- conversations é tabela quente (webhook + tique a cada 10s): sem espera
-- infinita por lock. Ver reference_alter_table_deadlock_lock_timeout.
set lock_timeout = '3s';

alter table central.conversations
  add column if not exists anuncio jsonb;

comment on column central.conversations.anuncio is
  'Primeiro anúncio da Meta que trouxe a pessoa: {ad_id, ctwa_clid, titulo, url, source_type, pago, provider, capturado_em}. Gravado pelo sistema na mensagem do clique, só quando nulo (primeiro toque). Nomes em central.meta_ad_catalog.';

create index if not exists idx_conversations_anuncio_ad_id
  on central.conversations ((anuncio ->> 'ad_id'))
  where anuncio is not null;

reset lock_timeout;

-- ============================================================================
-- TABLE: central.meta_ad_catalog
--
-- Consultado só para IDs que de fato chegaram — cobre anúncio pausado ou
-- apagado depois, que uma sincronização "lista os anúncios da conta" perderia.
-- lookup_error: a Graph não resolveu (conta que o token não enxerga, anúncio
-- removido). Fica a linha para não repetir a consulta a cada mensagem; o tique
-- tenta de novo uma vez por dia.
-- ============================================================================
create table if not exists central.meta_ad_catalog (
  ad_id         text        primary key,
  ad_name       text,
  ad_status     text,
  adset_id      text,
  adset_name    text,
  campaign_id   text,
  campaign_name text,
  ad_account_id text,
  lookup_error  text,
  fetched_at    timestamptz not null default now()
);

alter table central.meta_ad_catalog enable row level security;

-- Só leitura para quem está logado (o painel da conversa lê os nomes); quem
-- escreve é o servidor, com service_role, que não passa por RLS. O default
-- privileges do schema central dá DML ao authenticated — tirado aqui.
revoke insert, update, delete, truncate on central.meta_ad_catalog from authenticated;
revoke all on central.meta_ad_catalog from anon;

create policy meta_ad_catalog_select
  on central.meta_ad_catalog
  for select
  to authenticated
  using (true);
