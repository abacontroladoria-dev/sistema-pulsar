-- Aplica 20261019210000_app_agenda_cobertura (Fase 2 do app de evoluções).
-- Teste PGlite: supabase/tests/app_agenda_cobertura.pglite.mjs (36/36). Ensaio em produção 19/10 (desfeito):
-- agenda de 7 dias do profissional mais cheio = 62 sessões em ~0,2 s; 31 dias = 212 em ~0,6 s; admin segue evoluindo.
begin;

-- Fase 2 do app de evoluções (docs/app-evolucoes/PLANO_BACKEND.md): cobertura
-- planejada, Grade aberta ao terapeuta na própria agenda e leitura da agenda
-- pelo app.
--
-- 1. grade_coberturas — "o profissional X cobre a sessão Y", gravado ANTES do
--    atendimento pela equipe da Grade (permissão cronograma_grade). Hoje a
--    substituição só aparecia depois, quando a evolução saía no nome de outro.
--    Uma linha por sessão; remover = apagar a linha (o histórico fica em
--    grade_eventos, com as ações novas cobertura_definida/cobertura_removida).
--
-- 2. sp_grade_pode_evoluir(p_agendamento_id) — o gancho que 20261016180000 e
--    20261019120000 deixaram para esta fase. Pode evoluir: admin; ou terapeuta
--    ativo (role 'terapeuta', ligado a profissional ativo) quando ele é o
--    profissional EFETIVO da sessão: o da cobertura, se houver; senão o agendado.
--    Sessão coberta sai do alcance do agendado original. A mesma regra libera ao
--    terapeuta o texto da evolução (grade_detalhe_evolucao) e a linha de
--    grade_evolucoes (policy grade_evolucoes_select).
--
-- 3. sp_grade_exigir_evoluir — chamado pelas três RPCs que gravam
--    (grade_registrar_evolucao, grade_registrar_falta, grade_limpar_evolucao).
--    Para o terapeuta, além de poder evoluir a sessão: ela já começou (horário de
--    Brasília), não foi excluída, ainda NÃO tem registro (corrigir é com a
--    coordenação — por isso o terapeuta também não consegue limpar) e a recepção
--    não marcou falta nela. As RPCs grandes não são reescritas.
--
-- 4. Gatilho sp_grade_evolucoes_regras_terapeuta em grade_evolucoes — o que a
--    porta de entrada não vê: terapeuta registra só falta do PACIENTE (decisão de
--    19/10/2026) e a evolução fica no nome dele (o parâmetro
--    p_profissional_substituto_id não serve para pôr o registro em nome de outro).
--
-- 5. app_agenda(p_de, p_ate, p_profissional_id) e app_agenda_profissionais() —
--    leitura do app. Terapeuta vê a própria agenda + o que cobre (e as suas
--    sessões cobertas por outro, marcadas como tal); gestão (admin, diretoria)
--    escolhe o profissional. Nunca devolve o texto da evolução: ele vem só por
--    grade_detalhe_evolucao, que já filtra por sp_grade_pode_evoluir.
--
-- Idempotente.

set local lock_timeout = '5s';

-- ── 1. Cobertura ────────────────────────────────────────────────────────────
create table if not exists public.grade_coberturas (
  agendamento_id   uuid primary key references public.grade_agendamentos(id) on delete cascade,
  profissional_id  bigint not null references public.profissionais(id) on delete restrict,
  criado_por       uuid,
  criado_por_nome  text,
  criado_em        timestamptz not null default now()
);

create index if not exists idx_grade_coberturas_profissional on public.grade_coberturas (profissional_id);

comment on table public.grade_coberturas is
  'Cobertura planejada: profissional que vai atender a sessão no lugar do agendado. Escrita só por grade_definir_cobertura/grade_remover_cobertura.';

alter table public.grade_coberturas enable row level security;

drop policy if exists "grade_coberturas_select" on public.grade_coberturas;
create policy "grade_coberturas_select" on public.grade_coberturas
  for select to authenticated
  using ((select public.usuario_tem_permissao('cronograma_grade')));

revoke all on public.grade_coberturas from public, anon, authenticated;
grant select on public.grade_coberturas to authenticated;
grant all on public.grade_coberturas to service_role;

-- Ações novas no histórico da Grade (mantém as existentes).
do $$
declare
  v_nome text;
begin
  for v_nome in
    select c.conname from pg_constraint c
     where c.conrelid = 'public.grade_eventos'::regclass and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%acao%'
  loop
    execute format('alter table public.grade_eventos drop constraint %I', v_nome);
  end loop;

  alter table public.grade_eventos add constraint grade_eventos_acao_check check (acao in (
    'criado', 'excluido', 'serie_encerrada', 'estendido', 'importado', 'bloqueio_criado',
    'bloqueio_excluido', 'inativacao_profissional', 'evoluido', 'evolucao_editada',
    'falta_registrada', 'evolucao_removida', 'cobertura_definida', 'cobertura_removida'
  ));
end $$;

-- ── 2. Quem pode evoluir a sessão ───────────────────────────────────────────
create or replace function public.sp_grade_pode_evoluir(p_agendamento_id uuid default null)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  if public.sp_grade_eh_admin() then
    return true;
  end if;
  if p_agendamento_id is null then
    return false;
  end if;

  -- Terapeuta do app, na sessão de que ele é o profissional efetivo.
  return exists (
    select 1
      from public.usuarios u
      join public.profissionais p on p.id = u.profissional_id and p.ativo
      join public.grade_agendamentos ag on ag.id = p_agendamento_id
      left join public.grade_coberturas c on c.agendamento_id = ag.id
     where u.id = auth.uid()
       and coalesce(u.ativo, false)
       and u.role = 'terapeuta'
       and coalesce(c.profissional_id, ag.profissional_id) = u.profissional_id
  );
end $$;

-- ── 3. Porta de entrada das gravações ───────────────────────────────────────
create or replace function public.sp_grade_exigir_evoluir(p_agendamento_id uuid default null)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a record;
begin
  if not public.sp_grade_pode_evoluir(p_agendamento_id) then
    raise exception 'Sem permissão para evoluir ou registrar falta nesta sessão.'
      using errcode = '42501';
  end if;

  if public.sp_grade_eh_admin() then
    return;
  end if;

  -- Daqui para baixo: terapeuta.
  select ag.*, pac.tita_paciente_id as pac_tita_id, coalesce(pac.nome, ag.paciente_nome) as pac_nome_atual
    into a
    from public.grade_agendamentos ag
    left join public.pacientes pac on pac.id_paciente = ag.paciente_id
   where ag.id = p_agendamento_id;

  if a.situacao = 'excluido' then
    raise exception 'Esta sessão foi excluída da Grade.' using errcode = '22023';
  end if;

  if (a.data + a.hora_inicio) > (now() at time zone 'America/Sao_Paulo') then
    raise exception 'A sessão ainda não começou.' using errcode = '22023';
  end if;

  if exists (select 1 from public.grade_evolucoes e where e.agendamento_id = p_agendamento_id) then
    raise exception 'Esta sessão já tem registro. Para corrigir, fale com a coordenação.'
      using errcode = '42501';
  end if;

  if public.sp_grade_falta_recepcao(
       a.tita_agendamento_id, a.paciente_id, coalesce(a.tita_paciente_id, a.pac_tita_id),
       a.pac_nome_atual, a.data, a.hora_inicio
     ) is not null then
    raise exception 'A recepção registrou falta neste atendimento. Fale com a coordenação.'
      using errcode = '42501';
  end if;
end $$;

-- ── 4. Regras do terapeuta no próprio registro ──────────────────────────────
create or replace function public.sp_grade_evolucoes_regras_terapeuta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prof bigint;
begin
  -- Rotinas sem JWT (importação do TiTa, SQL Editor) e admin: livres.
  if auth.uid() is null or public.sp_grade_eh_admin() then
    return new;
  end if;

  select u.profissional_id into v_prof
    from public.usuarios u
   where u.id = auth.uid() and u.role = 'terapeuta';
  if not found then
    return new;  -- outros papéis nem passam por sp_grade_exigir_evoluir
  end if;

  if new.tipo_falta = 'terapeuta' then
    raise exception 'O terapeuta registra só falta do paciente. Falta do profissional é com a coordenação.'
      using errcode = '42501';
  end if;

  if new.possui_tratativa and new.tratativa_profissional_id is distinct from v_prof then
    raise exception 'A evolução fica no nome de quem atendeu.' using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists trg_grade_evolucoes_regras_terapeuta on public.grade_evolucoes;
create trigger trg_grade_evolucoes_regras_terapeuta
  before insert or update on public.grade_evolucoes
  for each row execute function public.sp_grade_evolucoes_regras_terapeuta();

-- ── 1b. Gravar/remover cobertura (equipe da Grade) ──────────────────────────
create or replace function public.grade_definir_cobertura(p_agendamento_id uuid, p_profissional_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a       record;
  pr      record;
  ant     record;
  v_autor record;
begin
  perform public.sp_grade_exigir_permissao();

  select ag.*, coalesce(pac.nome, ag.paciente_nome) as pac_nome_atual,
         coalesce(pa.nome, ag.profissional_nome) as prof_nome_atual
    into a
    from public.grade_agendamentos ag
    left join public.pacientes pac on pac.id_paciente = ag.paciente_id
    left join public.profissionais pa on pa.id = ag.profissional_id
   where ag.id = p_agendamento_id
   for update of ag;
  if not found then
    raise exception 'Sessão não encontrada.' using errcode = 'P0002';
  end if;
  if a.situacao = 'excluido' then
    raise exception 'Esta sessão foi excluída da Grade.' using errcode = '22023';
  end if;

  select p.id, p.nome into pr from public.profissionais p where p.id = p_profissional_id and p.ativo;
  if not found then
    raise exception 'Profissional não encontrado ou inativo.' using errcode = 'P0002';
  end if;
  if pr.id = a.profissional_id then
    raise exception 'O profissional escolhido já é o da sessão.' using errcode = '22023';
  end if;
  if exists (select 1 from public.grade_evolucoes e where e.agendamento_id = a.id) then
    raise exception 'Esta sessão já tem evolução ou falta registrada.' using errcode = '22023';
  end if;

  select * into v_autor from public.sp_grade_autor_evolucao();
  select c.*, p.nome as prof_nome into ant
    from public.grade_coberturas c left join public.profissionais p on p.id = c.profissional_id
   where c.agendamento_id = a.id;

  insert into public.grade_coberturas (agendamento_id, profissional_id, criado_por, criado_por_nome, criado_em)
  values (a.id, pr.id, v_autor.usuario_id, v_autor.usuario_nome, now())
  on conflict (agendamento_id) do update
     set profissional_id = excluded.profissional_id,
         criado_por      = excluded.criado_por,
         criado_por_nome = excluded.criado_por_nome,
         criado_em       = excluded.criado_em;

  insert into public.grade_eventos (
    acao, agendamento_id, serie_id, profissional_id, paciente_id, quantidade,
    antes, depois, resumo, feito_por, feito_por_nome
  ) values (
    'cobertura_definida', a.id, a.serie_id, a.profissional_id, a.paciente_id, 1,
    case when ant.agendamento_id is not null
      then jsonb_build_object('cobertura_profissional_id', ant.profissional_id, 'cobertura_profissional_nome', ant.prof_nome)
      else null end,
    jsonb_build_object('cobertura_profissional_id', pr.id, 'cobertura_profissional_nome', pr.nome),
    'Cobertura (' || to_char(a.data, 'DD/MM/YYYY') || ' ' || to_char(a.hora_inicio, 'HH24:MI') || ') — '
      || a.pac_nome_atual || ' × ' || a.prof_nome_atual || ' · coberta por ' || pr.nome,
    v_autor.usuario_id, v_autor.usuario_nome
  );

  return jsonb_build_object('agendamento_id', a.id, 'profissional_id', pr.id, 'profissional_nome', pr.nome);
end $$;

create or replace function public.grade_remover_cobertura(p_agendamento_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a       record;
  ant     record;
  v_autor record;
begin
  perform public.sp_grade_exigir_permissao();

  select ag.*, coalesce(pac.nome, ag.paciente_nome) as pac_nome_atual,
         coalesce(pa.nome, ag.profissional_nome) as prof_nome_atual
    into a
    from public.grade_agendamentos ag
    left join public.pacientes pac on pac.id_paciente = ag.paciente_id
    left join public.profissionais pa on pa.id = ag.profissional_id
   where ag.id = p_agendamento_id;
  if not found then
    raise exception 'Sessão não encontrada.' using errcode = 'P0002';
  end if;

  delete from public.grade_coberturas c where c.agendamento_id = a.id returning c.* into ant;
  if not found then
    return;
  end if;

  select * into v_autor from public.sp_grade_autor_evolucao();
  insert into public.grade_eventos (
    acao, agendamento_id, serie_id, profissional_id, paciente_id, quantidade,
    antes, resumo, feito_por, feito_por_nome
  ) values (
    'cobertura_removida', a.id, a.serie_id, a.profissional_id, a.paciente_id, 1,
    jsonb_build_object('cobertura_profissional_id', ant.profissional_id),
    'Cobertura removida (' || to_char(a.data, 'DD/MM/YYYY') || ' ' || to_char(a.hora_inicio, 'HH24:MI') || ') — '
      || a.pac_nome_atual || ' × ' || a.prof_nome_atual,
    v_autor.usuario_id, v_autor.usuario_nome
  );
end $$;

-- ── 5. Leitura do app ───────────────────────────────────────────────────────
create or replace function public.app_agenda(p_de date, p_ate date, p_profissional_id bigint default null)
returns table (
  agendamento_id              uuid,
  data                        date,
  hora_inicio                 time,
  hora_fim                    time,
  paciente_nome               text,
  terapia_nome                text,
  sala_nome                   text,
  unidade_nome                text,
  profissional_id             bigint,
  profissional_nome           text,
  cobertura_profissional_id   bigint,
  cobertura_profissional_nome text,
  efetivo                     boolean,
  registrado                  boolean,
  status_execucao             text,
  tipo_falta                  text,
  possui_tratativa            boolean,
  tratativa_profissional_nome text,
  tratativa_criada_em         timestamptz,
  falta_recepcao              boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_prof bigint;
  v_alvo bigint;
begin
  select u.role, u.profissional_id into v_role, v_prof
    from public.usuarios u
   where u.id = auth.uid() and coalesce(u.ativo, false);

  if v_role = 'terapeuta' and exists (select 1 from public.profissionais p where p.id = v_prof and p.ativo) then
    v_alvo := v_prof;                  -- terapeuta: sempre a própria agenda
  elsif v_role in ('admin', 'diretoria') then
    if p_profissional_id is null then
      raise exception 'Escolha o profissional.' using errcode = '22023';
    end if;
    v_alvo := p_profissional_id;
  else
    raise exception 'Sem acesso à agenda do app.' using errcode = '42501';
  end if;

  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 31 then
    raise exception 'Período inválido (até 31 dias).' using errcode = '22023';
  end if;

  return query
  select
    ag.id,
    ag.data,
    ag.hora_inicio,
    ag.hora_fim,
    coalesce(pac.nome, ag.paciente_nome),
    coalesce(nullif(btrim(ag.terapia_exibicao_nome), ''), ag.terapia_nome),
    ag.sala_nome,
    ag.unidade_nome,
    ag.profissional_id,
    coalesce(pr_ag.nome, ag.profissional_nome),
    c.profissional_id,
    pr_c.nome,
    -- O profissional consultado é quem atende (o da cobertura, se houver)?
    -- false = sessão dele coberta por outro: aparece, mas não é dele evoluir.
    coalesce(c.profissional_id, ag.profissional_id) = v_alvo,
    e.agendamento_id is not null,
    coalesce(e.status_execucao, case when fr.tipo is not null then 'Cancelado' end),
    coalesce(e.tipo_falta, fr.tipo),
    coalesce(e.possui_tratativa, false),
    case when coalesce(e.possui_tratativa, false) then coalesce(pr_tr.nome, e.tratativa_profissional_nome) end,
    case when coalesce(e.possui_tratativa, false) then e.tratativa_criada_em end,
    fr.tipo is not null
  from public.grade_agendamentos ag
  left join public.grade_coberturas c on c.agendamento_id = ag.id
  left join public.grade_evolucoes e on e.agendamento_id = ag.id
  left join public.pacientes pac on pac.id_paciente = ag.paciente_id
  left join public.profissionais pr_ag on pr_ag.id = ag.profissional_id
  left join public.profissionais pr_c on pr_c.id = c.profissional_id
  left join public.profissionais pr_tr on pr_tr.id = e.tratativa_profissional_id
  cross join lateral (
    select public.sp_grade_falta_recepcao(
      ag.tita_agendamento_id, ag.paciente_id,
      coalesce(ag.tita_paciente_id, pac.tita_paciente_id),
      coalesce(pac.nome, ag.paciente_nome), ag.data, ag.hora_inicio
    ) as tipo
  ) fr
  where ag.situacao = 'agendado'
    and ag.data between p_de and p_ate
    and (ag.profissional_id = v_alvo or c.profissional_id = v_alvo)
  order by ag.data, ag.hora_inicio, coalesce(pac.nome, ag.paciente_nome);
end $$;

create or replace function public.app_agenda_profissionais()
returns table (id bigint, nome text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.usuarios u
     where u.id = auth.uid() and coalesce(u.ativo, false) and u.role in ('admin', 'diretoria')
  ) then
    raise exception 'Sem acesso à lista de profissionais.' using errcode = '42501';
  end if;

  return query
  select p.id, p.nome from public.profissionais p where p.ativo order by p.nome;
end $$;

-- ── Permissões ──────────────────────────────────────────────────────────────
revoke all on function public.sp_grade_pode_evoluir(uuid)              from public, anon, authenticated;
revoke all on function public.sp_grade_exigir_evoluir(uuid)            from public, anon, authenticated;
revoke all on function public.sp_grade_evolucoes_regras_terapeuta()    from public, anon, authenticated;

revoke all on function public.grade_definir_cobertura(uuid, bigint)    from public, anon;
revoke all on function public.grade_remover_cobertura(uuid)            from public, anon;
revoke all on function public.app_agenda(date, date, bigint)           from public, anon;
revoke all on function public.app_agenda_profissionais()               from public, anon;

grant execute on function public.grade_definir_cobertura(uuid, bigint) to authenticated;
grant execute on function public.grade_remover_cobertura(uuid)         to authenticated;
grant execute on function public.app_agenda(date, date, bigint)        to authenticated;
grant execute on function public.app_agenda_profissionais()            to authenticated;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261019210000', 'app_agenda_cobertura')
on conflict (version) do nothing;

commit;

-- Conferência
select to_regclass('public.grade_coberturas') is not null as coberturas_ok,
       exists (select 1 from pg_trigger where tgname = 'trg_grade_evolucoes_regras_terapeuta') as gatilho_ok,
       pg_get_functiondef('public.sp_grade_pode_evoluir(uuid)'::regprocedure) like '%grade_coberturas%' as pode_evoluir_ok,
       has_function_privilege('authenticated', 'public.app_agenda(date,date,bigint)', 'EXECUTE')
         and not has_function_privilege('anon', 'public.app_agenda(date,date,bigint)', 'EXECUTE') as agenda_ok,
       (select pg_get_constraintdef(oid) from pg_constraint where conname = 'grade_eventos_acao_check') like '%cobertura_removida%' as acoes_ok,
       exists (select 1 from supabase_migrations.schema_migrations where version = '20261019210000') as registrada;
