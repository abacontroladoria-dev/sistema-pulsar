-- Backfill do anúncio de origem (19/10/2026)
--
-- O código novo grava `central.conversations.anuncio` nas mensagens que
-- CHEGAREM depois do deploy. Este snippet recupera as que já chegaram pela
-- Evolution: o webhook guarda o payload inteiro em
-- central.provider_webhook_logs, e o clique no anúncio está lá em
-- `contextInfo.externalAdReply` (em 19/10 eram 13 cliques em 14 dias, todos em
-- `data.contextInfo`). A Meta Cloud API não tem log equivalente — o que chegou
-- por ela antes do deploy não tem como ser recuperado.
--
-- Mesma regra do código (providers/evolution.normalizar.ts):
--   - só mensagem da PESSOA (fromMe = false);
--   - precisa de sourceId ou ctwaClid;
--   - sourceType 'post' é capturado mas não é pago;
--   - primeiro toque: só conversa com `anuncio` nulo, e o clique mais antigo.
-- ORIGEM: anúncio pago vira meta_ads onde a conversa não tem origem ou tem
-- contato_direto (o "nenhum sinal" da regra de texto — em 19/10, as 12
-- conversas de anúncio estavam nela). Origem explícita não é tocada; a
-- coluna origem_atual da PARTE 1 mostra o que há hoje.
--
-- Depende da migration 20261019160000_central_anuncio_origem.sql aplicada.
-- Rode a PARTE 1, confira, depois a PARTE 2. Os nomes das campanhas vêm
-- sozinhos no tique seguinte, se META_ADS_TOKEN estiver configurado.

-- ═══ PARTE 1 — o que vai ser gravado (só leitura) ═══
with clique as (
  select
    l.received_at,
    l.payload #>> '{data,key,id}' as external_id,
    coalesce(
      l.payload #> '{data,contextInfo,externalAdReply}',
      (select n.value -> 'contextInfo' -> 'externalAdReply'
         from jsonb_each(coalesce(l.payload #> '{data,message}', '{}'::jsonb)) n
        where jsonb_typeof(n.value) = 'object' and n.value -> 'contextInfo' ? 'externalAdReply'
        limit 1)
    ) as ad,
    l.payload #> '{data,contextInfo}' as ctx
  from central.provider_webhook_logs l
  where l.provider = 'evolution'
    and lower(replace(coalesce(l.payload ->> 'event', ''), '_', '.')) = 'messages.upsert'
    and coalesce(l.payload #>> '{data,key,fromMe}', 'false') = 'false'
    and l.payload::text like '%externalAdReply%'
),
anuncio as (
  select
    m.conversation_id,
    c.received_at,
    jsonb_build_object(
      'ad_id',       c.ad ->> 'sourceId',
      'ctwa_clid',   coalesce(c.ad ->> 'ctwaClid', c.ctx ->> 'ctwaClid',
                              substring(c.ad ->> 'sourceUrl' from '[?&]ctwa_clid=([^&]+)')),
      'titulo',      nullif(btrim(c.ad ->> 'title'), ''),
      'url',         coalesce(nullif(c.ad ->> 'sourceUrl', ''), nullif(c.ad ->> 'mediaUrl', '')),
      'source_type', lower(c.ad ->> 'sourceType'),
      'plataforma',  lower(coalesce(c.ad ->> 'sourceApp', c.ctx ->> 'entryPointConversionApp')),
      'pago',        coalesce(lower(c.ad ->> 'sourceType'), '') <> 'post',
      'provider',    'evolution',
      'capturado_em', c.received_at
    ) as anuncio
  from clique c
  join central.messages m
    on m.provider = 'evolution' and m.external_message_id = c.external_id and m.direction = 'inbound'
  where c.ad is not null
    and (c.ad ->> 'sourceId' is not null or c.ad ->> 'ctwaClid' is not null
         or c.ad ->> 'sourceUrl' like '%ctwa_clid=%')
),
primeiro as (
  select distinct on (conversation_id) conversation_id, anuncio
  from anuncio
  order by conversation_id, received_at
)
select
  cv.id,
  ct.name,
  p.anuncio ->> 'ad_id'      as ad_id,
  p.anuncio ->> 'plataforma' as plataforma,
  (p.anuncio ->> 'pago')::boolean as pago,
  (select array_agg(t) from unnest(cv.tags) t
    where t in (select d.key from central.tag_definitions d
                 where d.organization_id = cv.organization_id and d.grupo_key = 'origem')) as origem_atual,
  cv.campanha,
  cv.created_at
from primeiro p
join central.conversations cv on cv.id = p.conversation_id
left join central.contacts ct on ct.id = cv.contact_id
where cv.anuncio is null
order by cv.created_at desc;


-- ═══ PARTE 2 — aplicar ═══
begin;
set local lock_timeout = '5s';

with clique as (
  select
    l.received_at,
    l.payload #>> '{data,key,id}' as external_id,
    coalesce(
      l.payload #> '{data,contextInfo,externalAdReply}',
      (select n.value -> 'contextInfo' -> 'externalAdReply'
         from jsonb_each(coalesce(l.payload #> '{data,message}', '{}'::jsonb)) n
        where jsonb_typeof(n.value) = 'object' and n.value -> 'contextInfo' ? 'externalAdReply'
        limit 1)
    ) as ad,
    l.payload #> '{data,contextInfo}' as ctx
  from central.provider_webhook_logs l
  where l.provider = 'evolution'
    and lower(replace(coalesce(l.payload ->> 'event', ''), '_', '.')) = 'messages.upsert'
    and coalesce(l.payload #>> '{data,key,fromMe}', 'false') = 'false'
    and l.payload::text like '%externalAdReply%'
),
anuncio as (
  select
    m.conversation_id,
    c.received_at,
    jsonb_build_object(
      'ad_id',       c.ad ->> 'sourceId',
      'ctwa_clid',   coalesce(c.ad ->> 'ctwaClid', c.ctx ->> 'ctwaClid',
                              substring(c.ad ->> 'sourceUrl' from '[?&]ctwa_clid=([^&]+)')),
      'titulo',      nullif(btrim(c.ad ->> 'title'), ''),
      'url',         coalesce(nullif(c.ad ->> 'sourceUrl', ''), nullif(c.ad ->> 'mediaUrl', '')),
      'source_type', lower(c.ad ->> 'sourceType'),
      'plataforma',  lower(coalesce(c.ad ->> 'sourceApp', c.ctx ->> 'entryPointConversionApp')),
      'pago',        coalesce(lower(c.ad ->> 'sourceType'), '') <> 'post',
      'provider',    'evolution',
      'capturado_em', c.received_at
    ) as anuncio
  from clique c
  join central.messages m
    on m.provider = 'evolution' and m.external_message_id = c.external_id and m.direction = 'inbound'
  where c.ad is not null
    and (c.ad ->> 'sourceId' is not null or c.ad ->> 'ctwaClid' is not null
         or c.ad ->> 'sourceUrl' like '%ctwa_clid=%')
),
primeiro as (
  select distinct on (conversation_id) conversation_id, anuncio
  from anuncio
  order by conversation_id, received_at
)
update central.conversations cv
   set anuncio = p.anuncio
  from primeiro p
 where cv.id = p.conversation_id
   and cv.anuncio is null;

-- ORIGEM meta_ads onde o anúncio é pago e a origem está vazia ou é
-- contato_direto (grupo single: sai a anterior, entra meta_ads).
update central.conversations cv
   set tags = array_append(array_remove(coalesce(cv.tags, '{}'), 'contato_direto'), 'meta_ads')
 where cv.anuncio is not null
   and (cv.anuncio ->> 'pago')::boolean
   and exists (select 1 from central.tag_definitions d
                where d.organization_id = cv.organization_id and d.grupo_key = 'origem' and d.key = 'meta_ads')
   and not (array_remove(coalesce(cv.tags, '{}'), 'contato_direto') && array(
     select d.key from central.tag_definitions d
      where d.organization_id = cv.organization_id and d.grupo_key = 'origem'
   ));

commit;
