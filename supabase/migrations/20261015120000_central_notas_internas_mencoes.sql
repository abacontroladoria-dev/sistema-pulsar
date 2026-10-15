-- ============================================================================
-- Central: notas internas da conversa e menções a usuários (@)
--
-- O QUE FALTAVA
--
-- O inbox (/connect/inbox) só tinha mensagens — e toda mensagem vai para o
-- WhatsApp do contato (MessageService.send). Quem precisava passar a conversa a
-- uma colega com contexto ("@Danielle, a mãe pediu retorno sobre o laudo") não
-- tinha onde escrever: a transferência existe, mas o motivo fica só na trilha
-- de auditoria e ninguém é avisado.
--
-- O QUE ESTA MIGRATION CRIA
--
--   central.conversation_notes     a nota em si. NUNCA passa por
--                                  central.messages: tabela própria é o que
--                                  garante, por construção, que nenhum caminho
--                                  de envio (worker, provider, Maia) a enxerga.
--
--   central.conversation_mentions  uma linha por pessoa mencionada — a caixa
--                                  "Menções a mim" e o aviso da página inicial.
--                                  `lida_em` nulo = não lida.
--
-- QUEM LÊ
--
-- Nota: o mesmo recorte das mensagens — admin/director da organização, ou
-- membro da caixa (inbox) da conversa. Quem não vê a conversa não vê a nota.
--
-- Menção: só a pessoa mencionada, e só enquanto ela ainda enxerga a conversa.
-- Perder acesso à caixa apaga o aviso junto — senão a lista mostraria o trecho
-- de uma conversa que a pessoa não consegue mais abrir.
--
-- QUEM GRAVA
--
-- Ninguém pelo navegador. INSERT/UPDATE/DELETE saem de `authenticated` e
-- `anon`; a rota grava com service role DEPOIS de conferir o acesso com o
-- client do usuário (a mesma forma de message_attachments e da auditoria).
-- Assim a RLS de escrita não precisa existir — e não há policy de escrita que
-- alguém esqueça de restringir por coluna.
--
-- ATENÇÃO: o event trigger rls_auto_enable só cobre o schema `public`, e o
-- ALTER DEFAULT PRIVILEGES de 20260701000000 já dá CRUD a `authenticated` em
-- toda tabela nova de `central`. Os `enable row level security` e os `revoke`
-- abaixo NÃO são redundantes — ver 20260916140000_central_tasks.sql.
--
-- DESEMPENHO: as funções vão embrulhadas em `(select ...)` (initplan). A nota
-- é lida no mesmo tique de 5s do detalhe da conversa, e o contador de menções
-- a cada 30s por aba aberta.
--
-- ROLLBACK REFERENCE (ordem inversa):
--   drop table if exists central.conversation_mentions;
--   drop table if exists central.conversation_notes;
--
-- Depends on:
--   20260701000500_create_ca_conversations.sql  (central.conversations)
--   20260701000700_create_ca_rls_helpers.sql    (current_organization_id, ca_current_role)
--   20260924180200_central_rls_membros_inbox.sql (central.ca_minhas_inboxes)
-- ============================================================================

-- ============================================================================
-- TABLE: central.conversation_notes
--
--   author_user_id / delegated_to_user_id / mentioned_user_ids — uuid SEM FK
--     para public.usuarios, como central.tasks: nada de `central` referencia o
--     schema public, e a FK impediria desativar quem já escreveu nota.
--
--   mentioned_user_ids — cópia, na própria nota, de quem ela menciona. Existe
--     para a bolha destacar os nomes sem ler conversation_mentions, que só
--     mostra a cada pessoa as menções a ela mesma.
--
--   delegated_to_user_id — a nota que transferiu a conversa. A transferência
--     de fato é a de sempre (ConversationService.transfer, com o evento
--     conversation.transferred); aqui fica só o selo "Delegou para…".
-- ============================================================================
create table if not exists central.conversation_notes (
  id                   uuid        primary key default gen_random_uuid(),
  organization_id      uuid        not null references central.organizations(id),
  conversation_id      uuid        not null references central.conversations(id) on delete cascade,
  author_user_id       uuid        not null,
  body                 text        not null,
  mentioned_user_ids   uuid[]      not null default '{}',
  delegated_to_user_id uuid,
  created_at           timestamptz not null default now(),

  constraint ck_conversation_notes_body
    check (length(btrim(body)) between 1 and 4000),

  -- Só se delega a quem foi mencionado: a pessoa precisa receber o aviso.
  constraint ck_conversation_notes_delegou_mencionado
    check (delegated_to_user_id is null or delegated_to_user_id = any (mentioned_user_ids))
);

create index if not exists idx_conversation_notes_conversa
  on central.conversation_notes (conversation_id, created_at);

-- ============================================================================
-- TABLE: central.conversation_mentions
-- ============================================================================
create table if not exists central.conversation_mentions (
  id                uuid        primary key default gen_random_uuid(),
  organization_id   uuid        not null references central.organizations(id),
  note_id           uuid        not null references central.conversation_notes(id) on delete cascade,
  conversation_id   uuid        not null references central.conversations(id) on delete cascade,
  mentioned_user_id uuid        not null,
  author_user_id    uuid        not null,
  lida_em           timestamptz,
  created_at        timestamptz not null default now(),

  -- Mencionar a si mesmo é permitido: vira lembrete em "Menções a mim".
  constraint uq_conversation_mentions_nota_pessoa unique (note_id, mentioned_user_id)
);

-- O contador do menu e o aviso da página inicial: "minhas não lidas".
create index if not exists idx_conversation_mentions_nao_lidas
  on central.conversation_mentions (mentioned_user_id, created_at desc)
  where lida_em is null;

-- A lista completa (abas Lidas / Todas).
create index if not exists idx_conversation_mentions_pessoa
  on central.conversation_mentions (mentioned_user_id, created_at desc);

-- Abrir a conversa marca como lidas as menções dela.
create index if not exists idx_conversation_mentions_conversa
  on central.conversation_mentions (conversation_id, mentioned_user_id)
  where lida_em is null;

-- ============================================================================
-- Privilégios: navegador só LÊ, e só pelo que a RLS deixar.
-- ============================================================================
revoke all on central.conversation_notes    from anon;
revoke all on central.conversation_mentions from anon;
revoke insert, update, delete, truncate, references, trigger
  on central.conversation_notes    from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on central.conversation_mentions from authenticated;
grant select on central.conversation_notes    to authenticated;
grant select on central.conversation_mentions to authenticated;

-- ============================================================================
-- RLS
-- ============================================================================
alter table central.conversation_notes    enable row level security;
alter table central.conversation_mentions enable row level security;

drop policy if exists conversation_notes_select on central.conversation_notes;
create policy conversation_notes_select
  on central.conversation_notes
  for select
  to authenticated
  using (
    organization_id = (select central.current_organization_id())
    and (
      (select central.ca_current_role()) in ('admin', 'director')
      or exists (
        select 1 from central.conversations c
        where c.id = conversation_id
          and c.inbox_id in (select central.ca_minhas_inboxes())
      )
    )
  );

drop policy if exists conversation_mentions_select on central.conversation_mentions;
create policy conversation_mentions_select
  on central.conversation_mentions
  for select
  to authenticated
  using (
    mentioned_user_id = (select auth.uid())
    and organization_id = (select central.current_organization_id())
    and (
      (select central.ca_current_role()) in ('admin', 'director')
      or exists (
        select 1 from central.conversations c
        where c.id = conversation_id
          and c.inbox_id in (select central.ca_minhas_inboxes())
      )
    )
  );

comment on table central.conversation_notes is
  'Notas internas da conversa no inbox do Connect. O contato NUNCA vê: não passa por central.messages nem por provider algum. Escrita só pela API (service role).';
comment on column central.conversation_notes.mentioned_user_ids is
  'public.usuarios.id de quem a nota menciona (@). Cópia para exibição; o aviso de cada pessoa vive em central.conversation_mentions.';
comment on column central.conversation_notes.delegated_to_user_id is
  'Quando a nota também transferiu a conversa: para quem. A transferência em si é a de ConversationService.transfer.';
comment on table central.conversation_mentions is
  'Uma linha por pessoa mencionada numa nota interna. Alimenta "Menções a mim" e o aviso da página inicial. lida_em nulo = não lida.';

notify pgrst, 'reload schema';
