-- Acesso da Pamela Rodrigues à /connect/inbox (e ao funil)
--
-- Liberar o módulo `connect` nas permissões só abre a PÁGINA. Os dados vêm de
-- /api/central/*, que exige `public.usuarios.central_role` — e o dela estava
-- NULL, então toda chamada respondia 401 e a inbox abria vazia.
--
-- Dois passos:
--   1. central_role = 'operator': dá acesso à Central e ao funil (o RLS do crm
--      aceita qualquer central_role, 20260930100000). Operator NÃO vê a
--      organização inteira — só os números de que é membro (20260924180200).
--   2. Membro do número "Autorização" (Evolution), que é o da área dela
--      (role = 'autorizacao'). Para dar também o "WhatsApp Recepção", descomente
--      a segunda linha do insert.
--
-- Depois de rodar, a Pamela precisa SAIR E ENTRAR de novo: o central_role vai
-- dentro do token de login (custom access token hook), e o token antigo ainda
-- diz que ela não tem papel.
--
-- Daqui em diante, os números dela se ajustam pela tela
-- (Connect → Configurações → Evolution → membros), onde ela passa a aparecer.
-- Reexecutável.

begin;

update public.usuarios
   set central_role = 'operator'
 where id = '207593d6-54a1-428e-9b71-518d2e5390a9'   -- Pamela Rodrigues
   and central_role is null;

insert into central.inbox_members (organization_id, inbox_id, user_id)
values
  ('a0000000-0000-0000-0000-000000000001', '1afd12a3-7ddf-43a8-86d7-aa0dd2d1b692', '207593d6-54a1-428e-9b71-518d2e5390a9')  -- Autorização
  -- , ('a0000000-0000-0000-0000-000000000001', '15decc63-4cb5-4e7f-8c6f-1b57754ff371', '207593d6-54a1-428e-9b71-518d2e5390a9')  -- WhatsApp Recepção
on conflict (inbox_id, user_id) do nothing;

commit;

-- CONFERÊNCIA — ESPERADO: central_role = operator e 1 linha "Autorização".
select u.nome, u.central_role, i.name as numero
  from public.usuarios u
  left join central.inbox_members m on m.user_id = u.id
  left join central.inboxes i on i.id = m.inbox_id
 where u.id = '207593d6-54a1-428e-9b71-518d2e5390a9';
