-- Central — atendentes da caixa leem o catálogo de tags
--
-- APLICA a migration 20261019150000 e a registra no livro-caixa. Snippet e não
-- `db push` (histórico de migrations dessincronizado). Reexecutável.
--
-- Pode ser aplicado a qualquer momento: nenhuma mudança de código depende dele.
--
-- O que muda no banco:
--   • Nova policy de SELECT em central.tag_definitions para membro de alguma
--     caixa (central.ca_minhas_inboxes). Antes só admin/director liam.
--   • Escrita no catálogo continua só de admin.

begin;
set local lock_timeout = '5s';

drop policy if exists tag_definitions_select_membro on central.tag_definitions;

create policy tag_definitions_select_membro
  on central.tag_definitions
  for select
  to authenticated
  using (
    organization_id = (select central.current_organization_id())
    and exists (select 1 from central.ca_minhas_inboxes())
  );

notify pgrst, 'reload schema';

insert into supabase_migrations.schema_migrations (version, name)
values ('20261019150000', 'central_tag_definitions_select_membro')
on conflict (version) do nothing;

commit;
