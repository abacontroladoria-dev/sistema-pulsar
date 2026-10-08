-- Acesso à /connect/inbox — só o número "Confirmação de Consulta" (final 6366, Evolution)
--   Aída Raphaela (comercial) e Danielle Menezes (recepcao). A Jeniffer
--   (atendimento6@) já é membro; a Jenifer (atendente.universoaba@) NÃO entra.
--
-- A permissão `connect` se libera pela tela (/admin/permissoes). Faltam as duas
-- camadas sem tela (ver 20260928_acesso_connect_pamela_APLICAR.sql):
--   1. central_role = 'operator': sem ele /api/central/* responde 401 e a pessoa
--      nem aparece na janela "Membros".
--   2. Membro APENAS do número "Confirmação de Consulta".
--
-- Depois de rodar, cada uma precisa SAIR E ENTRAR de novo (central_role vai no token).
-- Reexecutável.

begin;

update public.usuarios
   set central_role = 'operator'
 where id in (
   '056a160c-67d6-4bcf-b944-d485d10bb212',   -- Aída Raphaela
   'aee38faf-c6d4-4b3c-bfc3-e18b3a7321df'    -- Danielle Menezes
 )
   and central_role is null;

insert into central.inbox_members (organization_id, inbox_id, user_id)
select 'a0000000-0000-0000-0000-000000000001', '03fc0378-d34f-49ec-8145-e8d0353bf289', u   -- Confirmação de Consulta
  from unnest(array[
    '056a160c-67d6-4bcf-b944-d485d10bb212',
    'aee38faf-c6d4-4b3c-bfc3-e18b3a7321df'
  ]::uuid[]) u
on conflict (inbox_id, user_id) do nothing;

commit;

-- CONFERÊNCIA — ESPERADO: 2 linhas, central_role = operator, numero "Confirmação de Consulta".
select u.nome, u.central_role, i.name as numero
  from public.usuarios u
  left join central.inbox_members m on m.user_id = u.id
  left join central.inboxes i on i.id = m.inbox_id
 where u.id in (
   '056a160c-67d6-4bcf-b944-d485d10bb212',
   'aee38faf-c6d4-4b3c-bfc3-e18b3a7321df'
 );
