-- ============================================================================
-- Central: a ficha do contato passa a exigir papel na Central ou caixa
--
-- O QUE ESTAVA ERRADO
--
-- As policies de central.contact_intake (20260921180000) conferiam só a
-- organização:
--
--   organization_id = central.current_organization_id()
--
-- Todo usuário do Pulsar tem a organização da Central (default de
-- public.usuarios.organization_id, 20260701000001), e `current_organization_id()`
-- a devolve sem olhar papel. Como o schema `central` está exposto no PostgREST,
-- qualquer usuário logado — terapeuta, recepção, a conta compartilhada de
-- disponibilidade — lia direto do navegador nome da criança, nascimento,
-- responsável e plano de saúde de todos os contatos, e com PATCH trocava o
-- plano, marcava o campo como conferido por humano (`fontes` = 'atendente') e
-- encerrava a coleta da Maia. O `extractUser` da rota da ficha barrava só quem
-- passava pela rota.
--
-- A tabela-mãe `central.contacts` já exigia admin/director (20260701000800) ou
-- ser membro de uma caixa com conversa com o contato (20260924180200). A ficha
-- era mais aberta que o próprio contato.
--
-- O QUE MUDA
--
-- As três policies passam a exigir, além da organização, um destes:
--   • central_role admin ou director — a organização inteira, como em contacts;
--   • ser membro de uma caixa que tenha conversa com o contato — o operador
--     que atende a conversa, que é para quem a ficha existe (o motivo da
--     "leitura mais ampla" registrado na 20260921180000 continua atendido).
--
-- É o mesmo recorte de `contacts_select_membro`, então quem vê o contato vê a
-- ficha, e quem não vê o contato não vê a ficha.
--
-- Nada muda para a Maia: o worker grava com service role, que contorna RLS.
-- Nada muda no código: a rota já exige papel na Central (extractUser) e já
-- consulta com o client do usuário. Pode ser aplicada a qualquer momento.
--
-- DESEMPENHO: chamadas embrulhadas em `(select ...)` para o Postgres avaliá-las
-- uma vez por consulta (initplan), como em 20260924180200. Toda leitura da
-- rota é por contact_id (PK), então o EXISTS roda para uma linha só.
--
-- ROLLBACK REFERENCE
--   Recriar as três policies só com `organization_id =
--   central.current_organization_id()`, como na 20260921180000 — o que REABRE a
--   falha descrita acima. Prefira corrigir para frente.
--
-- Depends on:
--   20260921180000_central_ficha_contato.sql      (a tabela e as policies)
--   20260924180200_central_rls_membros_inbox.sql  (central.ca_minhas_inboxes)
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

-- INSERT e UPDATE existem para a correção manual pelo painel, com a sessão do
-- atendente. Mesmo recorte da leitura: quem pode ver a ficha pode corrigi-la.
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
