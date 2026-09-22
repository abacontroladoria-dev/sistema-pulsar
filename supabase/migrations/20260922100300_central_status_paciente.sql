-- Tags automáticas da Maia — Passo 5: status operacional do paciente
-- (paciente_ativo / paciente_inativo), pré-computado.
--
-- Cobre os dois sub-tipos de TIPO DE CONTATO que dependem de dado
-- estruturado do TITA, não de interpretação da conversa. Confirmado com o
-- usuário: o SISTEMA calcula isso, a Maia não adivinha.
--
-- Duas peças:
--   1. Resolução automática de contato → paciente por telefone (não existia
--      antes: central.contact_patient_links só nascia por ato manual).
--   2. Recálculo diário de ativo/inativo, cruzando csv_grades_profissionais
--      por paciente_id, com histórico completo desde 2026-01-01 (a tabela
--      tem esse histórico — ver scripts/importar-backup-grade.js) e
--      excluindo terapias de Processo Diagnóstico (avaliação pontual, não
--      tratamento contínuo) por terapia_id — nunca por nome.
--
-- PROCESSO_DIAGNOSTICO_IDS = {2268, 2695, 2270} espelha
-- frontend/lib/cronograma/constants.ts (Avaliação Neuropsicológica,
-- Psiquiatra/Neurologista, Triagem) — fonte de verdade oficial do projeto
-- para essa distinção. Se aquele arquivo mudar, esta migration precisa
-- acompanhar (não há como importar TS de dentro do banco).

-- ============================================================================
-- TABLE: central.contact_patient_status
--
-- Resultado pré-computado, para a tag nunca ser calculada na leitura (pedido
-- explícito do usuário — performance). Uma linha por contato: se ele tem mais
-- de um paciente vinculado (irmãos), o status é OU do conjunto — "ativo" se
-- qualquer um dos vinculados está ativo.
-- ============================================================================
create table if not exists central.contact_patient_status (
  id                uuid        primary key default gen_random_uuid(),
  organization_id   uuid        not null references central.organizations(id),
  contact_id        uuid        not null references central.contacts(id) on delete cascade,
  tita_paciente_id  bigint,
  status            text        not null check (status in ('ativo', 'inativo')),
  computed_at       timestamptz not null default now(),
  constraint uq_contact_patient_status unique (contact_id)
);

create index if not exists idx_contact_patient_status_org
  on central.contact_patient_status (organization_id);

alter table central.contact_patient_status enable row level security;

create policy contact_patient_status_select
  on central.contact_patient_status
  for select
  to authenticated
  using (
    organization_id = central.current_organization_id()
    and central.ca_current_role() in ('admin', 'director')
  );

-- Sem policy de INSERT/UPDATE/DELETE para `authenticated`: só
-- central.recalcular_status_pacientes() escreve aqui, como SECURITY DEFINER.

-- ============================================================================
-- FUNCTION: central.resolver_vinculo_paciente_por_telefone
--
-- Casa o telefone do contato (central.contacts.display_phone, E.164) contra
-- public.responsaveis.celular / telefone_residencial pelos últimos 8 dígitos
-- — não por igualdade estrita: o dado de origem é sujo (a própria migration
-- de responsaveis, 20260826100200, admite isso no comentário de cpf).
--
-- Ambíguo (mais de um responsável bate) → não arrisca vínculo automático,
-- fica para resolução manual. É a mesma régua que contact_patient_links já
-- previa em confidence_score (>= 0.90 automático) desde 20260701000400.
--
-- Um responsável pode ter mais de um paciente (irmãos) — todos entram.
-- ============================================================================
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
begin
  select * into v_contact from central.contacts where id = p_contact_id;
  if not found or v_contact.display_phone is null then
    return;
  end if;

  v_ultimos8 := right(regexp_replace(v_contact.display_phone, '\D', '', 'g'), 8);
  if length(v_ultimos8) < 8 then
    return;
  end if;

  select array_agg(id) into v_responsavel_ids
  from public.responsaveis
  where right(regexp_replace(coalesce(celular, ''), '\D', '', 'g'), 8) = v_ultimos8
     or right(regexp_replace(coalesce(telefone_residencial, ''), '\D', '', 'g'), 8) = v_ultimos8;

  if v_responsavel_ids is null or array_length(v_responsavel_ids, 1) <> 1 then
    return;
  end if;

  insert into central.contact_patient_links
    (organization_id, contact_id, tita_paciente_id, relationship_type, confidence_score, resolved_by, resolved_at)
  select
    v_contact.organization_id, v_contact.id, p.tita_paciente_id, 'guardian', 0.90, 'automatic', now()
  from public.pacientes_responsaveis pr
  join public.pacientes p on p.id_paciente = pr.paciente_id
  where pr.responsavel_id = v_responsavel_ids[1]
    and p.tita_paciente_id is not null
  on conflict (contact_id, tita_paciente_id) do nothing;
end;
$$;

comment on function central.resolver_vinculo_paciente_por_telefone(uuid) is
  'Casa contato->paciente por telefone (últimos 8 dígitos) contra public.responsaveis. Ambíguo = não vincula. Chamada pelo trigger trg_resolver_vinculo_paciente e reaproveitável manualmente para backfill.';

create or replace function central.trg_resolver_vinculo_paciente()
returns trigger
language plpgsql
security definer
set search_path = public, central
as $$
begin
  begin
    perform central.resolver_vinculo_paciente_por_telefone(new.id);
  exception when others then
    -- Um matching que falha nunca pode derrubar a criação do contato — é o
    -- primeiro contato de uma conversa nova chegando pelo WhatsApp.
    raise warning 'resolver_vinculo_paciente_por_telefone falhou para contact %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_resolver_vinculo_paciente on central.contacts;
create trigger trg_resolver_vinculo_paciente
  after insert on central.contacts
  for each row
  when (new.display_phone is not null)
  execute function central.trg_resolver_vinculo_paciente();

-- ============================================================================
-- FUNCTION: central.recalcular_status_pacientes
--
-- Roda uma vez por dia via cron, depois que os dois syncs de grade da manhã
-- já terminaram (grade futura 03:20 BRT, execução passada ~04:00 BRT). Para
-- cada contato com vínculo de paciente:
--
--   "primeira semana completa do mês seguinte a HOJE" tem sessão (fora de
--   Processo Diagnóstico)          → ativo
--   sem isso, mas tem histórico desde 2026-01-01 (fora de Processo
--   Diagnóstico)                   → inativo
--   nenhum dos dois                → não grava linha (não é nem um nem outro
--                                     — TIPO DE CONTATO segue por conta da
--                                     Maia/humano, ver agente/tags.ts)
--
-- Sincroniza o resultado em central.contacts.tags e em
-- central.conversations.tags das conversas ainda ativas do contato — é ali
-- que a ferramenta registrar_tags e o painel leem a tag, nunca recalculando
-- na hora (pedido explícito do usuário).
-- ============================================================================
create or replace function central.recalcular_status_pacientes(p_organization_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public, central
as $$
declare
  v_prim_sem_ini date := (date_trunc('month', current_date + interval '1 month'))::date;
  v_prim_sem_fim date := v_prim_sem_ini + 6;
  v_atualizados  integer := 0;
  r              record;
  v_status       text;
  v_tag_certa    text;
begin
  for r in
    select
      cpl.organization_id,
      cpl.contact_id,
      bool_or(
        exists (
          select 1 from public.csv_grades_profissionais g
          where g.paciente_id = cpl.tita_paciente_id
            and g.data between v_prim_sem_ini and v_prim_sem_fim
            and (g.terapia_id is null or g.terapia_id not in (2268, 2695, 2270))
        )
      ) as tem_futuro,
      bool_or(
        exists (
          select 1 from public.csv_grades_profissionais g
          where g.paciente_id = cpl.tita_paciente_id
            and g.data >= date '2026-01-01'
            and g.data <= current_date
            and (g.terapia_id is null or g.terapia_id not in (2268, 2695, 2270))
        )
      ) as tem_historico,
      min(cpl.tita_paciente_id) as algum_tita_paciente_id
    from central.contact_patient_links cpl
    where p_organization_id is null or cpl.organization_id = p_organization_id
    group by cpl.organization_id, cpl.contact_id
  loop
    v_status := case when r.tem_futuro then 'ativo' when r.tem_historico then 'inativo' else null end;
    if v_status is null then
      continue;
    end if;

    insert into central.contact_patient_status
      (organization_id, contact_id, tita_paciente_id, status, computed_at)
    values
      (r.organization_id, r.contact_id, r.algum_tita_paciente_id, v_status, now())
    on conflict (contact_id) do update
      set status           = excluded.status,
          tita_paciente_id = excluded.tita_paciente_id,
          computed_at      = excluded.computed_at;

    v_tag_certa := case when v_status = 'ativo' then 'paciente_ativo' else 'paciente_inativo' end;

    -- Sempre grava o estado final (idempotente), em vez de só atualizar
    -- quando muda: mais simples que comparar antes/depois, e o custo é uma
    -- linha por contato vinculado, uma vez por dia.
    update central.contacts
      set tags = array_append(
        array_remove(array_remove(coalesce(tags, '{}'), 'paciente_ativo'), 'paciente_inativo'),
        v_tag_certa
      )
      where id = r.contact_id;

    update central.conversations
      set tags = array_append(
        array_remove(array_remove(coalesce(tags, '{}'), 'paciente_ativo'), 'paciente_inativo'),
        v_tag_certa
      )
      where contact_id = r.contact_id
        and status not in ('resolved', 'archived');

    v_atualizados := v_atualizados + 1;
  end loop;

  return v_atualizados;
end;
$$;

comment on function central.recalcular_status_pacientes(uuid) is
  'Recalcula paciente_ativo/paciente_inativo para todo contato vinculado e sincroniza em contacts.tags e conversations.tags (conversas ativas). Chamada pelo cron central-recalcular-status-pacientes-daily, 04:30 BRT. p_organization_id null = todas as organizações.';

select cron.schedule(
  'central-recalcular-status-pacientes-daily',
  '30 7 * * *',
  $cron$ select central.recalcular_status_pacientes(); $cron$
);
