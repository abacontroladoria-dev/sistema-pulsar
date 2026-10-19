-- ============================================================================
-- Central: quem atende na caixa lê o catálogo de tags
--
-- O QUE ESTAVA ERRADO
--
-- `tag_definitions_select` (20260701010200) exige central_role admin ou
-- director. As atendentes (operator) veem o contato e a conversa pelas
-- policies de membro (20260924180200), com as chaves em contacts.tags e
-- conversations.tags — mas o catálogo que traduz a chave em rótulo e cor
-- voltava vazio. No painel da /connect/inbox as tags apareciam como chave crua
-- em cinza, o "+" ficava desabilitado e o filtro por tag não tinha opções.
--
-- O QUE MUDA
--
-- Policy de SELECT para quem é membro de alguma caixa da organização. Só
-- leitura: criar, editar e apagar tag do catálogo continua sendo de admin.
-- Não basta conferir a organização — todo usuário do Pulsar tem a org da
-- Central; o portão é a caixa (central.ca_minhas_inboxes).
--
-- ROLLBACK REFERENCE
--   drop policy if exists tag_definitions_select_membro on central.tag_definitions;
--
-- Depends on:
--   20260924180200_central_rls_membros_inbox.sql  (central.ca_minhas_inboxes)
-- ============================================================================

drop policy if exists tag_definitions_select_membro on central.tag_definitions;

create policy tag_definitions_select_membro
  on central.tag_definitions
  for select
  to authenticated
  using (
    organization_id = (select central.current_organization_id())
    and exists (select 1 from central.ca_minhas_inboxes())
  );
