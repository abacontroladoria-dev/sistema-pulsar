-- ============================================================================
-- Central: quem atende a conversa pode corrigir o contato dela
--
-- O QUE ESTAVA ERRADO
--
-- `contacts_update` (20260701000800) exige central_role admin ou director. As
-- atendentes (operator) VEEM o contato pela `contacts_select_membro`
-- (20260924180200), mas não gravam nada nele — e o painel da /connect/inbox
-- oferece origem, tags e, agora, "Salvar contato" / editar o nome. Para elas o
-- PATCH batia em zero linhas e voltava erro.
--
-- O QUE MUDA
--
-- Policy de UPDATE com o mesmo recorte da leitura: membro de uma caixa que tem
-- conversa com o contato. Quem pode ver pode corrigir — o mesmo raciocínio da
-- ficha (20261001180000).
--
-- O WITH CHECK prende a linha à organização e impede o soft delete
-- (deleted_at) por esse caminho: apagar contato continua sendo de admin.
--
-- ROLLBACK REFERENCE
--   drop policy if exists contacts_update_membro on central.contacts;
--
-- Depends on:
--   20260924180200_central_rls_membros_inbox.sql  (central.ca_minhas_inboxes)
-- ============================================================================

drop policy if exists contacts_update_membro on central.contacts;

create policy contacts_update_membro
  on central.contacts
  for update
  to authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from central.conversations c
      where c.contact_id = central.contacts.id
        and c.inbox_id in (select central.ca_minhas_inboxes())
    )
  )
  with check (
    organization_id = (select central.current_organization_id())
    and deleted_at is null
    and exists (
      select 1 from central.conversations c
      where c.contact_id = central.contacts.id
        and c.inbox_id in (select central.ca_minhas_inboxes())
    )
  );
