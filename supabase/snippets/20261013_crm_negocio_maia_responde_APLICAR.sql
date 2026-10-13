-- Aplica supabase/migrations/20261013160000_crm_negocio_maia_responde.sql e registra no livro-caixa.
begin;
-- ============================================================================
-- CRM — conversa nova no número da Maia vira card, também no Evolution
--
-- Medido em 13/10/2026: crm.deals tinha ZERO linhas. O gatilho de
-- 20260930100000 nunca criou um card, por dois filtros:
--
--   1. `not c.is_provisional`. Todo contato que chega pelo WhatsApp nasce
--      provisório (agrupamento.worker.ts e evolution/ingestao.ts — "criado por
--      uma mensagem, não por cadastro"), e nada o promove. O filtro foi copiado
--      do crm.auto_create_deal_on_lead, que é para lead cadastrado; aqui ele
--      barrava exatamente quem o gatilho existe para pegar. Os 9 contatos do
--      número Meta eram todos provisórios. Sai: bloqueado continua fora.
--
--   2. Número Evolution fora. A regra (28/09) era "nos Evolution não há
--      Maia" — deixou de ser verdade em 08/10, quando a Meta restringiu o envio
--      (erro 130497) e a Maia passou a responder no "Confirmação de Consulta"
--      com `inboxes.maia_automatica`. Evolution continua fora, exceto esse.
--
-- Recuperação: as conversas dos números da Maia com atividade desde
-- 30/09/2026 (entrada do funil) ganham o card que não ganharam. Fica de fora
-- quem só mandou mensagem de template (empresa, não responsável).
-- ============================================================================

create or replace function crm.criar_negocio_na_conversa_nova()
returns trigger
language plpgsql
security definer
set search_path = crm, central, public
as $$
declare
  v_novo    uuid;
  v_nome    text;
  v_deal    uuid;
  v_inseriu boolean;
begin
  -- Evolution é atendimento humano, salvo o número com "Maia responde".
  if exists (
    select 1 from central.channels ch
     where ch.id = new.channel_id and ch.provider = 'evolution'
  ) and not exists (
    select 1 from central.inboxes i
     where i.id = new.inbox_id and i.maia_automatica
  ) then
    return new;
  end if;

  if exists (
    select 1 from central.contact_patient_links l
     where l.contact_id = new.contact_id
       and l.organization_id = new.organization_id
  ) then
    return new;
  end if;

  -- Sem `not is_provisional`: todo contato do WhatsApp é provisório.
  select coalesce(nullif(trim(c.name), ''), c.display_phone, 'Contato sem nome')
    into v_nome
    from central.contacts c
   where c.id = new.contact_id
     and c.status <> 'blocked';
  if not found then
    return new;
  end if;

  select s.id into v_novo
    from crm.pipeline_stages s
   where s.organization_id = new.organization_id
     and s.slug = 'novo'
     and s.is_active;
  if v_novo is null then
    return new;
  end if;

  insert into crm.deals (
    organization_id, contact_id, conversation_id, stage_id,
    title, source, created_by_ai, status, priority
  ) values (
    new.organization_id, new.contact_id, new.id, v_novo,
    v_nome, 'whatsapp', true, 'open', 'medium'
  )
  on conflict (organization_id, contact_id) where status = 'open'
  do update set conversation_id = excluded.conversation_id
  returning id, (xmax = 0) into v_deal, v_inseriu;

  if v_inseriu then
    insert into crm.deal_activities (
      organization_id, deal_id, type, title, created_by_ai
    ) values (
      new.organization_id, v_deal, 'status_change',
      'Entrou no funil em "Novo" (conversa nova no WhatsApp)', true
    );
  end if;

  return new;
exception when others then
  raise warning '[crm] negócio não criado para a conversa %: %', new.id, sqlerrm;
  return new;
end;
$$;

revoke all on function crm.criar_negocio_na_conversa_nova() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Recuperação: um card por contato, apontando para a conversa mais recente.
-- Reexecutável: contato com card aberto é pulado (uq_open_deal_per_contact).
-- ----------------------------------------------------------------------------
with alvo as (
  select distinct on (cv.organization_id, cv.contact_id)
         cv.organization_id, cv.contact_id, cv.id as conversation_id,
         coalesce(nullif(trim(c.name), ''), c.display_phone, 'Contato sem nome') as nome
    from central.conversations cv
    join central.contacts c  on c.id = cv.contact_id
    join central.channels ch on ch.id = cv.channel_id
    left join central.inboxes i on i.id = cv.inbox_id
   where cv.last_message_at >= '2026-09-30'
     and c.status <> 'blocked'
     and (ch.provider <> 'evolution' or coalesce(i.maia_automatica, false))
     and not exists (
       select 1 from central.contact_patient_links l
        where l.contact_id = cv.contact_id and l.organization_id = cv.organization_id
     )
     and exists (
       select 1 from central.messages m
        where m.conversation_id = cv.id
          and m.direction = 'inbound'
          and coalesce(m.body, '') not like '[mensagem do tipo template%'
     )
   order by cv.organization_id, cv.contact_id, cv.last_message_at desc
),
criados as (
  insert into crm.deals (
    organization_id, contact_id, conversation_id, stage_id,
    title, source, created_by_ai, status, priority
  )
  select a.organization_id, a.contact_id, a.conversation_id, s.id,
         a.nome, 'whatsapp', true, 'open', 'medium'
    from alvo a
    join crm.pipeline_stages s
      on s.organization_id = a.organization_id and s.slug = 'novo' and s.is_active
  on conflict (organization_id, contact_id) where status = 'open' do nothing
  returning id, organization_id
)
insert into crm.deal_activities (organization_id, deal_id, type, title, created_by_ai)
select organization_id, id, 'status_change',
       'Entrou no funil em "Novo" (recuperado em 13/10/2026: o gatilho não criava cards)', true
  from criados;

insert into supabase_migrations.schema_migrations (version, name) values ('20261013160000', 'crm_negocio_maia_responde') on conflict (version) do nothing;
commit;
