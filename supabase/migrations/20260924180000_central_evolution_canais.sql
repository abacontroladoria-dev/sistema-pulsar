-- ============================================================================
-- Central: números WhatsApp pela Evolution API (um número = uma inbox)
--
-- Cada número Evolution nasce com a SUA inbox. É o que faz `inbox_members`
-- servir de controle de acesso por número: marketing vê o número do marketing e
-- nada mais (ver 20260924180200). A inbox da Maia (Meta) não muda.
--
-- As credenciais por instância (token da instância e segredo do webhook) vão em
-- `channel_connections.provider_metadata`, que `authenticated` grava mas não lê
-- (20260810120300). O nome da instância na Evolution vai em
-- `provider_instance_id`, que é legível — é identificador, não segredo.
-- ============================================================================

-- Uma connection por canal. O provider resolve a connection por `channel_id`
-- com `.maybeSingle()`: uma segunda linha faria todo envio daquele canal falhar.
do $$
begin
  if exists (
    select channel_id from central.channel_connections
    group by channel_id having count(*) > 1
  ) then
    raise exception 'channel_connections tem canal com mais de uma connection — resolva antes de aplicar';
  end if;
end $$;

alter table central.channel_connections
  add constraint uq_channel_connections_channel unique (channel_id);

-- O webhook da Evolution identifica o canal pelo nome da instância.
create unique index if not exists uq_channel_connections_instance
  on central.channel_connections (provider_instance_id)
  where provider_instance_id is not null;

-- Filtro por número na lista do inbox (`channel_id in (...)` ordenado).
create index if not exists idx_conversations_org_channel_last
  on central.conversations (organization_id, channel_id, last_message_at desc);

-- ----------------------------------------------------------------------------
-- criar_canal_evolution: inbox + channel + connection + admin como membro,
-- numa transação só. Em quatro chamadas separadas, uma falha no meio deixaria
-- uma inbox sem canal (ou um canal sem connection) que ninguém limparia.
-- ----------------------------------------------------------------------------
create or replace function central.criar_canal_evolution(
  p_org_id     uuid,
  p_nome       text,
  p_instance   text,
  p_metadata   jsonb,
  p_admin_id   uuid
)
returns table (inbox_id uuid, channel_id uuid)
language plpgsql
security definer
set search_path = central, public
as $$
#variable_conflict use_column
declare
  v_inbox   uuid;
  v_channel uuid;
begin
  if coalesce(trim(p_nome), '') = '' then
    raise exception 'nome do número é obrigatório' using errcode = 'check_violation';
  end if;

  insert into central.inboxes (organization_id, name, description)
  values (p_org_id, p_nome, 'Número WhatsApp (Evolution) — atendimento humano')
  returning id into v_inbox;

  insert into central.channels (
    organization_id, inbox_id, name, provider, channel_type, status, active
  ) values (
    p_org_id, v_inbox, p_nome, 'evolution', 'whatsapp', 'connecting', true
  )
  returning id into v_channel;

  insert into central.channel_connections (
    organization_id, channel_id, provider_instance_id, provider_metadata, connection_status
  ) values (
    p_org_id, v_channel, p_instance, p_metadata, 'connecting'
  );

  if p_admin_id is not null then
    insert into central.inbox_members (organization_id, inbox_id, user_id, role)
    values (p_org_id, v_inbox, p_admin_id, 'admin');
  end if;

  return query select v_inbox, v_channel;
end;
$$;

revoke all on function central.criar_canal_evolution(uuid, text, text, jsonb, uuid) from public;
revoke all on function central.criar_canal_evolution(uuid, text, text, jsonb, uuid) from anon, authenticated;
grant execute on function central.criar_canal_evolution(uuid, text, text, jsonb, uuid) to service_role;

comment on function central.criar_canal_evolution(uuid, text, text, jsonb, uuid) is
  'Cria um número Evolution: inbox própria + channel (provider evolution) + connection + criador como membro. Só service_role: quem chama é a rota /api/central/evolution/instances, que já conferiu que o usuário é admin.';
