-- CRM — o funil também lê as tags do CONTATO (as que a equipe marca)
--
-- APLICA a migration 20260930110000 e registra no livro-caixa. Snippet e não
-- `db push` (ver reference_db_push_blast_radius). Depende da 20260930100000,
-- já aplicada em 28/09. Reexecutável.
--
-- lock_timeout: cria gatilho em central.contacts. Se estourar os 5s, rode de novo.

begin;
set local lock_timeout = '5s';

-- ============================================================================
-- CRM — o funil também lê as tags do CONTATO
--
-- As tags moram em dois lugares:
--   - central.conversations.tags → as que a Maia aplica (registrar_tags);
--   - central.contacts.tags      → as que a equipe marca no painel da inbox
--                                  (e agora na gaveta do funil).
--
-- 20260930100000 só olhava a conversa. Resultado: alguém da equipe marcava
-- "Convênio Credenciado" à mão e o card continuava sem trilha — a mesma
-- informação, dita por uma pessoa, valia menos do que dita pela Maia.
--
-- A regra sai da função do gatilho e vira crm.aplicar_tags_no_funil(), chamada
-- pelos DOIS gatilhos. Uma regra só: se um dia mudar o que "Convênio" quer
-- dizer para o funil, muda num lugar.
--
-- A regra em si não muda:
--   - PAGAMENTO define a trilha uma vez (particular/reembolso → particular;
--     convenio_credenciado → convenio); trilha já definida não é sobrescrita;
--   - tag nao_paciente_* RECÉM-aplicada leva a "Não qualificado" enquanto o
--     card está em Novo / Em qualificação.
-- ============================================================================

create or replace function crm.aplicar_tags_no_funil(
  p_org     uuid,
  p_contato uuid,
  p_novas   text[],
  p_antigas text[],
  p_quem    text   -- 'Maia' | 'equipe' — só para a frase da timeline
)
returns void
language plpgsql
security definer
set search_path = crm, central, public
as $$
declare
  v_deal       crm.deals%rowtype;
  v_slug_atual text;
  v_trilha     text;
  v_destino    uuid;
  v_rotulo     text;
begin
  select d.* into v_deal
    from crm.deals d
   where d.organization_id = p_org
     and d.contact_id = p_contato
     and d.status = 'open';
  if not found then
    return;
  end if;

  if v_deal.trilha is null then
    v_trilha := case
      when p_novas && array['convenio_credenciado']     then 'convenio'
      when p_novas && array['particular', 'reembolso'] then 'particular'
    end;
    if v_trilha is not null then
      update crm.deals set trilha = v_trilha where id = v_deal.id;
      insert into crm.deal_activities (organization_id, deal_id, type, title, created_by_ai)
      values (p_org, v_deal.id, 'status_change',
              'Trilha definida pela ' || p_quem || ': '
                || case v_trilha when 'convenio' then 'Convênio' else 'Particular' end,
              true);
    end if;
  end if;

  select t.label into v_rotulo
    from unnest(p_novas) as tag(key)
    join central.tag_definitions t
      on t.organization_id = p_org and t.key = tag.key
   where tag.key like 'nao_paciente\_%'
     and not (coalesce(p_antigas, '{}') @> array[tag.key])
   limit 1;

  if v_rotulo is not null then
    select s.slug into v_slug_atual from crm.pipeline_stages s where s.id = v_deal.stage_id;
    select s.id into v_destino
      from crm.pipeline_stages s
     where s.organization_id = p_org and s.slug = 'nao_qualificado' and s.is_active;

    if v_destino is not null and v_slug_atual in ('novo', 'em_qualificacao') then
      update crm.deals
         set stage_id      = v_destino,
             status        = 'lost',
             closed_at     = now(),
             closed_reason = v_rotulo,
             motivo        = v_rotulo
       where id = v_deal.id;
      insert into crm.deal_activities (organization_id, deal_id, type, title, created_by_ai)
      values (p_org, v_deal.id, 'status_change',
              'Movido para "Não qualificado" pela ' || p_quem || ' (' || v_rotulo || ')', true);
    end if;
  end if;
end;
$$;

revoke all on function crm.aplicar_tags_no_funil(uuid, uuid, text[], text[], text) from public, anon, authenticated;

-- Gatilho da conversa (Maia): agora só delega.
create or replace function crm.funil_pelas_tags()
returns trigger
language plpgsql
security definer
set search_path = crm, central, public
as $$
begin
  perform crm.aplicar_tags_no_funil(new.organization_id, new.contact_id, new.tags, old.tags, 'Maia');
  return new;
exception when others then
  -- Nunca derruba a gravação das tags.
  raise warning '[crm] funil não atualizado pelas tags da conversa %: %', new.id, sqlerrm;
  return new;
end;
$$;

-- Gatilho do contato (equipe).
create or replace function crm.funil_pelas_tags_do_contato()
returns trigger
language plpgsql
security definer
set search_path = crm, central, public
as $$
begin
  perform crm.aplicar_tags_no_funil(new.organization_id, new.id, new.tags, old.tags, 'equipe');
  return new;
exception when others then
  raise warning '[crm] funil não atualizado pelas tags do contato %: %', new.id, sqlerrm;
  return new;
end;
$$;

revoke all on function crm.funil_pelas_tags_do_contato() from public, anon, authenticated;

drop trigger if exists funil_pelas_tags_do_contato on central.contacts;
create trigger funil_pelas_tags_do_contato
  after update of tags on central.contacts
  for each row
  when (new.tags is distinct from old.tags)
  execute function crm.funil_pelas_tags_do_contato();

insert into supabase_migrations.schema_migrations (version, name)
values ('20260930110000', 'crm_funil_tags_do_contato')
on conflict (version) do nothing;

commit;

-- CONFERÊNCIA — ESPERADO: 4 linhas (os dois gatilhos de tags + os dois do 20260930100000).
select tgname, tgrelid::regclass
  from pg_trigger
 where tgname in ('criar_negocio_na_conversa_nova', 'funil_pelas_tags', 'funil_pelas_tags_do_contato', 'marcar_troca_de_estagio');
