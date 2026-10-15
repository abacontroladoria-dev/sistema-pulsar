-- Aplica 20261015120000_central_vinculo_pelo_telefone_do_paciente. Ensaio feito em 15/10 (2 vínculos novos; trigger em pacientes conferido).
begin;
set local lock_timeout = '5s';

-- Vínculo contato → paciente também pelo telefone gravado no próprio paciente.
--
-- Caso Tici / Pérola (15/10/2026): a mãe escreveu no número da Maia, a Maia não
-- sabia que a Pérola é paciente, disse "não encontrei nenhum agendamento" e
-- ofereceu marcar sessão nova. O telefone dela estava em
-- pacientes.responsavel_telefone, mas o resolvedor de 20260922100300 só procura
-- em public.responsaveis + pacientes_responsaveis — e essa dupla foi preenchida
-- uma vez só (backfill do legado, 20260828170100). Nenhum dos 52 pacientes
-- cadastrados em outubro tem responsável ali. Resultado: 1 vínculo em 62
-- contatos.
--
-- Duas mudanças:
--   1. O resolvedor procura nas duas fontes. Fonte 1 (responsaveis) segue como
--      era, inclusive "mais de um responsável bate = não vincula". Fonte 2
--      (pacientes.responsavel_telefone) vincula todos os pacientes daquele
--      telefone — irmãos —, desde que sejam do MESMO responsável (CPF, ou nome
--      quando não houver CPF). Telefone de duas pessoas diferentes = ambíguo.
--   2. Trigger em public.pacientes: o contato que escreveu ANTES de a criança
--      ser cadastrada (o lead que virou paciente) nunca era revisto — o trigger
--      de 20260922100300 só roda quando o contato nasce.
--
-- Mesma régua de antes: últimos 8 dígitos, confidence 0.90, resolved_by
-- 'automatic', on conflict do nothing (vínculo existente não muda).

create or replace function central.resolver_vinculo_paciente_por_telefone(p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path = public, central
as $$
declare
  v_contact         central.contacts%rowtype;
  v_ultimos8        text;
  v_responsavel_ids bigint[];
  v_pessoas         integer;
begin
  select * into v_contact from central.contacts where id = p_contact_id;
  if not found
     or v_contact.display_phone is null
     or v_contact.deleted_at is not null
     or v_contact.merged_into_contact_id is not null then
    return;
  end if;

  v_ultimos8 := right(regexp_replace(v_contact.display_phone, '\D', '', 'g'), 8);
  if length(v_ultimos8) < 8 then
    return;
  end if;

  -- Fonte 1: cadastro de responsáveis do Pulsar.
  select array_agg(id) into v_responsavel_ids
  from public.responsaveis
  where right(regexp_replace(coalesce(celular, ''), '\D', '', 'g'), 8) = v_ultimos8
     or right(regexp_replace(coalesce(telefone_residencial, ''), '\D', '', 'g'), 8) = v_ultimos8;

  -- Telefone de mais de um responsável: ambíguo, não vincula por nenhuma fonte.
  if coalesce(array_length(v_responsavel_ids, 1), 0) > 1 then
    return;
  end if;

  if v_responsavel_ids is not null then
    insert into central.contact_patient_links
      (organization_id, contact_id, tita_paciente_id, relationship_type, confidence_score, resolved_by, resolved_at)
    select
      v_contact.organization_id, v_contact.id, p.tita_paciente_id, 'guardian', 0.90, 'automatic', now()
    from public.pacientes_responsaveis pr
    join public.pacientes p on p.id_paciente = pr.paciente_id
    where pr.responsavel_id = v_responsavel_ids[1]
      and p.tita_paciente_id is not null
    on conflict (contact_id, tita_paciente_id) do nothing;
  end if;

  -- Fonte 2: responsável gravado no próprio paciente (vem do sync do TiTa).
  -- Quantas PESSOAS usam este telefone: CPF quando houver, senão o nome.
  -- Sem nenhum dos dois não há como saber se é a mesma pessoa — não conta, e
  -- sem ninguém contado não vincula.
  select count(distinct coalesce(
           nullif(regexp_replace(coalesce(p.responsavel_cpf, ''), '\D', '', 'g'), ''),
           nullif(lower(trim(p.responsavel_nome)), '')))
    into v_pessoas
  from public.pacientes p
  where p.tita_paciente_id is not null
    and right(regexp_replace(coalesce(p.responsavel_telefone, ''), '\D', '', 'g'), 8) = v_ultimos8;

  if v_pessoas <> 1 then
    return;
  end if;

  insert into central.contact_patient_links
    (organization_id, contact_id, tita_paciente_id, relationship_type, confidence_score, resolved_by, resolved_at)
  select
    v_contact.organization_id, v_contact.id, p.tita_paciente_id, 'guardian', 0.90, 'automatic', now()
  from public.pacientes p
  where p.tita_paciente_id is not null
    and right(regexp_replace(coalesce(p.responsavel_telefone, ''), '\D', '', 'g'), 8) = v_ultimos8
  on conflict (contact_id, tita_paciente_id) do nothing;
end;
$$;

comment on function central.resolver_vinculo_paciente_por_telefone(uuid) is
  'Casa contato->paciente por telefone (últimos 8 dígitos) contra public.responsaveis e contra pacientes.responsavel_telefone. Ambíguo = não vincula. Chamada pelos triggers trg_resolver_vinculo_paciente (contacts) e trg_vincular_contatos_do_paciente (pacientes) e reaproveitável para backfill.';

-- ============================================================================
-- Paciente novo (ou telefone do responsável trocado) revê os contatos daquele
-- telefone. Falha aqui nunca pode derrubar o sync do TiTa.
-- ============================================================================
create or replace function central.trg_vincular_contatos_do_paciente()
returns trigger
language plpgsql
security definer
set search_path = public, central
as $$
declare
  v_ultimos8 text;
  v_contact  uuid;
begin
  if tg_op = 'UPDATE'
     and new.responsavel_telefone is not distinct from old.responsavel_telefone
     and new.tita_paciente_id is not distinct from old.tita_paciente_id then
    return new;
  end if;

  v_ultimos8 := right(regexp_replace(coalesce(new.responsavel_telefone, ''), '\D', '', 'g'), 8);
  if new.tita_paciente_id is null or length(v_ultimos8) < 8 then
    return new;
  end if;

  begin
    for v_contact in
      select c.id from central.contacts c
       where c.display_phone is not null
         and c.deleted_at is null
         and c.merged_into_contact_id is null
         and right(regexp_replace(c.display_phone, '\D', '', 'g'), 8) = v_ultimos8
    loop
      perform central.resolver_vinculo_paciente_por_telefone(v_contact);
    end loop;
  exception when others then
    raise warning 'trg_vincular_contatos_do_paciente falhou para paciente %: %', new.id_paciente, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_vincular_contatos_do_paciente on public.pacientes;
create trigger trg_vincular_contatos_do_paciente
  after insert or update of responsavel_telefone, tita_paciente_id on public.pacientes
  for each row
  execute function central.trg_vincular_contatos_do_paciente();

-- ============================================================================
-- Backfill: todo contato vivo passa de novo pelo resolvedor.
-- ============================================================================
select central.resolver_vinculo_paciente_por_telefone(c.id)
  from central.contacts c
 where c.display_phone is not null
   and c.deleted_at is null
   and c.merged_into_contact_id is null;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261015120000', 'central_vinculo_pelo_telefone_do_paciente')
on conflict (version) do nothing;

commit;

-- Conferência
select (select count(*) from central.contact_patient_links) as vinculos,
       exists (select 1 from pg_trigger where tgname = 'trg_vincular_contatos_do_paciente') as trigger_ok;
