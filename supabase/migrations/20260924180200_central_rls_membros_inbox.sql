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
