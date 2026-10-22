-- ============================================================================
-- CRM — o funil anda sozinho
--
-- Medido em 22/10/2026: 70 cards abertos, todos em Prospecção. Em toda a
-- história do funil, só o gatilho de tags moveu card (trilha e "Não
-- qualificado"). Dois motivos: 81 dos 85 cards são de números Evolution, onde
-- o worker não tinha o funil; e mesmo no número Meta o avanço dependia de o
-- modelo chamar `atualizar_funil` por conta própria — o mesmo que deu 1
-- chamada em 156 com `registrar_tags`.
--
-- Esta migration traz duas peças:
--
--   1. COLUNAS DA LEITURA (funil_ia_*). O worker do funil (workers/funil.worker.ts)
--      lê cada conversa com mensagem nova e diz a coluna que ela já alcançou.
--      A leitura fica gravada no card mesmo quando nada muda — é o rastro de
--      "a Maia olhou e achou que fica". O movimento continua passando por
--      crm.maia_mover_negocio, com as travas de sempre.
--
--   2. REGRAS DO SISTEMA (crm.funil_regras_do_sistema, pg_cron a cada 15 min),
--      o que não é leitura de conversa:
--        a) Atendimento (o ganho) — a 1ª sessão concluída do paciente, no dia
--           em que o card nasceu ou depois. Paciente que já vinha antes não
--           ganha: fica uma nota no card, uma vez.
--        b) Nunca respondeu — card em Prospecção cujo contato não escreveu
--           nada depois da 1ª resposta da clínica, quieto há 7 dias. Volta a
--           Prospecção se o contato escrever de novo.
--      O ganho roda primeiro: quem veio à clínica não é "nunca respondeu",
--      mesmo calado no WhatsApp.
--
-- Na timeline, o que o sistema faz diz "pelo sistema" no título. A autoria
-- segue a convenção de crm.deal_activities (20260701020100): sistema e IA têm
-- created_by NULL e created_by_ai = true.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. A leitura da Maia no card
-- ----------------------------------------------------------------------------
alter table crm.deals
  add column if not exists funil_ia_ate       timestamptz,
  add column if not exists funil_ia_etapa     text,
  add column if not exists funil_ia_confianca numeric(3,2),
  add column if not exists funil_ia_motivo    text,
  add column if not exists funil_ia_em        timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'deals_funil_ia_confianca_check') then
    alter table crm.deals
      add constraint deals_funil_ia_confianca_check
      check (funil_ia_confianca is null or (funil_ia_confianca >= 0 and funil_ia_confianca <= 1));
  end if;
end $$;

comment on column crm.deals.funil_ia_ate is
  'Marca d''água da leitura do funil: last_message_at da conversa quando a Maia leu. Mensagem depois disto pede leitura nova.';
comment on column crm.deals.funil_ia_etapa is
  'Coluna que a Maia leu na conversa (ou "manter"). Gravada mesmo quando o card não anda.';
comment on column crm.deals.funil_ia_confianca is 'Confiança da leitura do funil, 0..1.';
comment on column crm.deals.funil_ia_motivo is 'A frase da Maia sobre a leitura do funil.';
comment on column crm.deals.funil_ia_em is 'Quando a leitura do funil foi feita.';

-- ----------------------------------------------------------------------------
-- 2. Telefone comparável: DDD + 8 últimos dígitos
--
-- O WhatsApp manda 55 + DDD + número, com ou sem o 9; o cadastro do TiTa
-- guarda "(21) 99999-8888" e variações. DDD + 8 últimos casa as duas formas
-- sem depender do 9. Abaixo de 10 dígitos (sem DDD) não há chave: casar só
-- pelos 8 últimos juntaria números de cidades diferentes.
-- ----------------------------------------------------------------------------
create or replace function crm.chave_telefone(p text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when length(d) < 10 then null
    else left(d, 2) || right(d, 8)
  end
  from (
    select case
      when length(x) >= 12 and left(x, 2) = '55' then substr(x, 3)
      else x
    end as d
    from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as x) a
  ) b
$$;

revoke all on function crm.chave_telefone(text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. A 1ª presença de cada card aberto
--
-- Contato → paciente pelo vínculo (contact_patient_links) ou pelo telefone,
-- contra o do responsável e o do paciente. Presença = sessão concluída na
-- fila, o mesmo critério da automação do ClickUp (20261016190100).
-- fila_autorizacoes.paciente_id é text: o cast fica do lado de pacientes,
-- nunca sobre a coluna da fila (índices dela).
--
-- Por card, vale QUALQUER paciente casado (irmãos no mesmo telefone contam):
-- `veio_depois` diz se algum deles teve a 1ª sessão no dia em que o card
-- nasceu ou depois.
-- ----------------------------------------------------------------------------
create or replace function crm.funil_presencas_dos_abertos()
returns table (deal_id uuid, organization_id uuid, primeira date, veio_depois boolean)
language sql
stable
security definer
set search_path = crm, central, public
as $$
  with candidatos as (
    select d.id as deal_id, d.organization_id, d.created_at, l.tita_paciente_id::text as paciente_id
      from crm.deals d
      join central.contact_patient_links l
        on l.contact_id = d.contact_id and l.organization_id = d.organization_id
     where d.status = 'open'
       and l.tita_paciente_id is not null
    union
    select d.id, d.organization_id, d.created_at, p.tita_paciente_id::text
      from crm.deals d
      join central.contacts ct on ct.id = d.contact_id
      join public.pacientes p
        on crm.chave_telefone(ct.display_phone) in (
             crm.chave_telefone(p.responsavel_telefone), crm.chave_telefone(p.telefone))
     where d.status = 'open'
       and crm.chave_telefone(ct.display_phone) is not null
       and p.tita_paciente_id is not null
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
-- 4. As regras do sistema
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
  -- a) Atendimento na 1ª presença: ganho, de qualquer coluna aberta.
  with presencas as (
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
  log as (
    insert into crm.deal_activities (organization_id, deal_id, type, title, description, created_by_ai)
    select g.organization_id, g.id, 'status_change',
           'Movido para "Atendimento" pelo sistema (primeira presença)',
           'Primeira sessão concluída em ' || to_char(g.primeira, 'DD/MM/YYYY') || '.',
           true
      from ganhos g
    returning 1
  )
  select count(*) into v_ganhos from log;

  -- Já era paciente antes do card: não é venda nova. Uma nota, uma vez, para
  -- a equipe decidir à mão. Roda depois do ganho, então só sobra quem não
  -- teve nenhuma 1ª sessão depois de o card nascer.
  with antigos as (
    select p.deal_id, p.organization_id, p.primeira
      from crm.funil_presencas_dos_abertos() p
     where not p.veio_depois
       and not exists (
         select 1 from crm.deal_activities a
          where a.deal_id = p.deal_id
            and a.title = 'Contato já era paciente (anotado pelo sistema)'
       )
  ),
  log as (
    insert into crm.deal_activities (organization_id, deal_id, type, title, description, created_by_ai)
    select a.organization_id, a.deal_id, 'note',
           'Contato já era paciente (anotado pelo sistema)',
           'O telefone ou o vínculo casa com paciente atendido desde ' || to_char(a.primeira, 'DD/MM/YYYY')
             || ', antes de este card existir. Não conta como ganho automático: decida à mão.',
           true
      from antigos a
    returning 1
  )
  select count(*) into v_antigos from log;

  -- b) Nunca respondeu = "abriu e sumiu": o contato não escreveu nada depois
  --    da PRIMEIRA resposta da clínica, e a última mensagem dela tem N dias.
  --    Quem conversou e depois parou não é "nunca respondeu" — é a leitura da
  --    Maia que diz até onde ele foi (medido em 22/10: 10 cards com a clínica
  --    falando por último há 7 dias, só 5 sem nenhuma resposta). Se a clínica
  --    nunca respondeu, o silêncio não é do contato: o card fica.
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
  -- volta a Prospecção. Só os fechados por esta regra (closed_reason dela), e
  -- só se o contato não tiver outro card aberto (conversa nova cria outro).
  with reabrir as (
    select d.id as deal_id, d.organization_id, p.id as destino
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
  'Regras fixas do funil: 1ª presença do paciente depois de o card nascer → Atendimento (ganho); Prospecção sem nenhuma resposta do contato à clínica há N dias → Nunca respondeu (reabre se o contato voltar). pg_cron crm-funil-regras, a cada 15 min.';

revoke all on function crm.funil_regras_do_sistema(integer) from public, anon, authenticated;
grant execute on function crm.funil_regras_do_sistema(integer) to service_role;

-- ----------------------------------------------------------------------------
-- 5. Agenda: a cada 15 minutos
-- ----------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('crm-funil-regras');
exception when others then null;  -- não existia ainda
end;
$$;

select cron.schedule(
  'crm-funil-regras',
  '*/15 * * * *',
  $cron$select crm.funil_regras_do_sistema()$cron$
);
