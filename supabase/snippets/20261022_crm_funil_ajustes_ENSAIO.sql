-- ENSAIO de 20261022150000_crm_funil_ajustes: roda a migration inteira, a lista do worker e UMA
-- rodada das regras, e termina em RAISE EXCEPTION com o relatório. Nada fica gravado.
set lock_timeout = '5s';
-- ============================================================================
-- CRM — ajustes do funil que anda sozinho (revisão de 20261022140000)
--
--   1. crm.funil_cards_para_ler: o worker pedia ao PostgREST até 400 cards,
--      mais as conversas e os vínculos deles (URL de ~15 KB com 400 ids), a
--      cada 10 segundos, para descobrir em memória que quase nenhum precisava
--      de leitura. Agora o banco devolve só os que precisam, na ordem certa.
--      E a conversa lida é a MAIS RECENTE do contato, não a do card
--      (deals.conversation_id fica na conversa em que o card nasceu): quem
--      negocia num número e manda "oi" em outro era lido pela conversa errada.
--   2. Presenças: a chave de telefone é calculada uma vez por paciente e o
--      casamento é por igualdade (hash join), não um IN de duas chamadas por
--      par card × paciente; a função roda uma vez por rodada, não duas.
--   3. Reabertura de "Nunca respondeu": no máximo UM card por contato. Dois
--      cards fechados do mesmo contato reabertos no mesmo UPDATE violavam o
--      índice de um card aberto por contato, e a função inteira (ganhos
--      incluídos) falhava a cada 15 minutos daí em diante.
--   4. crm.maia_mover_negocio: "aguardando elegibilidade" não volta para card
--      que já passou de Negociação.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Os cards que precisam de leitura
--
-- Card aberto cuja conversa mais recente do contato teve mensagem depois da
-- marca d'água (funil_ia_ate) e está calma há p_calma. Fora: contato
-- vinculado a paciente do TiTa — conversa de paciente não é venda; o ganho
-- dele vem da 1ª presença.
-- ----------------------------------------------------------------------------
create or replace function crm.funil_cards_para_ler(
  p_org    uuid,
  p_limite integer  default 10,
  p_calma  interval default interval '2 minutes'
)
returns table (
  deal_id         uuid,
  contact_id      uuid,
  conversation_id uuid,
  etapa           text,
  trilha          text,
  funil_ia_ate    timestamptz,
  last_message_at timestamptz,
  tags            text[]
)
language sql
stable
security definer
set search_path = crm, central, public
as $$
  select d.id, d.contact_id, c.id, s.slug, d.trilha, d.funil_ia_ate, c.last_message_at, coalesce(c.tags, '{}')
    from crm.deals d
    join crm.pipeline_stages s on s.id = d.stage_id
    cross join lateral (
      select cv.id, cv.last_message_at, cv.tags
        from central.conversations cv
       where cv.organization_id = d.organization_id
         and cv.contact_id = d.contact_id
         and cv.last_message_at is not null
       order by cv.last_message_at desc
       limit 1
    ) c
   where d.organization_id = p_org
     and d.status = 'open'
     and d.contact_id is not null
     and c.last_message_at > coalesce(d.funil_ia_ate, '-infinity'::timestamptz)
     and c.last_message_at < now() - p_calma
     and not exists (
       select 1 from central.contact_patient_links l
        where l.contact_id = d.contact_id and l.organization_id = d.organization_id
     )
   order by c.last_message_at desc
   limit greatest(coalesce(p_limite, 10), 1)
$$;

comment on function crm.funil_cards_para_ler(uuid, integer, interval) is
  'Cards abertos que o worker do funil precisa ler: conversa mais recente do contato com mensagem depois de funil_ia_ate e calma há p_calma. Mais nova primeiro. Só service_role.';

revoke all on function crm.funil_cards_para_ler(uuid, integer, interval) from public, anon, authenticated;
grant execute on function crm.funil_cards_para_ler(uuid, integer, interval) to service_role;

-- ----------------------------------------------------------------------------
-- 2. A 1ª presença de cada card aberto
--
-- Mesma regra de 20261022140000; muda só o caminho. A chave de telefone de
-- cada paciente sai uma vez (responsável e paciente, como duas linhas), a do
-- contato também, e o casamento é por igualdade.
-- ----------------------------------------------------------------------------
create or replace function crm.funil_presencas_dos_abertos()
returns table (deal_id uuid, organization_id uuid, primeira date, veio_depois boolean)
language sql
stable
security definer
set search_path = crm, central, public
as $$
  with abertos as (
    select d.id, d.organization_id, d.created_at, d.contact_id, crm.chave_telefone(ct.display_phone) as chave
      from crm.deals d
      join central.contacts ct on ct.id = d.contact_id
     where d.status = 'open'
  ),
  chaves_pacientes as (
    select p.tita_paciente_id::text as paciente_id, crm.chave_telefone(p.responsavel_telefone) as chave
      from public.pacientes p
     where p.tita_paciente_id is not null
    union
    select p.tita_paciente_id::text, crm.chave_telefone(p.telefone)
      from public.pacientes p
     where p.tita_paciente_id is not null
  ),
  candidatos as (
    select a.id as deal_id, a.organization_id, a.created_at, l.tita_paciente_id::text as paciente_id
      from abertos a
      join central.contact_patient_links l
        on l.contact_id = a.contact_id and l.organization_id = a.organization_id
     where l.tita_paciente_id is not null
    union
    select a.id, a.organization_id, a.created_at, cp.paciente_id
      from abertos a
      join chaves_pacientes cp on cp.chave = a.chave
     where a.chave is not null
  ),
  primeira_por_paciente as (
    select c.deal_id, c.organization_id, c.created_at, min(f.data_atendimento) as primeira
      from candidatos c
      join public.fila_autorizacoes f
        on f.paciente_id = c.paciente_id
       and f.status in ('concluido', 'concluido_sem_guia')
     group by c.deal_id, c.organization_id, c.created_at, c.paciente_id
  )
  select pp.deal_id, pp.organization_id,
         min(pp.primeira),
         bool_or(pp.primeira >= (pp.created_at at time zone 'America/Sao_Paulo')::date)
    from primeira_por_paciente pp
   group by pp.deal_id, pp.organization_id
$$;

revoke all on function crm.funil_presencas_dos_abertos() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. As regras do sistema
-- ----------------------------------------------------------------------------
create or replace function crm.funil_regras_do_sistema(p_dias_sem_resposta integer default 7)
returns jsonb
language plpgsql
security definer
set search_path = crm, central, public
as $$
declare
  v_ganhos    integer := 0;
  v_antigos   integer := 0;
  v_nunca     integer := 0;
  v_reabertos integer := 0;
  v_prazo     interval := make_interval(days => p_dias_sem_resposta);
  v_motivo    text := 'Sem resposta há ' || p_dias_sem_resposta || ' dias';
begin
  -- a) 1ª presença. Um comando só: as presenças saem uma vez e servem ao
  --    ganho (veio depois de o card nascer) e à nota de quem já era paciente
  --    (não veio depois) — os dois conjuntos não se cruzam.
  with presencas as materialized (
    select * from crm.funil_presencas_dos_abertos()
  ),
  ganhos as (
    update crm.deals d
       set stage_id      = w.id,
           status        = 'won',
           closed_at     = now(),
           closed_reason = 'Primeira presença em ' || to_char(p.primeira, 'DD/MM/YYYY')
      from presencas p
      join crm.pipeline_stages w
        on w.organization_id = p.organization_id and w.slug = 'atendimento' and w.is_active
     where d.id = p.deal_id
       and p.veio_depois
       and d.status = 'open'
    returning d.id, d.organization_id, p.primeira
  ),
  log_ganhos as (
    insert into crm.deal_activities (organization_id, deal_id, type, title, description, created_by_ai)
    select g.organization_id, g.id, 'status_change',
           'Movido para "Atendimento" pelo sistema (primeira presença)',
           'Primeira sessão concluída em ' || to_char(g.primeira, 'DD/MM/YYYY') || '.',
           true
      from ganhos g
    returning 1
  ),
  -- Já era paciente antes do card: não é venda nova. Uma nota, uma vez, para
  -- a equipe decidir à mão.
  log_antigos as (
    insert into crm.deal_activities (organization_id, deal_id, type, title, description, created_by_ai)
    select p.organization_id, p.deal_id, 'note',
           'Contato já era paciente (anotado pelo sistema)',
           'O telefone ou o vínculo casa com paciente atendido desde ' || to_char(p.primeira, 'DD/MM/YYYY')
             || ', antes de este card existir. Não conta como ganho automático: decida à mão.',
           true
      from presencas p
     where not p.veio_depois
       and not exists (
         select 1 from crm.deal_activities a
          where a.deal_id = p.deal_id
            and a.title = 'Contato já era paciente (anotado pelo sistema)'
       )
    returning 1
  )
  select (select count(*) from log_ganhos), (select count(*) from log_antigos)
    into v_ganhos, v_antigos;

  -- b) Nunca respondeu = "abriu e sumiu": o contato não escreveu nada depois
  --    da PRIMEIRA resposta da clínica, e a última mensagem dela tem N dias.
  --    Quem conversou e depois parou não é "nunca respondeu" — é a leitura da
  --    Maia que diz até onde ele foi. Se a clínica nunca respondeu, o silêncio
  --    não é do contato: o card fica.
  with ultimas as (
    select d.id as deal_id, d.organization_id,
           max(m.created_at) filter (where m.direction = 'inbound')  as ultima_entrada,
           min(m.created_at) filter (where m.direction = 'outbound') as primeira_saida,
           max(m.created_at) filter (where m.direction = 'outbound') as ultima_saida
      from crm.deals d
      join crm.pipeline_stages s on s.id = d.stage_id and s.slug = 'prospeccao'
      join central.conversations c on c.contact_id = d.contact_id and c.organization_id = d.organization_id
      join central.messages m on m.conversation_id = c.id
     where d.status = 'open'
       and m.deleted_at is null
       and coalesce(m.message_type, '') <> 'reaction'
     group by d.id, d.organization_id
  ),
  movidos as (
    update crm.deals d
       set stage_id      = n.id,
           status        = 'lost',
           closed_at     = now(),
           closed_reason = v_motivo,
           motivo        = v_motivo
      from ultimas u
      join crm.pipeline_stages n
        on n.organization_id = u.organization_id and n.slug = 'nunca_respondeu' and n.is_active
     where d.id = u.deal_id
       and d.status = 'open'
       and u.primeira_saida is not null
       and coalesce(u.ultima_entrada, '-infinity'::timestamptz) < u.primeira_saida
       and u.ultima_saida < now() - v_prazo
    returning d.id, d.organization_id
  ),
  log as (
    insert into crm.deal_activities (organization_id, deal_id, type, title, description, created_by_ai)
    select m.organization_id, m.id, 'status_change',
           'Movido para "Nunca respondeu" pelo sistema',
           'Sem resposta do contato há ' || p_dias_sem_resposta || ' dias depois da última mensagem da clínica.',
           true
      from movidos m
    returning 1
  )
  select count(*) into v_nunca from log;

  -- O contato voltou a escrever: o card que o sistema fechou por silêncio
  -- volta a Prospecção. Só os fechados por esta regra (closed_reason dela),
  -- só se o contato não tiver outro card aberto (conversa nova cria outro) e
  -- só UM por contato — o mais recente. O "não tem outro aberto" é lido antes
  -- do UPDATE: dois cards do mesmo contato reabertos juntos quebrariam o
  -- índice de um card aberto por contato e derrubariam a função inteira.
  with reabrir as (
    select distinct on (d.organization_id, d.contact_id)
           d.id as deal_id, d.organization_id, p.id as destino
      from crm.deals d
      join crm.pipeline_stages s on s.id = d.stage_id and s.slug = 'nunca_respondeu'
      join crm.pipeline_stages p
        on p.organization_id = d.organization_id and p.slug = 'prospeccao' and p.is_active
     where d.status = 'lost'
       and d.closed_reason like 'Sem resposta há % dias'
       and exists (
         select 1
           from central.conversations c
           join central.messages m on m.conversation_id = c.id
          where c.contact_id = d.contact_id
            and c.organization_id = d.organization_id
            and m.direction = 'inbound'
            and m.deleted_at is null
            and m.created_at > d.closed_at
       )
       and not exists (
         select 1 from crm.deals o
          where o.organization_id = d.organization_id
            and o.contact_id = d.contact_id
            and o.status = 'open'
       )
     order by d.organization_id, d.contact_id, d.closed_at desc
  ),
  reabertos as (
    update crm.deals d
       set stage_id      = r.destino,
           status        = 'open',
           closed_at     = null,
           closed_reason = null,
           motivo        = null
      from reabrir r
     where d.id = r.deal_id
    returning d.id, d.organization_id
  ),
  log as (
    insert into crm.deal_activities (organization_id, deal_id, type, title, created_by_ai)
    select r.organization_id, r.id, 'status_change',
           'Reaberto em "Prospecção" pelo sistema (o contato voltou a escrever)', true
      from reabertos r
    returning 1
  )
  select count(*) into v_reabertos from log;

  return jsonb_build_object(
    'ganhos',            v_ganhos,
    'ja_eram_pacientes', v_antigos,
    'nunca_respondeu',   v_nunca,
    'reabertos',         v_reabertos
  );
end;
$$;

comment on function crm.funil_regras_do_sistema(integer) is
  'Regras fixas do funil: 1ª presença do paciente depois de o card nascer → Atendimento (ganho); Prospecção sem nenhuma resposta do contato à clínica há N dias → Nunca respondeu (reabre se o contato voltar, um card por contato). pg_cron crm-funil-regras, a cada 15 min.';

revoke all on function crm.funil_regras_do_sistema(integer) from public, anon, authenticated;
grant execute on function crm.funil_regras_do_sistema(integer) to service_role;

-- ----------------------------------------------------------------------------
-- 4. A Maia no funil: elegibilidade não volta depois de Negociação
--
-- Cópia de 20261022110000 com uma trava a mais (o bloco "Elegibilidade é
-- coisa de antes do Agendamento").
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

    -- Elegibilidade é coisa de antes do Agendamento. Card que já passou de
    -- Negociação não ganha o detalhe de novo: sem esta trava, cada mensagem
    -- nova num card em Agendamento (o detalhe some ao andar) o remarcava e
    -- escrevia outra atividade na timeline.
    if v_detalhe = 'aguardando_elegibilidade'
       and v_destino.id is not null
       and coalesce(v_atual.position, 0) > v_destino.position then
      return 'nao_volta';
    end if;

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
declare
  r jsonb;
begin
  select jsonb_build_object(
    'cards_para_ler', (select count(*) from crm.funil_cards_para_ler(
                         (select organization_id from crm.deals limit 1), 100, interval '2 minutes')),
    'rodada',         crm.funil_regras_do_sistema(),
    'trava_elegibilidade', pg_get_functiondef('crm.maia_mover_negocio(uuid, uuid, text, text)'::regprocedure)
                             like '%Elegibilidade é coisa de antes do Agendamento%'
  ) into r;
  raise exception 'RELATORIO: %', r;
end $t$;
