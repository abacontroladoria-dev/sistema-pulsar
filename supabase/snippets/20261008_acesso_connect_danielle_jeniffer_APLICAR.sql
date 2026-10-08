-- Acesso da Danielle Menezes e da Jeniffer (jeniffergoncalves), role recepcao,
-- à /connect/inbox — só o número "Confirmação de Consulta" (o 6366, na Evolution
-- enquanto a Meta não libera o número definitivo).
--
-- As três camadas (ver 20260928_acesso_connect_pamela_APLICAR.sql):
--   1. permissão `connect` (ajuste individual; o grupo Recepção não tem);
--   2. central_role = 'operator' (sem ele /api/central/* responde 401);
--   3. membro APENAS do número "Confirmação de Consulta".
--
-- Depois de rodar, elas precisam SAIR E ENTRAR de novo (central_role vai no token).
-- Reexecutável.

begin;

insert into public.usuarios_permissoes (usuario_id, permissao_codigo, permitido)
values
  ('1e459b5f-77f5-44c2-8dbe-9c103f154146', 'connect', true),   -- Danielle Menezes
  ('4911bf00-b3f2-41fa-81bb-5dc089128590', 'connect', true)    -- Jeniffer
on conflict (usuario_id, permissao_codigo) do update set permitido = true;

update public.usuarios
   set central_role = 'operator'
 where id in ('1e459b5f-77f5-44c2-8dbe-9c103f154146', '4911bf00-b3f2-41fa-81bb-5dc089128590')
   and central_role is null;

insert into central.inbox_members (organization_id, inbox_id, user_id)
values
  ('a0000000-0000-0000-0000-000000000001', '03fc0378-d34f-49ec-8145-e8d0353bf289', '1e459b5f-77f5-44c2-8dbe-9c103f154146'),
  ('a0000000-0000-0000-0000-000000000001', '03fc0378-d34f-49ec-8145-e8d0353bf289', '4911bf00-b3f2-41fa-81bb-5dc089128590')
on conflict (inbox_id, user_id) do nothing;

commit;

-- CONFERÊNCIA — ESPERADO: 2 linhas, operator, "Confirmação de Consulta", connect = true.
select u.nome, u.central_role, i.name as numero, p.permitido as connect
  from public.usuarios u
  left join central.inbox_members m on m.user_id = u.id
  left join central.inboxes i on i.id = m.inbox_id
  left join public.usuarios_permissoes p on p.usuario_id = u.id and p.permissao_codigo = 'connect'
 where u.id in ('1e459b5f-77f5-44c2-8dbe-9c103f154146', '4911bf00-b3f2-41fa-81bb-5dc089128590');
