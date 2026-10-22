-- ============================================================================
-- CRM — campos do card preenchidos pelo sistema
--
-- A gaveta do negócio tem cinco campos além da coluna. Coluna, elegibilidade
-- e trilha já se preenchem (leitura da Maia e tags). Os outros quatro eram só
-- à mão; todos saem de fatos que o banco já tem, sem IA:
--
--   1. Resgate: o contato já teve card ENCERRADO (perdido). Decisão do
--      usuário em 22/10/2026: só isso, sem prazo e sem exigir campanha. Vale
--      para card novo e para card perdido que reabre.
--   2. Responsável: o da conversa. Quando a conversa é atribuída ou passa de
--      uma pessoa para outra, o card vai junto — salvo se alguém escolheu à
--      mão outra pessoa no card.
--   3. Situação "Com a equipe": a conversa mais recente do contato está em
--      Aberto ou Atribuída. Sai quando a Maia retoma (Autoatendimento).
--   4. Situação "Follow-up": o contato já respondeu à clínica, a clínica falou
--      por último e faz 24 horas — passou a janela do WhatsApp, a retomada é
--      por template. Sai quando o contato escreve. Só até Negociação: em
--      Agendamento o silêncio depois de "está marcado" é normal.
--
-- Elegibilidade e Cronograma não são tocados aqui: são mais específicos do
-- que estes dois, e quem os marca (Maia, equipe) é quem os tira.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Resgate
--
-- No próprio crm.deals: cobre todo caminho que cria ou reabre card (conversa
-- nova, cadastro à mão, reabertura de "Nunca respondeu").
-- ----------------------------------------------------------------------------
create or replace function crm.marcar_resgate()
returns trigger
language plpgsql
security definer
set search_path = crm, public
as $$
begin
  if new.status <> 'open' or new.resgate or new.contact_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'lost' then
      new.resgate := true;
    end if;
    return new;
  end if;

  if exists (
    select 1 from crm.deals o
     where o.organization_id = new.organization_id
       and o.contact_id = new.contact_id
       and o.status = 'lost'
  ) then
    new.resgate := true;
  end if;
  return new;
end;
$$;

revoke all on function crm.marcar_resgate() from public, anon, authenticated;

drop trigger if exists marcar_resgate on crm.deals;
create trigger marcar_resgate
  before insert or update of status on crm.deals
  for each row execute function crm.marcar_resgate();

-- ----------------------------------------------------------------------------
-- 2. Responsável segue a conversa
--
-- O card só muda se estiver sem responsável ou com o responsável ANTERIOR da
-- conversa (veio dela). Outra pessoa no card = escolha à mão, e fica.
-- Nunca derruba a atribuição da conversa: erro aqui vira aviso.
-- ----------------------------------------------------------------------------
create or replace function crm.responsavel_da_conversa()
returns trigger
language plpgsql
security definer
set search_path = crm, central, public
as $$
begin
  update crm.deals d
     set assigned_to = new.assigned_user_id
   where d.organization_id = new.organization_id
     and d.contact_id = new.contact_id
     and d.status = 'open'
     and (d.assigned_to is null or d.assigned_to = old.assigned_user_id);
  return new;
exception when others then
  raise warning '[crm] responsável do card não atualizado pela conversa %: %', new.id, sqlerrm;
  return new;
end;
$$;

revoke all on function crm.responsavel_da_conversa() from public, anon, authenticated;

-- central.conversations é tabela quente: o gatilho pede trava, que não pode
-- ficar na fila segurando as escritas do inbox.
set lock_timeout = '5s';
drop trigger if exists crm_responsavel_da_conversa on central.conversations;
create trigger crm_responsavel_da_conversa
  after update of assigned_user_id on central.conversations
  for each row
  when (new.assigned_user_id is not null and new.assigned_user_id is distinct from old.assigned_user_id)
  execute function crm.responsavel_da_conversa();
reset lock_timeout;

-- ----------------------------------------------------------------------------
-- 3 e 4. Situação na etapa: "Com a equipe" e "Follow-up"
--
-- Por estado, a cada 15 minutos: o detalhe some quando o card anda
-- (marcar_troca_de_estagio) e volta na rodada seguinte se ainda vale.
--
-- Transições (só sobre detalhe vazio, encaminhado_humano ou em_follow_up):
--   follow-up vale                         → em_follow_up
--   em_follow_up e o contato escreveu
--     depois da marca                      → pela conversa (abaixo) ou nada
--   conversa em Aberto/Atribuída           → encaminhado_humano
--   conversa em Autoatendimento            → nada (a Maia retomou)
--   Aguardando/Resolvido/Arquivado         → fica como está
-- O follow-up marcado à mão só sai quando o contato escreve.
-- ----------------------------------------------------------------------------
create or replace function crm.funil_situacao_do_sistema(p_horas_follow_up integer default 24)
returns jsonb
language plpgsql
security definer
set search_path = crm, central, public
as $$
declare
  v_prazo     interval := make_interval(hours => p_horas_follow_up);
  v_follow_up integer := 0;
  v_equipe    integer := 0;
  v_limpos    integer := 0;
begin
  with base as (
    select d.id, d.organization_id, d.detalhe, d.detalhe_desde, s.slug as etapa,
           cv.status::text as conversa,
           m.ultima_entrada, m.primeira_saida, m.ultima_saida
      from crm.deals d
      join crm.pipeline_stages s on s.id = d.stage_id
      left join lateral (
        select c.status
          from central.conversations c
         where c.organization_id = d.organization_id
           and c.contact_id = d.contact_id
           and c.last_message_at is not null
         order by c.last_message_at desc
         limit 1
      ) cv on true
      left join lateral (
        select max(x.created_at) filter (where x.direction = 'inbound')  as ultima_entrada,
               min(x.created_at) filter (where x.direction = 'outbound') as primeira_saida,
               max(x.created_at) filter (where x.direction = 'outbound') as ultima_saida
          from central.conversations c
          join central.messages x on x.conversation_id = c.id
         where c.organization_id = d.organization_id
           and c.contact_id = d.contact_id
           and x.deleted_at is null
           and coalesce(x.message_type, '') not in ('reaction', 'system')
      ) m on true
     where d.status = 'open'
       and d.contact_id is not null
       and (d.detalhe is null or d.detalhe in ('encaminhado_humano', 'em_follow_up'))
  ),
  decisao as (
    select b.id, b.organization_id, b.detalhe as atual,
           case
             when b.etapa in ('prospeccao', 'qualificacao', 'apresentacao', 'negociacao')
              and b.ultima_entrada > b.primeira_saida
              and b.ultima_saida > b.ultima_entrada
              and b.ultima_saida < now() - v_prazo
               then 'em_follow_up'
             when b.detalhe = 'em_follow_up'
              and coalesce(b.ultima_entrada, '-infinity'::timestamptz) <= coalesce(b.detalhe_desde, '-infinity'::timestamptz)
               then 'em_follow_up'
             when b.conversa in ('open', 'assigned') then 'encaminhado_humano'
             when b.conversa = 'self_service' then null
             when b.detalhe = 'em_follow_up' then null
             else b.detalhe
           end as novo
      from base b
  ),
  mudou as (
    update crm.deals d
       set detalhe       = x.novo,
           detalhe_desde = case when x.novo is null then null else now() end
      from decisao x
     where d.id = x.id
       and x.novo is distinct from x.atual
    returning d.id, d.organization_id, x.novo
  ),
  log as (
    insert into crm.deal_activities (organization_id, deal_id, type, title, created_by_ai)
    select m.organization_id, m.id, 'status_change',
           case m.novo
             when 'em_follow_up' then 'Situação "Follow-up" marcada pelo sistema (24h sem resposta do contato)'
             else 'Situação "Com a equipe" marcada pelo sistema (conversa com a equipe)'
           end,
           true
      from mudou m
     where m.novo is not null
    returning 1
  )
  -- O insert do log roda mesmo sem ser lido (CTE que escreve roda sempre).
  select count(*) filter (where novo = 'em_follow_up'),
         count(*) filter (where novo = 'encaminhado_humano'),
         count(*) filter (where novo is null)
    into v_follow_up, v_equipe, v_limpos
    from mudou;

  return jsonb_build_object(
    'follow_up', v_follow_up,
    'com_a_equipe', v_equipe,
    'limpos', v_limpos
  );
end;
$$;

comment on function crm.funil_situacao_do_sistema(integer) is
  'Situação do card pelo sistema: "Com a equipe" pela conversa mais recente do contato (Aberto/Atribuída; sai em Autoatendimento) e "Follow-up" quando o contato já respondeu, a clínica falou por último e faz N horas (até Negociação; sai quando o contato escreve). Não toca elegibilidade nem cronograma. pg_cron crm-funil-situacao, a cada 15 min.';

revoke all on function crm.funil_situacao_do_sistema(integer) from public, anon, authenticated;
grant execute on function crm.funil_situacao_do_sistema(integer) to service_role;

do $$
begin
  perform cron.unschedule('crm-funil-situacao');
exception when others then null;  -- não existia ainda
end;
$$;

select cron.schedule(
  'crm-funil-situacao',
  '*/15 * * * *',
  $cron$select crm.funil_situacao_do_sistema()$cron$
);

-- ----------------------------------------------------------------------------
-- 5. Os cards de hoje
--
-- Resgate e responsável não têm rodada: os gatilhos só valem daqui em diante.
-- A situação fica para a primeira rodada do cron.
-- ----------------------------------------------------------------------------
update crm.deals d
   set resgate = true
 where d.status = 'open'
   and not d.resgate
   and d.contact_id is not null
   and (
     exists (
       select 1 from crm.deals o
        where o.organization_id = d.organization_id
          and o.contact_id = d.contact_id
          and o.status = 'lost'
     )
     or exists (
       select 1 from crm.deal_activities a
        where a.deal_id = d.id
          and a.title = 'Reaberto em "Prospecção" pelo sistema (o contato voltou a escrever)'
     )
   );

with da_conversa as (
  select d.id, cv.assigned_user_id
    from crm.deals d
    cross join lateral (
      select c.assigned_user_id
        from central.conversations c
       where c.organization_id = d.organization_id
         and c.contact_id = d.contact_id
         and c.last_message_at is not null
       order by c.last_message_at desc
       limit 1
    ) cv
   where d.status = 'open'
     and d.assigned_to is null
     and cv.assigned_user_id is not null
)
update crm.deals d
   set assigned_to = x.assigned_user_id
  from da_conversa x
 where d.id = x.id;
