-- Central — ficha do contato (central.contact_intake) exige papel ou caixa
--
-- APLICA a migration 20261001180000 e a registra no livro-caixa. Snippet e não
-- `db push` (histórico de migrations dessincronizado). Reexecutável.
--
-- Pode ser aplicado a qualquer momento: nenhuma mudança de código depende dele.
-- A rota da ficha já exige papel na Central e a Maia grava com service role.
--
-- O que muda no banco:
--   • cin_select / cin_insert / cin_update passam a exigir, além da
--     organização, central_role admin/director OU ser membro de uma caixa com
--     conversa com o contato — o mesmo recorte de central.contacts.
--   • Antes, qualquer usuário logado do Pulsar lia e alterava a ficha (nome da
--     criança, nascimento, responsável, plano) direto pela API do banco.
--
-- Não apaga nem altera nenhuma ficha.

begin;
set local lock_timeout = '5s';

-- ============================================================================
-- 20261001180000_central_ficha_rls_por_papel
-- ============================================================================

drop policy if exists cin_select on central.contact_intake;
drop policy if exists cin_insert on central.contact_intake;
drop policy if exists cin_update on central.contact_intake;

create policy cin_select
  on central.contact_intake
  for select
  to authenticated
  using (
    organization_id = (select central.current_organization_id())
    and (
      (select central.ca_current_role()) in ('admin', 'director')
      or exists (
        select 1 from central.conversations c
        where c.contact_id = central.contact_intake.contact_id
          and c.inbox_id in (select central.ca_minhas_inboxes())
      )
    )
  );

create policy cin_insert
  on central.contact_intake
  for insert
  to authenticated
  with check (
    organization_id = (select central.current_organization_id())
    and (
      (select central.ca_current_role()) in ('admin', 'director')
      or exists (
        select 1 from central.conversations c
        where c.contact_id = central.contact_intake.contact_id
          and c.inbox_id in (select central.ca_minhas_inboxes())
      )
    )
  );

create policy cin_update
  on central.contact_intake
  for update
  to authenticated
  using (
    organization_id = (select central.current_organization_id())
    and (
      (select central.ca_current_role()) in ('admin', 'director')
      or exists (
        select 1 from central.conversations c
        where c.contact_id = central.contact_intake.contact_id
          and c.inbox_id in (select central.ca_minhas_inboxes())
      )
    )
  )
  with check (
    organization_id = (select central.current_organization_id())
    and (
      (select central.ca_current_role()) in ('admin', 'director')
      or exists (
        select 1 from central.conversations c
        where c.contact_id = central.contact_intake.contact_id
          and c.inbox_id in (select central.ca_minhas_inboxes())
      )
    )
  );

notify pgrst, 'reload schema';

insert into supabase_migrations.schema_migrations (version, name)
values ('20261001180000', 'central_ficha_rls_por_papel')
on conflict (version) do nothing;

commit;

-- ============================================================================
-- CONFERÊNCIA — se passa por dois usuários e conta quantas fichas cada um vê.
--
-- Só lê: troca de papel e de token com SET LOCAL, que se desfaz no commit. As
-- contagens ficam guardadas em variáveis da sessão e aparecem na última linha,
-- porque o SQL Editor só mostra o resultado da última consulta.
--
-- ESPERADO:
--   sem_papel_esperado_0       = 0      (antes da correção era = total)
--   admin_esperado_igual_total = total
-- Com a tabela vazia, as três dão 0 e a conferência não prova nada.
-- ============================================================================

begin;
select set_config('conf_ficha.total', (select count(*)::text from central.contact_intake), false);
select set_config('conf_ficha.org',
  coalesce((select organization_id::text from central.contact_intake limit 1), ''), false);

-- 1) logado no Pulsar, sem papel na Central e sem caixa — o caso do ataque.
--    O id é inventado: não existe em usuarios nem em inbox_members.
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-0000-0000-000000000000',
  'role', 'authenticated',
  'organization_id', nullif(current_setting('conf_ficha.org'), '')
)::text, true);
set local role authenticated;
select set_config('conf_ficha.sem_papel', (select count(*)::text from central.contact_intake), false);

-- 2) admin da Central.
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-0000-0000-000000000000',
  'role', 'authenticated',
  'organization_id', nullif(current_setting('conf_ficha.org'), ''),
  'central_role', 'admin'
)::text, true);
select set_config('conf_ficha.admin', (select count(*)::text from central.contact_intake), false);
commit;

select current_setting('conf_ficha.total')     as total,
       current_setting('conf_ficha.sem_papel') as sem_papel_esperado_0,
       current_setting('conf_ficha.admin')     as admin_esperado_igual_total;

-- Depois, no inbox (/connect/inbox/), abrir uma conversa e conferir que a
-- "Ficha do paciente" do painel continua aparecendo e que corrigir um campo
-- salva.
