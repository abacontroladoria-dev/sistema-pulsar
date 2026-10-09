-- Acesso da Manoela Anjos (role marketing) à /connect/inbox — só o número "Marketing"
--
-- A permissão `connect` já foi liberada em 06/10 pela tela. Faltam as duas
-- camadas sem tela (ver 20260928_acesso_connect_pamela_APLICAR.sql):
--   1. central_role = 'operator': sem ele /api/central/* responde 401.
--      Operator só vê os números de que é membro.
--   2. Membro APENAS do número "Marketing" (Evolution).
--
-- Depois de rodar, ela precisa SAIR E ENTRAR de novo (central_role vai no token).
-- Reexecutável.

begin;

update public.usuarios
   set central_role = 'operator'
 where id = '8eb8471a-148d-43ab-b2a5-baaf0a1fbb0d'   -- Manoela Anjos
   and central_role is null;

insert into central.inbox_members (organization_id, inbox_id, user_id)
values
  ('a0000000-0000-0000-0000-000000000001', 'e3b02389-04e6-43af-86a0-003434b08636', '8eb8471a-148d-43ab-b2a5-baaf0a1fbb0d')  -- Marketing
on conflict (inbox_id, user_id) do nothing;

commit;

-- CONFERÊNCIA — ESPERADO: central_role = operator e 1 linha "Marketing".
select u.nome, u.central_role, i.name as numero
  from public.usuarios u
  left join central.inbox_members m on m.user_id = u.id
  left join central.inboxes i on i.id = m.inbox_id
 where u.id = '8eb8471a-148d-43ab-b2a5-baaf0a1fbb0d';
