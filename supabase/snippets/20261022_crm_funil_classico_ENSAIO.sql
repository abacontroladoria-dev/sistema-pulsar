-- ENSAIO de 20261022110000_crm_funil_classico: roda a migration inteira e um teste das
-- regras da Maia num card real, e termina em RAISE EXCEPTION com o relatório. Nada fica gravado.
set lock_timeout = '5s';
-- ============================================================================
-- CRM — o funil vira o funil clássico de vendas
--
-- Decisão da diretoria em 22/10/2026: as 17 posições de 28/09 dão lugar às
-- etapas do funil clássico (Prospecção → Qualificação → Apresentação →
-- Negociação), com "Fechamento" trocado por Agendamento e Atendimento depois
-- dele:
--
--   1 Prospecção · 2 Qualificação · 3 Apresentação · 4 Negociação ·
--   5 Agendamento · 6 Atendimento (o ganho)
--   7..11 as cinco perdas de antes, na área "Encerrados", sem mudança.
--
-- O que era posição e não está no funil novo (aguardando elegibilidade,
-- encaminhado para humano, aguardando cronograma, em follow-up) vira DETALHE
-- do card: crm.deals.detalhe + detalhe_desde. O card não muda de coluna por
-- causa dele, e o detalhe sai quando o card anda (marcar_troca_de_estagio).
--
-- A Maia continua mandando os slugs antigos até o redeploy (manual no
-- Coolify). crm.maia_mover_negocio aceita os dois nomes: aplicar esta
-- migration antes ou depois do deploy dá no mesmo.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Detalhe do card
-- ----------------------------------------------------------------------------
alter table crm.deals
  add column if not exists detalhe       text,
  add column if not exists detalhe_desde timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'deals_detalhe_check') then
    alter table crm.deals
      add constraint deals_detalhe_check check (detalhe in (
        'aguardando_elegibilidade', 'encaminhado_humano', 'aguardando_cronograma', 'em_follow_up'
      ));
  end if;
end $$;

comment on column crm.deals.detalhe is
  'Situação do card dentro da coluna: aguardando_elegibilidade | encaminhado_humano | aguardando_cronograma | em_follow_up. Eram posições até 22/10/2026. Some quando o card muda de coluna.';
comment on column crm.deals.detalhe_desde is
  'Quando o detalhe foi marcado. O prazo de 48 horas úteis da elegibilidade conta daqui.';

-- O card que anda perde o detalhe — salvo quando o mesmo update o regrava
-- (a Maia leva para Negociação marcando "aguardando elegibilidade").
create or replace function crm.marcar_troca_de_estagio()
returns trigger
language plpgsql
set search_path = crm, public
as $$
begin
  if new.stage_id is distinct from old.stage_id then
    new.stage_changed_at := now();
    if new.detalhe is not distinct from old.detalhe then
      new.detalhe       := null;
      new.detalhe_desde := null;
    end if;
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. As posições
--
-- As que saem vão para position + 2000 (as do seed de julho já ocupam
-- 1000..1005). As cinco perdas reaproveitam as linhas de 28/09: só a posição
-- muda.
-- ----------------------------------------------------------------------------
update crm.pipeline_stages
   set is_active = false,
       position  = position + 2000
 where slug in (
   'novo', 'em_qualificacao', 'qualificado', 'proposta_apresentada', 'agendado',
   'aguardando_elegibilidade', 'encaminhado_humano', 'entrevista_agendada',
   'compareceu', 'aguardando_cronograma', 'iniciou_tratamento', 'em_follow_up'
 )
   and position < 1000;

-- As perdas saem de 13..17 antes de entrar em 7..11: o índice único de
-- posição não aceita a troca linha a linha.
update crm.pipeline_stages
   set position = position + 3000
 where slug in ('perdido_objecao', 'perdido_nao_elegivel', 'nao_qualificado', 'sem_interesse', 'nunca_respondeu')
   and position < 1000;

with funil (position, slug, title, trilha, color, auto_win, auto_lose, is_system, exige_motivo, description) as (
  values
    ( 1, 'prospeccao',           'Prospecção',             'ambas',    '#64748b', false, false, true,  false, 'Contato novo: abriu conversa, ainda não se sabe se é para a clínica.'),
    ( 2, 'qualificacao',         'Qualificação',           'ambas',    '#6366f1', false, false, false, false, 'Separando quem tem chance real: motivo, laudo, o que já fez, particular ou convênio.'),
    ( 3, 'apresentacao',         'Apresentação',           'ambas',    '#0ea5e9', false, false, false, false, 'Mostrando como a clínica resolve: terapias, equipe, como funciona a avaliação, valores.'),
    ( 4, 'negociacao',           'Negociação',             'ambas',    '#f59e0b', false, false, false, false, 'Valor, horário, documentos do convênio, objeções. Elegibilidade e conversa com a equipe aparecem como detalhe do card.'),
    ( 5, 'agendamento',          'Agendamento',            'ambas',    '#14b8a6', false, false, false, false, 'Avaliação, entrevista ou consulta marcada.'),
    ( 6, 'atendimento',          'Atendimento',            'ambas',    '#22c55e', true,  false, true,  false, 'Veio e começou: é o ganho do funil.'),
    ( 7, 'perdido_objecao',      'Perdido / Objeção',      'ambas',    '#ef4444', false, true,  true,  true,  'Recuou. Motivo em uma frase.'),
    ( 8, 'perdido_nao_elegivel', 'Perdido / Não elegível', 'convenio', '#dc2626', false, true,  true,  true,  'Plano ou diagnóstico fora da regra de credenciamento; família orientada para alternativa (Av. Neuro pelo plano, particular, reembolso).'),
    ( 9, 'nao_qualificado',      'Não qualificado',        'ambas',    '#94a3b8', false, true,  true,  false, 'Fora do escopo: idade, serviço que não temos, não-paciente.'),
    (10, 'sem_interesse',        'Sem interesse',          'ambas',    '#9ca3af', false, true,  true,  false, 'Disse que não quer.'),
    (11, 'nunca_respondeu',      'Nunca respondeu',        'ambas',    '#6b7280', false, true,  true,  false, 'Abriu e sumiu; inclui telefone inativo (anotar o motivo).')
)
insert into crm.pipeline_stages (
  organization_id, position, slug, title, trilha, color,
  auto_win, auto_lose, is_system, exige_motivo, description, is_active
)
select o.organization_id, f.position, f.slug, f.title, f.trilha, f.color,
       f.auto_win, f.auto_lose, f.is_system, f.exige_motivo, f.description, true
  from (select distinct organization_id from crm.pipeline_stages where slug is not null) o
 cross join funil f
on conflict (organization_id, slug) where slug is not null do update
  set position     = excluded.position,
      title        = excluded.title,
      trilha       = excluded.trilha,
      color        = excluded.color,
      auto_win     = excluded.auto_win,
      auto_lose    = excluded.auto_lose,
      is_system    = excluded.is_system,
      exige_motivo = excluded.exige_motivo,
      description  = excluded.description,
      is_active    = true,
      updated_at   = now();

-- ----------------------------------------------------------------------------
-- 3. Os negócios que estavam nas posições que saíram
--
-- Abertos e fechados: um card ganho em "Iniciou tratamento" também precisa de
-- coluna ativa, senão some do board.
--
-- stage_changed_at fica o de antes: trocar o nome da coluna não é o card
-- andar. O gatilho grava now() em toda troca de stage_id, então o valor é
-- guardado aqui e devolvido depois, num update que não toca stage_id.
-- ----------------------------------------------------------------------------
create temp table funil_classico_antes as
  select id, stage_changed_at from crm.deals;

with de_para (velho, novo, detalhe, ganha) as (
  values
    ('novo',                     'prospeccao',   null,                       false),
    ('em_qualificacao',          'qualificacao', null,                       false),
    ('qualificado',              'qualificacao', null,                       false),
    ('proposta_apresentada',     'apresentacao', null,                       false),
    ('aguardando_elegibilidade', 'negociacao',   'aguardando_elegibilidade', false),
    ('encaminhado_humano',       'negociacao',   'encaminhado_humano',       false),
    ('em_follow_up',             'negociacao',   'em_follow_up',             false),
    ('agendado',                 'agendamento',  null,                       false),
    ('entrevista_agendada',      'agendamento',  null,                       false),
    ('compareceu',               'atendimento',  null,                       true),
    ('aguardando_cronograma',    'atendimento',  'aguardando_cronograma',    true),
    ('iniciou_tratamento',       'atendimento',  null,                       true)
)
update crm.deals d
   set stage_id      = n.id,
       detalhe       = coalesce(m.detalhe, d.detalhe),
       detalhe_desde = case when m.detalhe is not null then d.stage_changed_at else d.detalhe_desde end,
       status        = case when m.ganha and d.status = 'open' then 'won' else d.status end,
       closed_at     = case when m.ganha and d.status = 'open' then now() else d.closed_at end
  from crm.pipeline_stages v, de_para m, crm.pipeline_stages n
 where v.id = d.stage_id
   and m.velho = v.slug
   and n.organization_id = d.organization_id
   and n.slug = m.novo;

update crm.deals d
   set stage_changed_at = a.stage_changed_at
  from funil_classico_antes a
 where a.id = d.id
   and d.stage_changed_at is distinct from a.stage_changed_at;

drop table funil_classico_antes;

-- ----------------------------------------------------------------------------
-- 4. Conversa nova nasce em "Prospecção"
-- ----------------------------------------------------------------------------
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
     and s.slug = 'prospeccao'
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
      'Entrou no funil em "Prospecção" (conversa nova no WhatsApp)', true
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
-- 5. Tag nao_paciente_* encerra enquanto o card está em Prospecção /
--    Qualificação (antes: Novo / Em qualificação)
-- ----------------------------------------------------------------------------
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

    if v_destino is not null and v_slug_atual in ('prospeccao', 'qualificacao') then
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

-- ----------------------------------------------------------------------------
-- 6. A Maia no funil novo
--
-- Regras:
--   - nunca volta coluna; o teto é "Agendamento" (Atendimento é ganho, da
--     equipe);
--   - encerra só enquanto o card está em Prospecção, Qualificação ou
--     Apresentação;
--   - 'encaminhado_humano' não move: marca o detalhe (motivo obrigatório);
--   - 'aguardando_elegibilidade' marca o detalhe, define a trilha Convênio e
--     leva o card até Negociação se ele estiver antes;
--   - os slugs de 28/09 que o código antigo ainda manda valem pelos novos.
-- ----------------------------------------------------------------------------
create or replace function crm.maia_mover_negocio(
  p_org     uuid,
  p_contato uuid,
  p_slug    text,
  p_motivo  text default null
)
returns text
language plpgsql
security definer
set search_path = crm, public
as $$
declare
  v_deal    crm.deals%rowtype;
  v_atual   crm.pipeline_stages%rowtype;
  v_destino crm.pipeline_stages%rowtype;
  v_teto    integer;
  v_slug    text;
  v_detalhe text;
  v_motivo  text := nullif(trim(coalesce(p_motivo, '')), '');
  v_fecha   boolean;
begin
  v_slug := case p_slug
    when 'em_qualificacao'      then 'qualificacao'
    when 'qualificado'          then 'qualificacao'
    when 'proposta_apresentada' then 'apresentacao'
    when 'agendado'             then 'agendamento'
    when 'entrevista_agendada'  then 'agendamento'
    else p_slug
  end;

  select d.* into v_deal
    from crm.deals d
   where d.organization_id = p_org
     and d.contact_id = p_contato
     and d.status = 'open'
   for update;
  if not found then
    return 'sem_negocio';
  end if;

  select s.* into v_atual from crm.pipeline_stages s where s.id = v_deal.stage_id;

  -- Detalhe: não é coluna.
  if v_slug in ('encaminhado_humano', 'aguardando_elegibilidade') then
    v_detalhe := v_slug;

    if v_detalhe = 'encaminhado_humano' and v_motivo is null then
      return 'falta_motivo';
    end if;
    if v_detalhe = 'aguardando_elegibilidade' and v_deal.trilha = 'particular' then
      return 'trilha_diferente';
    end if;
    if v_deal.detalhe is not distinct from v_detalhe then
      return 'ja_esta';
    end if;

    select s.* into v_destino
      from crm.pipeline_stages s
     where s.organization_id = p_org and s.slug = 'negociacao' and s.is_active;

    update crm.deals
       set stage_id      = case
                             when v_detalhe = 'aguardando_elegibilidade'
                              and v_destino.id is not null
                              and coalesce(v_atual.position, 0) < v_destino.position
                             then v_destino.id
                             else stage_id
                           end,
           trilha        = case when v_detalhe = 'aguardando_elegibilidade' then coalesce(trilha, 'convenio') else trilha end,
           detalhe       = v_detalhe,
           detalhe_desde = now(),
           motivo        = coalesce(v_motivo, motivo)
     where id = v_deal.id;

    insert into crm.deal_activities (organization_id, deal_id, type, title, description, created_by_ai)
    values (p_org, v_deal.id, 'status_change',
            case v_detalhe
              when 'encaminhado_humano' then 'Passado para a equipe pela Maia'
              else 'Aguardando elegibilidade / autorização (marcado pela Maia)'
            end,
            v_motivo, true);

    return 'movido';
  end if;

  select s.* into v_destino
    from crm.pipeline_stages s
   where s.organization_id = p_org and s.slug = v_slug and s.is_active;
  if not found then
    return 'posicao_inexistente';
  end if;

  if v_destino.id = v_atual.id then
    return 'ja_esta';
  end if;

  v_fecha := v_destino.auto_lose or v_destino.auto_win;

  if v_fecha then
    if v_destino.auto_win or v_destino.slug = 'nunca_respondeu' then
      return 'posicao_nao_permitida';
    end if;
    if coalesce(v_atual.slug, '') not in ('prospeccao', 'qualificacao', 'apresentacao') then
      return 'nao_volta';
    end if;
  else
    select s.position into v_teto
      from crm.pipeline_stages s
     where s.organization_id = p_org and s.slug = 'agendamento' and s.is_active;
    if v_destino.position > coalesce(v_teto, 0) then
      return 'posicao_nao_permitida';
    end if;
    if v_destino.position <= coalesce(v_atual.position, 0) then
      return 'nao_volta';
    end if;
  end if;

  if v_destino.trilha <> 'ambas' and v_deal.trilha is not null and v_deal.trilha <> v_destino.trilha then
    return 'trilha_diferente';
  end if;

  if v_destino.exige_motivo and v_motivo is null then
    return 'falta_motivo';
  end if;

  update crm.deals
     set stage_id      = v_destino.id,
         trilha        = case when v_destino.trilha <> 'ambas' then coalesce(trilha, v_destino.trilha) else trilha end,
         motivo        = coalesce(v_motivo, motivo),
         status        = case when v_fecha then 'lost' else status end,
         closed_at     = case when v_fecha then now() else closed_at end,
         closed_reason = case when v_fecha then coalesce(v_motivo, v_destino.title) else closed_reason end
   where id = v_deal.id;

  insert into crm.deal_activities (organization_id, deal_id, type, title, description, created_by_ai)
  values (p_org, v_deal.id, 'status_change',
          'Movido para "' || v_destino.title || '" pela Maia',
          v_motivo, true);

  return 'movido';
end;
$$;

revoke all on function crm.maia_mover_negocio(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function crm.maia_mover_negocio(uuid, uuid, text, text) to service_role;

do $t$
declare r jsonb; d crm.deals%rowtype; passos text[] := '{}'; x text;
begin
  select * into d from crm.deals where status = 'open' order by created_at desc limit 1;
  passos := passos || ('alias em_qualificacao: ' || crm.maia_mover_negocio(d.organization_id, d.contact_id, 'em_qualificacao'));
  passos := passos || ('encaminhado sem motivo: ' || crm.maia_mover_negocio(d.organization_id, d.contact_id, 'encaminhado_humano'));
  passos := passos || ('encaminhado: ' || crm.maia_mover_negocio(d.organization_id, d.contact_id, 'encaminhado_humano', 'Pediu pessoa'));
  select coalesce(detalhe, '-') || '@' || (select slug from crm.pipeline_stages where id = stage_id) into x from crm.deals where id = d.id;
  passos := passos || ('estado: ' || x);
  passos := passos || ('atendimento: ' || crm.maia_mover_negocio(d.organization_id, d.contact_id, 'atendimento'));
  passos := passos || ('elegibilidade: ' || crm.maia_mover_negocio(d.organization_id, d.contact_id, 'aguardando_elegibilidade'));
  select coalesce(detalhe, '-') || '@' || (select slug from crm.pipeline_stages where id = stage_id) || ' trilha=' || coalesce(trilha, '-') into x from crm.deals where id = d.id;
  passos := passos || ('estado: ' || x);
  passos := passos || ('perder em negociacao: ' || crm.maia_mover_negocio(d.organization_id, d.contact_id, 'perdido_objecao', 'caro'));
  passos := passos || ('alias agendado: ' || crm.maia_mover_negocio(d.organization_id, d.contact_id, 'agendado'));
  select coalesce(detalhe, '-') || '@' || (select slug from crm.pipeline_stages where id = stage_id) into x from crm.deals where id = d.id;
  passos := passos || ('estado: ' || x);
  passos := passos || ('voltar qualificacao: ' || crm.maia_mover_negocio(d.organization_id, d.contact_id, 'qualificacao'));
  select jsonb_build_object(
    'ativas',   (select jsonb_agg(position || ' ' || slug order by position) from crm.pipeline_stages where is_active),
    'inativas', (select count(*) from crm.pipeline_stages where not is_active),
    'deals',    (select jsonb_agg(x) from (select s.slug, d2.status, count(*) n, min(d2.stage_changed_at)::date desde
                                             from crm.deals d2 join crm.pipeline_stages s on s.id = d2.stage_id group by 1, 2) x),
    'passos',   to_jsonb(passos),
    'cfg',      (select jsonb_agg(proname || '=' || coalesce(proconfig::text, 'NULL')) from pg_proc
                  where pronamespace = 'crm'::regnamespace
                    and proname in ('maia_mover_negocio', 'aplicar_tags_no_funil', 'criar_negocio_na_conversa_nova', 'marcar_troca_de_estagio'))
  ) into r;
  raise exception 'RELATORIO: %', r;
end $t$;
