-- Números WhatsApp pela Evolution (atendimento humano) dentro da /connect/inbox
--
-- APLICA as quatro migrations de 24/09/2026, em ordem, cada uma na sua
-- transação, e registra cada versão no livro-caixa (supabase_migrations.
-- schema_migrations) para um `db push` futuro não tentar reaplicá-las.
--
-- Por que snippet e não `db push`: o push empurra TODO o pendente, não só estas
-- (ver reference_db_push_blast_radius).
--
-- lock_timeout: a 20260924180000 cria índice e a 20260924180100 cria trigger em
-- central.conversations, que recebe escrita a cada mensagem. Sem prazo, o DDL
-- entra na fila atrás de uma transação longa e trava todo mundo que vem depois.
-- Se estourar os 5s, é só rodar de novo num momento mais calmo.
--
-- Pode ser rodado inteiro de uma vez. Se uma parte falhar, as anteriores já
-- ficaram (cada uma tem o seu commit) — rode de novo a partir da que falhou.

-- ============================================================================
-- 20260924180000_central_evolution_canais
-- ============================================================================
begin;
set local lock_timeout = '5s';

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

insert into supabase_migrations.schema_migrations (version, name)
values ('20260924180000', 'central_evolution_canais')
on conflict (version) do nothing;

commit;

-- ============================================================================
-- 20260924180100_central_evolution_ai_off
-- ============================================================================
begin;
set local lock_timeout = '5s';

-- ============================================================================
-- Central: a Maia nunca atende número Evolution
--
-- Decisão da diretoria: só a Maia usa a API oficial da Meta; os números
-- Evolution são de atendimento humano. Travar só no código não basta:
-- `conversations.ai_mode` NULL herda o padrão da organização (20260915220000),
-- então uma conversa Evolution nasceria "com a Maia" se a organização estiver em
-- 'autonomous', e qualquer caminho que grave ai_mode (botão, ferramenta, SQL
-- manual) poderia religá-la. No banco vale para todos os caminhos.
-- ============================================================================

create or replace function central.fn_evolution_sem_ia()
returns trigger
language plpgsql
set search_path = central, public
as $$
declare
  v_provider central.provider_type;
begin
  select provider into v_provider from central.channels where id = new.channel_id;

  if v_provider is distinct from 'evolution' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.ai_mode := 'off';
    return new;
  end if;

  -- UPDATE: recusar em vez de corrigir calado. Quem tentou ligar a IA num
  -- número Evolution precisa saber que não é possível.
  if new.ai_mode is distinct from 'off' then
    raise exception 'número Evolution é atendimento humano: ai_mode precisa ser off'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_evolution_sem_ia on central.conversations;
create trigger trg_evolution_sem_ia
  before insert or update of ai_mode, channel_id on central.conversations
  for each row execute function central.fn_evolution_sem_ia();

insert into supabase_migrations.schema_migrations (version, name)
values ('20260924180100', 'central_evolution_ai_off')
on conflict (version) do nothing;

commit;

-- ============================================================================
-- 20260924180200_central_rls_membros_inbox
-- ============================================================================
begin;
set local lock_timeout = '5s';

-- ============================================================================
-- Central: quem é membro de uma inbox enxerga a inbox
--
-- Até aqui toda policy de inboxes/channels/conversations/messages/contacts
-- exigia central_role admin ou director (20260701000800). O operator não via
-- nada — e `inbox_members`, descrita como "a fonte única de autorização"
-- (20260701000500), não entrava em policy nenhuma.
--
-- Esta migration SOMA policies permissivas por membro, sem tocar nas
-- existentes: admin e director continuam vendo a organização inteira; um
-- operator passa a ver exatamente as inboxes em que foi posto. Como cada número
-- Evolution tem a própria inbox (20260924180000), isso é o acesso por número.
--
-- DESEMPENHO: toda chamada é embrulhada em `(select ...)` para o Postgres
-- avaliá-la uma vez por consulta (initplan) e não uma vez por linha. A lista do
-- inbox faz polling de 5s e o pool do PostgREST é pequeno — policy cara aqui vira
-- 504 geral.
-- ============================================================================

create or replace function central.ca_minhas_inboxes()
returns setof uuid
language sql
stable
security definer
set search_path = central, public
as $$
  select im.inbox_id
  from central.inbox_members im
  where im.user_id = auth.uid()
    and im.organization_id = central.current_organization_id();
$$;

revoke all on function central.ca_minhas_inboxes() from public, anon;
grant execute on function central.ca_minhas_inboxes() to authenticated;

-- inbox_members: cada um vê as próprias linhas (é o que o seletor de números
-- consulta). A gestão continua só do admin.
create policy inbox_members_select_self
  on central.inbox_members for select to authenticated
  using (user_id = (select auth.uid()));

create policy inboxes_select_membro
  on central.inboxes for select to authenticated
  using (id in (select central.ca_minhas_inboxes()));

create policy channels_select_membro
  on central.channels for select to authenticated
  using (inbox_id in (select central.ca_minhas_inboxes()));

create policy conversations_select_membro
  on central.conversations for select to authenticated
  using (inbox_id in (select central.ca_minhas_inboxes()));

-- UPDATE é necessário para responder: quem responde assume a conversa
-- (ConversationService.assumirAoResponder) e marcar como lida também escreve.
create policy conversations_update_membro
  on central.conversations for update to authenticated
  using (inbox_id in (select central.ca_minhas_inboxes()))
  with check (inbox_id in (select central.ca_minhas_inboxes()));

create policy messages_select_membro
  on central.messages for select to authenticated
  using (exists (
    select 1 from central.conversations c
    where c.id = conversation_id
      and c.inbox_id in (select central.ca_minhas_inboxes())
  ));

create policy messages_insert_membro
  on central.messages for insert to authenticated
  with check (exists (
    select 1 from central.conversations c
    where c.id = conversation_id
      and c.inbox_id in (select central.ca_minhas_inboxes())
  ));

create policy message_attachments_select_membro
  on central.message_attachments for select to authenticated
  using (exists (
    select 1
    from central.messages m
    join central.conversations c on c.id = m.conversation_id
    where m.id = message_id
      and c.inbox_id in (select central.ca_minhas_inboxes())
  ));

-- Contato: visível a quem tem ao menos uma conversa com ele numa inbox sua.
create policy contacts_select_membro
  on central.contacts for select to authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from central.conversations c
      where c.contact_id = central.contacts.id
        and c.inbox_id in (select central.ca_minhas_inboxes())
    )
  );

insert into supabase_migrations.schema_migrations (version, name)
values ('20260924180200', 'central_rls_membros_inbox')
on conflict (version) do nothing;

commit;

-- ============================================================================
-- 20260924180300_central_provider_webhook_logs
-- ============================================================================
begin;
set local lock_timeout = '5s';

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

insert into supabase_migrations.schema_migrations (version, name)
values ('20260924180300', 'central_provider_webhook_logs')
on conflict (version) do nothing;

commit;

-- ============================================================================
-- Conferência
-- ============================================================================
select 'livro-caixa' as o_que, string_agg(version, ', ' order by version) as valor
  from supabase_migrations.schema_migrations
 where version between '20260924180000' and '20260924180300'
union all
select 'trigger sem IA', count(*)::text from pg_trigger where tgname = 'trg_evolution_sem_ia'
union all
select 'policies por membro', count(*)::text from pg_policies
 where schemaname = 'central' and policyname like '%\_membro'
union all
select 'rpc criar_canal_evolution', count(*)::text from pg_proc where proname = 'criar_canal_evolution'
union all
select 'tabela de log', count(*)::text from pg_tables where schemaname = 'central' and tablename = 'provider_webhook_logs';
-- Esperado: as 4 versões, 1, 8, 1, 1.
