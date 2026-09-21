-- Central de Atendimento — Tarefas
--
-- Depends on:
--   20260701000000_create_ca_schema.sql    (schema central, grants, default privileges)
--   20260701000400_create_ca_contacts.sql  (central.contacts)
--   20260701000500_create_ca_conversations.sql (central.conversations)
--   20260701000700_create_ca_rls_helpers.sql   (current_organization_id, ca_current_role)
--
-- O bloco "Tarefas" do painel de detalhamento do inbox: o que ficou pendente
-- com uma pessoa ("retornar sobre a documentação", "ligar para a mãe do João").
-- Nada disso existia — é a única parte do painel sem tabela.
--
-- ============================================================================
-- ROLLBACK REFERENCE (execute em ordem inversa para desfazer):
--
--   drop table if exists central.tasks;
--   drop type  if exists central.task_status;
-- ============================================================================

-- ============================================================================
-- TYPE: central.task_status
--
-- 'cancelled' existe separado de um DELETE porque "decidimos não fazer" é
-- informação: sem ele, a tarefa desaparece e ninguém sabe se foi concluída,
-- abandonada ou apagada por engano.
-- ============================================================================
create type central.task_status as enum ('pending', 'done', 'cancelled');

-- ============================================================================
-- TABLE: central.tasks
--
-- Modelagem:
--
--   contact_id / conversation_id — AMBOS opcionais, com CHECK exigindo ao
--     menos um. Espelha central.appointments. A tarefa é sobre a PESSOA, e por
--     isso o painel a busca por contact_id: amarrá-la só à conversa a faria
--     sumir quando esta fosse resolvida, que é justamente quando a pendência
--     costuma importar. conversation_id fica como o link de volta ao contexto.
--
--   assigned_user_id / created_by — uuid SEM foreign key para public.usuarios.
--     Nenhuma tabela de `central` referencia o schema public (conversations.
--     assigned_user_id também é uuid solto), e uma FK cross-schema aqui
--     impediria desativar um usuário que ainda tem tarefa registrada.
--
--   due_at timestamptz — o prazo é um instante, não uma data: "retornar hoje às
--     17h" é o caso comum de quem atende. Nullable, porque tarefa sem prazo é
--     legítima e exigir um faria inventarem datas.
-- ============================================================================
create table central.tasks (
  id               uuid                 primary key default gen_random_uuid(),
  organization_id  uuid                 not null references central.organizations(id),
  contact_id       uuid                 references central.contacts(id),
  conversation_id  uuid                 references central.conversations(id),
  title            text                 not null,
  description      text,
  assigned_user_id uuid,
  due_at           timestamptz,
  status           central.task_status  not null default 'pending',
  completed_at     timestamptz,
  created_by       uuid                 not null,
  created_at       timestamptz          default now(),
  updated_at       timestamptz          default now(),

  -- Tarefa sem vínculo nenhum não aparece em tela alguma: seria uma linha órfã,
  -- invisível e impossível de fechar.
  constraint ck_tasks_vinculo
    check (contact_id is not null or conversation_id is not null),

  -- Mantém status e completed_at coerentes. Um UPDATE parcial que mude só um
  -- dos dois produziria "concluída sem data" ou "pendente com data de
  -- conclusão" — estados que tornariam qualquer ordenação por conclusão
  -- mentirosa. Cancelada também carimba a data: é quando se decidiu não fazer.
  constraint ck_tasks_conclusao
    check ((status = 'pending') = (completed_at is null)),

  constraint ck_tasks_title_nao_vazio
    check (length(btrim(title)) > 0)
);

drop trigger if exists set_updated_at on central.tasks;
create trigger set_updated_at
  before update on central.tasks
  for each row execute function public.set_updated_at();

-- Índices liderados por organization_id, como o resto do schema: toda consulta
-- é sempre dentro de uma organização, pela RLS.
--
-- Parciais em `status = 'pending'` porque é isso que as telas perguntam ("o que
-- falta fazer com esta pessoa"). Tarefa concluída é histórico e raramente lida.
create index idx_tasks_org_contact
  on central.tasks (organization_id, contact_id)
  where status = 'pending';

create index idx_tasks_org_conversation
  on central.tasks (organization_id, conversation_id)
  where status = 'pending';

-- Para a lista "minhas tarefas em atraso", quando ela existir.
create index idx_tasks_org_assignee_due
  on central.tasks (organization_id, assigned_user_id, due_at)
  where status = 'pending';

-- ============================================================================
-- RLS
--
-- ATENÇÃO — esta linha NÃO é opcional e NÃO é redundante.
--
-- O event trigger public.rls_auto_enable, que liga RLS em toda tabela nova,
-- filtra `cmd.schema_name IN ('public')` (20260518131652_remote_schema.sql) e
-- portanto IGNORA o schema `central`. Ao mesmo tempo, o ALTER DEFAULT
-- PRIVILEGES de 20260701000000 já concedeu select/insert/update/delete a
-- `authenticated` para tabelas futuras deste schema.
--
-- Some-se as duas coisas: sem o comando abaixo, central.tasks nasce LEGÍVEL E
-- GRAVÁVEL por qualquer usuário autenticado da instância, inclusive de outra
-- organização. É o inverso do que acontece em `public`, e por isso é fácil
-- esquecer.
-- ============================================================================
alter table central.tasks enable row level security;

-- Mesma expressão de todas as policies de central.*: organização do JWT e
-- papel na Central. `service_role` não recebe policy — ele bypassa RLS.
create policy tasks_select
  on central.tasks
  for select
  to authenticated
  using (
    organization_id = central.current_organization_id()
    and central.ca_current_role() in ('admin', 'director')
  );

create policy tasks_insert
  on central.tasks
  for insert
  to authenticated
  with check (
    organization_id = central.current_organization_id()
    and central.ca_current_role() in ('admin', 'director')
  );

create policy tasks_update
  on central.tasks
  for update
  to authenticated
  using (
    organization_id = central.current_organization_id()
    and central.ca_current_role() in ('admin', 'director')
  )
  with check (
    organization_id = central.current_organization_id()
    and central.ca_current_role() in ('admin', 'director')
  );

create policy tasks_delete
  on central.tasks
  for delete
  to authenticated
  using (
    organization_id = central.current_organization_id()
    and central.ca_current_role() in ('admin', 'director')
  );

comment on table central.tasks is
  'Pendências de atendimento ligadas a um contato e/ou conversa. Alimenta o bloco Tarefas do painel de detalhamento do inbox.';
comment on column central.tasks.assigned_user_id is
  'public.usuarios.id de quem deve executar. Sem FK: central.* não referencia o schema public.';
comment on column central.tasks.completed_at is
  'Carimbo de saída de "pending" (concluída ou cancelada). Amarrado a status pelo ck_tasks_conclusao.';

notify pgrst, 'reload schema';
