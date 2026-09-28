-- CRM — o funil da diretoria (17 posições, trilha, acesso da equipe, entrada automática)
--
-- APLICA a migration 20260930100000 e registra no livro-caixa
-- (supabase_migrations.schema_migrations). Snippet e não `db push`: o push
-- empurra TODO o pendente (ver reference_db_push_blast_radius).
--
-- ORDEM:
--   1. Supabase → Settings → API → Exposed schemas → adicionar `crm` (clique,
--      não SQL). Sem isso a tela continua avisando "CRM não habilitado" —
--      mas este snippet pode rodar antes ou depois, não depende disso.
--   2. Rodar este arquivo inteiro no SQL Editor.
--   3. Rodar a conferência do fim (ou supabase/snippets/crm_pos_exposicao_verificacao.sql).
--
-- lock_timeout: cria gatilhos em central.conversations, que recebe escrita a
-- cada mensagem. Se estourar os 5s, rode de novo. Reexecutável.

begin;
set local lock_timeout = '5s';

-- ============================================================================
-- CRM — o funil da diretoria
--
-- Substitui os 6 estágios semeados em 20260701020400 (Novos Leads … Perdido,
-- vocabulário de venda B2B) pelo funil oficial enviado pela diretoria em
-- 28/09/2026: 17 posições, cada uma com a TRILHA em que vale (Particular,
-- Convênio ou Ambas), e "Resgate" como marcação à parte — convive com
-- qualquer posição, então não é coluna.
--
-- O que muda:
--   1. pipeline_stages ganha slug (código estável para a Maia e o sistema
--      acharem a posição sem depender do título), trilha e exige_motivo.
--   2. deals ganha trilha, resgate, motivo (o "campo lateral" da planilha) e
--      stage_changed_at (quanto tempo o card está parado na posição).
--   3. Os 6 estágios antigos são desativados — não apagados: a FK de
--      deals.stage_id é RESTRICT. Deal aberto neles vai para "Novo".
--   4. RLS: todo usuário com central_role na org vê e move negócios. Antes só
--      admin/director — e a planilha diz que autorização, comercial e
--      cronograma movem cards. Excluir e mexer na estrutura continua admin.
--   5. Entrada automática: toda conversa NOVA no número da Maia (não Evolution)
--      de contato que não é paciente do TiTa cria o negócio em "Novo".
--   6. Tags da Maia → trilha (PAGAMENTO) e "Não qualificado" (não-paciente).
--
-- Nada aqui depende de o schema `crm` estar exposto no PostgREST: os triggers
-- rodam dentro do banco. Mas a TELA só funciona depois da exposição
-- (Settings → API → Exposed schemas).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Colunas novas
-- ----------------------------------------------------------------------------
alter table crm.pipeline_stages
  add column if not exists slug         text,
  add column if not exists trilha       text    not null default 'ambas',
  add column if not exists exige_motivo boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pipeline_stages_trilha_check') then
    alter table crm.pipeline_stages
      add constraint pipeline_stages_trilha_check check (trilha in ('ambas', 'particular', 'convenio'));
  end if;
end $$;

create unique index if not exists uq_pipeline_stage_org_slug
  on crm.pipeline_stages (organization_id, slug)
  where slug is not null;

comment on column crm.pipeline_stages.slug is
  'Código estável da posição (ex.: aguardando_elegibilidade). É por ele que a Maia e os jobs do sistema movem o card — o título pode mudar sem quebrar nada.';
comment on column crm.pipeline_stages.trilha is
  'Em que trilha a posição vale: ambas, particular ou convenio. Um negócio com trilha definida não entra em posição da outra trilha.';
comment on column crm.pipeline_stages.exige_motivo is
  'Mover para esta posição exige um motivo (vai para deals.motivo e, se fechar como perdido, para closed_reason).';

alter table crm.deals
  add column if not exists trilha           text,
  add column if not exists resgate          boolean     not null default false,
  add column if not exists motivo           text,
  add column if not exists stage_changed_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'deals_trilha_check') then
    alter table crm.deals
      add constraint deals_trilha_check check (trilha in ('particular', 'convenio'));
  end if;
end $$;

comment on column crm.deals.trilha is
  'particular | convenio | null (ainda não se sabe). Preenchida pela tag PAGAMENTO da Maia quando nula; a equipe pode trocar.';
comment on column crm.deals.resgate is
  'Lead antigo reativado por campanha. Marcação, não posição: convive com qualquer estágio.';
comment on column crm.deals.motivo is
  'O "campo lateral" da planilha da diretoria: motivo do encaminhamento, da objeção ou da perda na posição atual.';
comment on column crm.deals.stage_changed_at is
  'Quando o negócio entrou na posição atual. Mantido pelo trigger crm.marcar_troca_de_estagio.';

create or replace function crm.marcar_troca_de_estagio()
returns trigger
language plpgsql
set search_path = crm, public
as $$
begin
  if new.stage_id is distinct from old.stage_id then
    new.stage_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists marcar_troca_de_estagio on crm.deals;
create trigger marcar_troca_de_estagio
  before update of stage_id on crm.deals
  for each row execute function crm.marcar_troca_de_estagio();

-- ----------------------------------------------------------------------------
-- 2. Os 17 estágios, em toda organização que já tem funil
--
-- Os antigos saem do caminho primeiro: position + 1000 libera
-- uq_pipeline_stage_org_position para as posições 1..17. Só os que ainda não
-- têm slug — reexecutar a migration não empurra nada duas vezes.
-- ----------------------------------------------------------------------------
update crm.pipeline_stages
   set is_active = false,
       position  = position + 1000
 where slug is null
   and position < 1000;

with funil (position, slug, title, trilha, color, auto_win, auto_lose, is_system, exige_motivo, description) as (
  values
    ( 1, 'novo',                     'Novo',                                   'ambas',      '#64748b', false, false, true,  false, 'Abriu conversa, ainda sem qualificação.'),
    ( 2, 'em_qualificacao',          'Em qualificação',                        'ambas',      '#6366f1', false, false, false, false, 'Maia coletando os 4 fatos: motivo, laudo, o que já fez, pagamento.'),
    ( 3, 'qualificado',              'Qualificado',                            'ambas',      '#8b5cf6', false, false, false, false, '4 fatos em mãos e rota definida.'),
    ( 4, 'proposta_apresentada',     'Proposta apresentada',                   'particular', '#0ea5e9', false, false, false, false, 'Valor, horários ou caminho apresentado.'),
    ( 5, 'agendado',                 'Agendado',                               'particular', '#06b6d4', false, false, false, false, 'Avaliação Inicial, Av. Neuro, consulta médica ou entrevista inicial confirmada pelo sistema.'),
    ( 6, 'aguardando_elegibilidade', 'Aguardando elegibilidade / autorização', 'convenio',   '#f59e0b', false, false, false, false, 'Documentos completos entregues. A autorização confere plano, especialidade e autorização da operadora. Prazo interno: 48 horas úteis.'),
    ( 7, 'encaminhado_humano',       'Encaminhado para humano',                'ambas',      '#f97316', false, false, false, true,  'Passado para a equipe por outro motivo que não elegibilidade: queixa clínica, pediu pessoa, RQE, reclamação, plano não credenciado, advogado, decisão judicial.'),
    ( 8, 'entrevista_agendada',      'Entrevista agendada',                    'ambas',      '#14b8a6', false, false, false, false, 'Entrevista familiar/inicial marcada. Convênio: só depois da elegibilidade.'),
    ( 9, 'compareceu',               'Compareceu',                             'ambas',      '#10b981', false, false, false, false, 'Veio à avaliação, entrevista ou 1ª consulta.'),
    (10, 'aguardando_cronograma',    'Aguardando montagem do cronograma',      'ambas',      '#84cc16', false, false, false, false, 'Tratamento que exige montagem de grade (ABA, programa, várias especialidades). Convênio: também aguarda a liberação da operadora para a data de início.'),
    (11, 'iniciou_tratamento',       'Iniciou tratamento',                     'ambas',      '#22c55e', true,  false, true,  false, 'Cronograma em vigência, primeira sessão realizada.'),
    (12, 'em_follow_up',             'Em follow-up',                           'ambas',      '#a855f7', false, false, false, false, 'Parou de responder; a equipe retoma por template (janela de 24h).'),
    (13, 'perdido_objecao',          'Perdido / Objeção',                      'ambas',      '#ef4444', false, true,  true,  true,  'Recuou. Motivo em uma frase.'),
    (14, 'perdido_nao_elegivel',     'Perdido / Não elegível',                 'convenio',   '#dc2626', false, true,  true,  true,  'Plano ou diagnóstico fora da regra de credenciamento; família orientada para alternativa (Av. Neuro pelo plano, particular, reembolso).'),
    (15, 'nao_qualificado',          'Não qualificado',                        'ambas',      '#94a3b8', false, true,  true,  false, 'Fora do escopo: idade, serviço que não temos, não-paciente.'),
    (16, 'sem_interesse',            'Sem interesse',                          'ambas',      '#9ca3af', false, true,  true,  false, 'Disse que não quer.'),
    (17, 'nunca_respondeu',          'Nunca respondeu',                        'ambas',      '#6b7280', false, true,  true,  false, 'Abriu e sumiu; inclui telefone inativo (anotar o motivo).')
)
insert into crm.pipeline_stages (
  organization_id, position, slug, title, trilha, color,
  auto_win, auto_lose, is_system, exige_motivo, description, is_active
)
select o.organization_id, f.position, f.slug, f.title, f.trilha, f.color,
       f.auto_win, f.auto_lose, f.is_system, f.exige_motivo, f.description, true
  from (select distinct organization_id from crm.pipeline_stages) o
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

-- Deal aberto parado num estágio antigo iria sumir do board (o adapter
-- descarta deal sem coluna ativa). Vai para "Novo" da mesma org.
update crm.deals d
   set stage_id = n.id
  from crm.pipeline_stages velho, crm.pipeline_stages n
 where velho.id = d.stage_id
   and velho.slug is null
   and n.organization_id = d.organization_id
   and n.slug = 'novo'
   and d.status = 'open';

-- ----------------------------------------------------------------------------
-- 3. RLS — todo usuário da Central na org
--
-- `ca_current_role() is not null` e não uma lista de papéis: central_role é
-- texto livre (sem CHECK), e a decisão foi "todo operador da org". Uma lista
-- fixa deixaria de fora, calada, quem tivesse um papel escrito diferente — e
-- policy que barra devolve 0 linhas, não erro.
--
-- `(select …)` para o Postgres avaliar uma vez por consulta (initplan), como
-- em 20260924180200.
-- ----------------------------------------------------------------------------
drop policy if exists pipeline_stages_select on crm.pipeline_stages;
create policy pipeline_stages_select
  on crm.pipeline_stages for select to authenticated
  using (
    organization_id = (select central.current_organization_id())
    and (select central.ca_current_role()) is not null
  );

drop policy if exists deals_select on crm.deals;
create policy deals_select
  on crm.deals for select to authenticated
  using (
    organization_id = (select central.current_organization_id())
    and (select central.ca_current_role()) is not null
  );

drop policy if exists deals_insert on crm.deals;
create policy deals_insert
  on crm.deals for insert to authenticated
  with check (
    organization_id = (select central.current_organization_id())
    and (select central.ca_current_role()) is not null
  );

drop policy if exists deals_update on crm.deals;
create policy deals_update
  on crm.deals for update to authenticated
  using (
    organization_id = (select central.current_organization_id())
    and (select central.ca_current_role()) is not null
  )
  with check (
    organization_id = (select central.current_organization_id())
    and (select central.ca_current_role()) is not null
  );

drop policy if exists deal_activities_select on crm.deal_activities;
create policy deal_activities_select
  on crm.deal_activities for select to authenticated
  using (
    organization_id = (select central.current_organization_id())
    and (select central.ca_current_role()) is not null
  );

drop policy if exists deal_activities_insert on crm.deal_activities;
create policy deal_activities_insert
  on crm.deal_activities for insert to authenticated
  with check (
    organization_id = (select central.current_organization_id())
    and (select central.ca_current_role()) is not null
  );

drop policy if exists deal_activities_update on crm.deal_activities;
create policy deal_activities_update
  on crm.deal_activities for update to authenticated
  using (
    organization_id = (select central.current_organization_id())
    and (select central.ca_current_role()) is not null
  )
  with check (
    organization_id = (select central.current_organization_id())
    and (select central.ca_current_role()) is not null
  );

-- ----------------------------------------------------------------------------
-- 4. Entrada automática: conversa nova no número da Maia → "Novo"
--
-- Regras (decididas com a diretoria em 28/09/2026):
--   - só números que NÃO são Evolution: nos Evolution não há Maia e quem
--     escreve ali costuma ser quem já é atendido (autorização, recepção);
--   - só contato SEM vínculo com paciente do TiTa (mesma regra de
--     FichaService.deveColetar): paciente em tratamento remarcando sessão não
--     é oportunidade;
--   - contato bloqueado ou provisório fica fora (mesmo filtro do
--     crm.auto_create_deal_on_lead).
--
-- Contato que JÁ tem negócio aberto não ganha outro (uq_open_deal_per_contact):
-- o negócio passa a apontar para a conversa nova, que é onde a Maia vai
-- continuar classificando e onde "Ver conversa" deve levar.
--
-- NUNCA derruba a conversa: um erro aqui abortaria o INSERT da conversa e a
-- mensagem do responsável se perderia. O bloco de exceção engole e avisa.
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
  if exists (
    select 1 from central.channels ch
     where ch.id = new.channel_id and ch.provider = 'evolution'
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

  select coalesce(nullif(trim(c.name), ''), c.display_phone, 'Contato sem nome')
    into v_nome
    from central.contacts c
   where c.id = new.contact_id
     and c.status <> 'blocked'
     and not c.is_provisional;
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

drop trigger if exists criar_negocio_na_conversa_nova on central.conversations;
create trigger criar_negocio_na_conversa_nova
  after insert on central.conversations
  for each row execute function crm.criar_negocio_na_conversa_nova();

-- ----------------------------------------------------------------------------
-- 5. Tags da Maia → funil
--
-- PAGAMENTO define a trilha, uma vez: se o negócio já tem trilha (a equipe
-- escolheu, ou a Maia já definiu), a tag não sobrescreve.
--   particular | reembolso → particular
--   convenio_credenciado   → convenio
--   convenio_nao_credenciado e gratuidade ficam sem trilha: o caminho deles
--   (Rota D, ação social) é decisão humana.
--
-- TIPO DE CONTATO = não-paciente (curso, trabalhe conosco, parceria, …) é a
-- definição da diretoria para "Não qualificado". Só age enquanto o negócio
-- está no começo (Novo / Em qualificação): depois disso alguém da equipe já
-- mexeu nele, e a Maia não desfaz trabalho humano.
--
-- Mesmo cuidado da entrada: nunca derruba a gravação das tags.
-- ----------------------------------------------------------------------------
create or replace function crm.funil_pelas_tags()
returns trigger
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
   where d.organization_id = new.organization_id
     and d.contact_id = new.contact_id
     and d.status = 'open';
  if not found then
    return new;
  end if;

  if v_deal.trilha is null then
    v_trilha := case
      when new.tags && array['convenio_credenciado']      then 'convenio'
      when new.tags && array['particular', 'reembolso']  then 'particular'
    end;
    if v_trilha is not null then
      update crm.deals set trilha = v_trilha where id = v_deal.id;
      insert into crm.deal_activities (organization_id, deal_id, type, title, created_by_ai)
      values (new.organization_id, v_deal.id, 'status_change',
              'Trilha definida pela Maia: ' || case v_trilha when 'convenio' then 'Convênio' else 'Particular' end,
              true);
    end if;
  end if;

  select t.label into v_rotulo
    from unnest(new.tags) as tag(key)
    join central.tag_definitions t
      on t.organization_id = new.organization_id and t.key = tag.key
   where tag.key like 'nao_paciente\_%'
     and not (coalesce(old.tags, '{}') @> array[tag.key])
   limit 1;

  if v_rotulo is not null then
    select s.slug into v_slug_atual from crm.pipeline_stages s where s.id = v_deal.stage_id;
    select s.id into v_destino
      from crm.pipeline_stages s
     where s.organization_id = new.organization_id and s.slug = 'nao_qualificado' and s.is_active;

    if v_destino is not null and v_slug_atual in ('novo', 'em_qualificacao') then
      update crm.deals
         set stage_id      = v_destino,
             status        = 'lost',
             closed_at     = now(),
             closed_reason = v_rotulo,
             motivo        = v_rotulo
       where id = v_deal.id;
      insert into crm.deal_activities (organization_id, deal_id, type, title, created_by_ai)
      values (new.organization_id, v_deal.id, 'status_change',
              'Movido para "Não qualificado" pela Maia (' || v_rotulo || ')', true);
    end if;
  end if;

  return new;
exception when others then
  raise warning '[crm] funil não atualizado pelas tags da conversa %: %', new.id, sqlerrm;
  return new;
end;
$$;

revoke all on function crm.funil_pelas_tags() from public, anon, authenticated;

drop trigger if exists funil_pelas_tags on central.conversations;
create trigger funil_pelas_tags
  after update of tags on central.conversations
  for each row
  when (new.tags is distinct from old.tags)
  execute function crm.funil_pelas_tags();

insert into supabase_migrations.schema_migrations (version, name)
values ('20260930100000', 'crm_funil_diretoria')
on conflict (version) do nothing;

commit;

-- ============================================================================
-- CONFERÊNCIA (somente leitura) — rode depois do commit
--
-- ESPERADO: 17 linhas ativas, posições 1..17, iniciou_tratamento com
-- auto_win, as 5 de perda com auto_lose; e as 6 antigas inativas em 1000+.
-- ============================================================================
select position, slug, title, trilha, auto_win, auto_lose, exige_motivo, is_active
  from crm.pipeline_stages
 order by organization_id, position;

select tgname, tgrelid::regclass
  from pg_trigger
 where tgname in ('criar_negocio_na_conversa_nova', 'funil_pelas_tags', 'marcar_troca_de_estagio');
