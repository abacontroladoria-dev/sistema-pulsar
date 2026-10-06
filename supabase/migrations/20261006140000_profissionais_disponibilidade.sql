-- Disponibilidade do profissional — versionada, imutável e com vigência.
--
-- O profissional declara em que dias e horários atende, o que pode prestar em
-- cada faixa e em qual local. Decisões do usuário (06/10/2026):
--
--   - Seg–Sáb, cada dia liga/desliga. Várias faixas por dia ("08:00–12:00" e
--     "13:00–17:40"), cada uma com duração de sessão (padrão 40 min), intervalo
--     opcional (padrão 12:00–13:00), UMA ou MAIS terapias (= pode prestar
--     qualquer uma delas naquele horário, como os horários livres da TiTa com
--     "Psicopedagogia, Psicomotricidade") e um local.
--   - HISTÓRICO ROBUSTO COM VIGÊNCIA. Cada versão vale de `vigente_de` até
--     `vigente_ate` (null = prazo indeterminado). Vencido o prazo, a grade fica
--     INATIVA. Pode-se agendar versão futura ("vale a partir de 01/11").
--   - Só terapias HABILITADAS do profissional entram numa faixa.
--
-- Decisões técnicas:
--
-- 1. IMUTÁVEL. Conteúdo de versão, faixas e terapias nunca muda nem é apagado
--    (gatilhos recusam). A única coisa editável é a VIGÊNCIA da versão, e só
--    pelas RPCs abaixo, com evento gravado. Corrigir uma grade = nova versão.
--
-- 2. PERÍODOS SEM SOBREPOSIÇÃO por profissional, num gatilho com trava
--    consultiva por profissional (sem depender de btree_gist). Para uma data
--    qualquer existe no máximo uma versão valendo.
--
-- 3. LOCAL SEM FK, COM CÓPIA DO NOME. A faixa guarda local_id (cronograma_salas)
--    e o nome/unidade do momento. Ocupação de Salas apaga sala com DELETE físico;
--    com FK, ou travaria aquela tela ou apagaria histórico. A RPC confere que o
--    local existe na hora de criar.
--
-- 4. ESCRITA SÓ POR RPC; LEITURA SÓ COM cadastros_profissionais. anon sem nada.
--
-- 5. "HOJE" É O DE BRASÍLIA. current_date do servidor é UTC — às 21h daqui já
--    seria amanhã, e uma versão "vigente a partir de amanhã" apareceria vigente.
--
-- Idempotente.

-- ═════════════════════════════════════════════════════════════════════════════
-- Hoje em Brasília
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.hoje_brasilia()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

comment on function public.hoje_brasilia() is
  'Data de hoje no fuso de Brasília (current_date do banco é UTC).';

-- ═════════════════════════════════════════════════════════════════════════════
-- A) Versões
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.profissionais_disponibilidade_versoes (
  id               uuid primary key default gen_random_uuid(),
  profissional_id  bigint not null references public.profissionais(id) on delete restrict,
  -- Calculado pelo gatilho; qualquer valor enviado é ignorado.
  numero           integer not null default 0,
  vigente_de       date not null,
  vigente_ate      date,
  dias_ativos      smallint[] not null default '{}',
  origem           text not null default 'manual',
  restaurada_de    uuid references public.profissionais_disponibilidade_versoes(id),
  motivo           text,
  criado_por       uuid,
  criado_por_nome  text,
  criado_em        timestamptz not null default now(),

  constraint prof_disp_versoes_numero_unico unique (profissional_id, numero),
  constraint prof_disp_versoes_periodo_check check (vigente_ate is null or vigente_ate >= vigente_de),
  constraint prof_disp_versoes_dias_check check (dias_ativos <@ array[1,2,3,4,5,6]::smallint[]),
  constraint prof_disp_versoes_origem_check check (origem in ('manual', 'preenchido_tita', 'restaurada')),
  constraint prof_disp_versoes_motivo_check check (coalesce(length(motivo), 0) <= 500)
);

create index if not exists idx_prof_disp_versoes_prof
  on public.profissionais_disponibilidade_versoes (profissional_id, vigente_de);

comment on table public.profissionais_disponibilidade_versoes is
  'Versões da disponibilidade semanal do profissional, com vigência [vigente_de, vigente_ate] (null = indeterminado). Conteúdo IMUTÁVEL; vigência só muda pelas RPCs profissional_disponibilidade_*. Sem sobreposição de período por profissional.';

-- ═════════════════════════════════════════════════════════════════════════════
-- B) Faixas e terapias da faixa
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.profissionais_disponibilidade_faixas (
  id                uuid primary key default gen_random_uuid(),
  versao_id         uuid not null references public.profissionais_disponibilidade_versoes(id) on delete restrict,
  dia_semana        smallint not null,
  hora_inicio       time not null,
  hora_fim          time not null,
  duracao_min       smallint not null default 40,
  intervalo_ativo   boolean not null default false,
  intervalo_inicio  time,
  intervalo_fim     time,
  local_id          uuid not null,
  local_nome        text not null,
  unidade_nome      text,
  ordem             smallint not null default 0,

  constraint prof_disp_faixas_dia_check check (dia_semana between 1 and 6),
  constraint prof_disp_faixas_horario_check check (hora_fim > hora_inicio),
  constraint prof_disp_faixas_duracao_check check (duracao_min in (30, 40, 45, 50, 60)),
  constraint prof_disp_faixas_intervalo_check check (
    not intervalo_ativo
    or (intervalo_inicio is not null and intervalo_fim is not null
        and intervalo_fim > intervalo_inicio
        and intervalo_inicio >= hora_inicio and intervalo_fim <= hora_fim)
  )
);

create index if not exists idx_prof_disp_faixas_versao on public.profissionais_disponibilidade_faixas (versao_id);
create index if not exists idx_prof_disp_faixas_local on public.profissionais_disponibilidade_faixas (local_id, dia_semana);

create table if not exists public.profissionais_disponibilidade_faixa_terapias (
  faixa_id      uuid not null references public.profissionais_disponibilidade_faixas(id) on delete restrict,
  terapia_id    bigint not null references public.cadastro_terapias(id),
  -- Nome do momento: a terapia pode ser renomeada no catálogo depois.
  terapia_nome  text not null,
  primary key (faixa_id, terapia_id)
);

-- ═════════════════════════════════════════════════════════════════════════════
-- C) Eventos (trilha append-only)
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.profissionais_disponibilidade_eventos (
  id                  bigint generated always as identity primary key,
  profissional_id     bigint not null references public.profissionais(id) on delete restrict,
  versao_id           uuid references public.profissionais_disponibilidade_versoes(id),
  tipo                text not null,
  antes               jsonb,
  depois              jsonb,
  motivo              text,
  usuario_id          uuid,
  usuario_nome        text,
  criado_em           timestamptz not null default now(),
  criado_em_brasilia  text,
  constraint prof_disp_eventos_tipo_check
    check (tipo in ('criar', 'encerrar', 'alterar_vigencia', 'restaurar'))
);

create index if not exists idx_prof_disp_eventos_prof
  on public.profissionais_disponibilidade_eventos (profissional_id, criado_em desc);

create or replace function public.sp_prof_disp_eventos_brasilia()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.criado_em := now();
  new.criado_em_brasilia := to_char(new.criado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');
  return new;
end $$;

drop trigger if exists trg_prof_disp_eventos_brasilia on public.profissionais_disponibilidade_eventos;
create trigger trg_prof_disp_eventos_brasilia
  before insert on public.profissionais_disponibilidade_eventos
  for each row execute function public.sp_prof_disp_eventos_brasilia();

-- ═════════════════════════════════════════════════════════════════════════════
-- D) Gatilhos de integridade
-- ═════════════════════════════════════════════════════════════════════════════

-- Versão: número calculado, conteúdo imutável, período sem sobreposição.
create or replace function public.sp_prof_disp_versoes_guarda()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_conflito record;
begin
  if tg_op = 'DELETE' then
    raise exception 'Versão de disponibilidade é histórico: não pode ser apagada.' using errcode = '42501';
  end if;

  -- Serializa as gravações do MESMO profissional: duas abas salvando juntas não
  -- passam ambas pela checagem de sobreposição.
  perform pg_advisory_xact_lock(hashtext('prof_disp_versoes'), new.profissional_id::integer);

  if tg_op = 'INSERT' then
    select coalesce(max(v.numero), 0) + 1 into new.numero
    from public.profissionais_disponibilidade_versoes v
    where v.profissional_id = new.profissional_id;
    new.criado_em := now();
  else
    if new.profissional_id is distinct from old.profissional_id
       or new.numero is distinct from old.numero
       or new.dias_ativos is distinct from old.dias_ativos
       or new.origem is distinct from old.origem
       or new.restaurada_de is distinct from old.restaurada_de
       or new.motivo is distinct from old.motivo
       or new.criado_por is distinct from old.criado_por
       or new.criado_por_nome is distinct from old.criado_por_nome
       or new.criado_em is distinct from old.criado_em then
      raise exception 'Só a vigência de uma versão pode mudar; o conteúdo é histórico.' using errcode = '42501';
    end if;
  end if;

  select v.numero, v.vigente_de, v.vigente_ate into v_conflito
  from public.profissionais_disponibilidade_versoes v
  where v.profissional_id = new.profissional_id
    and v.id <> new.id
    and daterange(v.vigente_de, v.vigente_ate, '[]') && daterange(new.vigente_de, new.vigente_ate, '[]')
  limit 1;

  if found then
    raise exception 'O período se sobrepõe à versão nº % (% a %).',
      v_conflito.numero,
      to_char(v_conflito.vigente_de, 'DD/MM/YYYY'),
      coalesce(to_char(v_conflito.vigente_ate, 'DD/MM/YYYY'), 'indeterminado')
      using errcode = '23P01';
  end if;

  return new;
end $$;

drop trigger if exists trg_prof_disp_versoes_guarda on public.profissionais_disponibilidade_versoes;
create trigger trg_prof_disp_versoes_guarda
  before insert or update or delete on public.profissionais_disponibilidade_versoes
  for each row execute function public.sp_prof_disp_versoes_guarda();

-- Faixas, terapias da faixa e eventos: nunca mudam.
create or replace function public.sp_prof_disp_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% é histórico imutável: % não é permitido.', tg_table_name, tg_op using errcode = '42501';
end $$;

drop trigger if exists trg_prof_disp_faixas_imutavel on public.profissionais_disponibilidade_faixas;
create trigger trg_prof_disp_faixas_imutavel
  before update or delete on public.profissionais_disponibilidade_faixas
  for each row execute function public.sp_prof_disp_imutavel();

drop trigger if exists trg_prof_disp_faixa_terapias_imutavel on public.profissionais_disponibilidade_faixa_terapias;
create trigger trg_prof_disp_faixa_terapias_imutavel
  before update or delete on public.profissionais_disponibilidade_faixa_terapias
  for each row execute function public.sp_prof_disp_imutavel();

drop trigger if exists trg_prof_disp_eventos_imutavel on public.profissionais_disponibilidade_eventos;
create trigger trg_prof_disp_eventos_imutavel
  before update or delete on public.profissionais_disponibilidade_eventos
  for each row execute function public.sp_prof_disp_imutavel();

-- ═════════════════════════════════════════════════════════════════════════════
-- E) Situação (views)
-- ═════════════════════════════════════════════════════════════════════════════
create or replace view public.vw_profissionais_disponibilidade_versoes
with (security_invoker = true) as
select
  v.*,
  case
    when v.vigente_de > public.hoje_brasilia() then 'agendada'
    when v.vigente_ate is not null and v.vigente_ate < public.hoje_brasilia() then 'encerrada'
    else 'vigente'
  end as situacao
from public.profissionais_disponibilidade_versoes v;

comment on view public.vw_profissionais_disponibilidade_versoes is
  'Versões com a situação de hoje (Brasília): vigente | agendada | encerrada.';

-- Uma linha por profissional que tem alguma versão.
--   vigente   = há versão valendo hoje;
--   agendada  = nada hoje, mas há versão futura;
--   inativa   = nada hoje nem no futuro, e a última terminou (grade encerrada).
create or replace view public.vw_profissionais_grade_situacao
with (security_invoker = true) as
with v as (
  select * from public.vw_profissionais_disponibilidade_versoes
)
select
  p.profissional_id,
  case
    when bool_or(p.situacao = 'vigente')  then 'vigente'
    when bool_or(p.situacao = 'agendada') then 'agendada'
    else 'inativa'
  end as situacao,
  (array_agg(p.id order by p.vigente_de) filter (where p.situacao = 'vigente'))[1]     as versao_vigente_id,
  max(p.vigente_de)  filter (where p.situacao = 'vigente')                              as vigente_desde,
  max(p.vigente_ate) filter (where p.situacao = 'vigente')                              as vigente_ate,
  min(p.vigente_de)  filter (where p.situacao = 'agendada')                             as proxima_de,
  max(p.vigente_ate) filter (where p.situacao = 'encerrada')                            as encerrada_em,
  count(*)                                                                              as total_versoes
from v p
group by p.profissional_id;

comment on view public.vw_profissionais_grade_situacao is
  'Situação da grade de cada profissional hoje (Brasília): vigente | agendada | inativa. Quem não tem linha = sem grade.';

-- ═════════════════════════════════════════════════════════════════════════════
-- F) Locais para o editor
-- ═════════════════════════════════════════════════════════════════════════════
-- cronograma_salas tem leitura por PAPEL (admin, diretoria, cronograma…); quem
-- só tem a permissão de Profissionais ficaria sem lista de locais. Esta função
-- devolve só o necessário para escolher o local (sem alocações nem auditoria).
create or replace function public.profissionais_locais()
returns table (
  id uuid,
  nome_exibicao text,
  unidade_nome text,
  numero_sala text,
  capacidade text,
  status text,
  sala_nome_referencia text,
  exclusividades jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.usuario_tem_permissao('cadastros_profissionais') then
    raise exception 'Sem permissão para listar os locais.' using errcode = '42501';
  end if;

  return query
  select
    s.id, s.nome_exibicao, s.unidade_nome, s.numero_sala, s.capacidade, s.status, s.sala_nome_referencia,
    coalesce((
      select jsonb_agg(jsonb_build_object('terapia_id', e.terapia_id, 'terapia_nome', e.terapia_nome, 'modo', e.modo))
      from public.cronograma_salas_terapias_exclusivas e
      where e.sala_id = s.id
    ), '[]'::jsonb)
  from public.cronograma_salas s
  order by s.unidade_nome, s.nome_exibicao;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- G) RPCs de escrita
-- ═════════════════════════════════════════════════════════════════════════════

-- Valida e grava as faixas de uma versão recém-criada. Chamada só pelas RPCs.
create or replace function public.sp_prof_disp_gravar_faixas(
  p_versao_id       uuid,
  p_profissional_id bigint,
  p_faixas          jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  f            jsonb;
  t            jsonb;
  v_faixa_id   uuid;
  v_local      record;
  v_terapia    record;
  v_ini        time;
  v_fim        time;
  v_dur        smallint;
  v_int        boolean;
  v_int_ini    time;
  v_int_fim    time;
  v_util       integer;
  v_n          integer := 0;
  v_conflito   record;
begin
  if jsonb_typeof(p_faixas) is distinct from 'array' then
    raise exception 'Faixas em formato inválido.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_faixas) > 60 then
    raise exception 'Faixas demais numa versão (máximo 60).' using errcode = '22023';
  end if;

  for f in select * from jsonb_array_elements(p_faixas) loop
    v_ini := (f ->> 'hora_inicio')::time;
    v_fim := (f ->> 'hora_fim')::time;
    v_dur := coalesce((f ->> 'duracao_min')::smallint, 40);
    v_int := coalesce((f ->> 'intervalo_ativo')::boolean, false);
    v_int_ini := case when v_int then (f ->> 'intervalo_inicio')::time end;
    v_int_fim := case when v_int then (f ->> 'intervalo_fim')::time end;

    -- Tempo útil = faixa menos intervalo; precisa caber ao menos uma sessão.
    v_util := (extract(epoch from (v_fim - v_ini)) / 60)::integer
              - case when v_int and v_int_fim > v_int_ini
                     then (extract(epoch from (v_int_fim - v_int_ini)) / 60)::integer else 0 end;
    if v_fim > v_ini and v_util < v_dur then
      raise exception 'A faixa % – % não comporta nenhuma sessão de % min.',
        to_char(v_ini, 'HH24:MI'), to_char(v_fim, 'HH24:MI'), v_dur using errcode = '22023';
    end if;

    select s.id, s.nome_exibicao, s.unidade_nome into v_local
    from public.cronograma_salas s
    where s.id = nullif(f ->> 'local_id', '')::uuid;
    if not found then
      raise exception 'Local não encontrado em Ocupação de Salas.' using errcode = '23503';
    end if;

    if jsonb_typeof(f -> 'terapias') is distinct from 'array' or jsonb_array_length(f -> 'terapias') = 0 then
      raise exception 'Toda faixa precisa de ao menos uma terapia.' using errcode = '22023';
    end if;

    insert into public.profissionais_disponibilidade_faixas (
      versao_id, dia_semana, hora_inicio, hora_fim, duracao_min,
      intervalo_ativo, intervalo_inicio, intervalo_fim,
      local_id, local_nome, unidade_nome, ordem
    ) values (
      p_versao_id, (f ->> 'dia_semana')::smallint, v_ini, v_fim, v_dur,
      v_int, v_int_ini, v_int_fim,
      v_local.id, v_local.nome_exibicao, v_local.unidade_nome, coalesce((f ->> 'ordem')::smallint, 0)
    )
    returning id into v_faixa_id;

    for t in select * from jsonb_array_elements(f -> 'terapias') loop
      select c.id, c.nome into v_terapia
      from public.cadastro_terapias c
      join public.profissionais_terapias_habilitadas h
        on h.terapia_id = c.id and h.profissional_id = p_profissional_id
      where c.id = (t #>> '{}')::bigint;
      if not found then
        raise exception 'Terapia % não está habilitada para este profissional.', t #>> '{}' using errcode = '23514';
      end if;
      insert into public.profissionais_disponibilidade_faixa_terapias (faixa_id, terapia_id, terapia_nome)
      values (v_faixa_id, v_terapia.id, v_terapia.nome)
      on conflict do nothing;
    end loop;

    v_n := v_n + 1;
  end loop;

  -- Duas faixas do mesmo dia não podem se encostar por dentro.
  select a.dia_semana, a.hora_inicio, a.hora_fim into v_conflito
  from public.profissionais_disponibilidade_faixas a
  join public.profissionais_disponibilidade_faixas b
    on b.versao_id = a.versao_id and b.dia_semana = a.dia_semana and b.id <> a.id
   and a.hora_inicio < b.hora_fim and b.hora_inicio < a.hora_fim
  where a.versao_id = p_versao_id
  limit 1;
  if found then
    raise exception 'Há faixas sobrepostas no mesmo dia (dia %, a partir de %).',
      v_conflito.dia_semana, to_char(v_conflito.hora_inicio, 'HH24:MI') using errcode = '23P01';
  end if;

  return v_n;
end $$;

create or replace function public.profissional_disponibilidade_criar_versao(
  p_profissional_id   bigint,
  p_vigente_de        date,
  p_vigente_ate       date,
  p_dias              smallint[],
  p_faixas            jsonb,
  p_motivo            text,
  p_origem            text default 'manual',
  p_encerrar_anterior boolean default true,
  p_restaurada_de     uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome     text;
  v_versao   uuid;
  v_ant      record;
  v_n        integer;
begin
  if auth.uid() is null or not public.usuario_tem_permissao('cadastros_profissionais') then
    raise exception 'Sem permissão para alterar a disponibilidade.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profissionais where id = p_profissional_id) then
    raise exception 'Profissional % não encontrado.', p_profissional_id using errcode = 'P0002';
  end if;
  if p_vigente_de is null then
    raise exception 'Informe a data de início da vigência.' using errcode = '22023';
  end if;
  if p_vigente_ate is not null and p_vigente_ate < p_vigente_de then
    raise exception 'O fim da vigência é anterior ao início.' using errcode = '22023';
  end if;
  if coalesce(p_origem, '') not in ('manual', 'preenchido_tita', 'restaurada') then
    raise exception 'Origem inválida.' using errcode = '22023';
  end if;
  if (p_origem = 'restaurada') <> (p_restaurada_de is not null) then
    raise exception 'Restauração precisa indicar a versão de origem (e só ela).' using errcode = '22023';
  end if;
  if p_restaurada_de is not null and not exists (
    select 1 from public.profissionais_disponibilidade_versoes
    where id = p_restaurada_de and profissional_id = p_profissional_id
  ) then
    raise exception 'A versão restaurada não é deste profissional.' using errcode = '22023';
  end if;
  if coalesce(length(p_motivo), 0) > 500 then
    raise exception 'Motivo longo demais (máximo 500).' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('prof_disp_versoes'), p_profissional_id::integer);
  select u.nome into v_nome from public.usuarios u where u.id = auth.uid();

  -- Versão futura já agendada a partir desta data (ou depois): não se mexe
  -- nela automaticamente — quem salva decide o que fazer com ela.
  if exists (
    select 1 from public.profissionais_disponibilidade_versoes v
    where v.profissional_id = p_profissional_id
      and v.vigente_de >= p_vigente_de
      and daterange(v.vigente_de, v.vigente_ate, '[]') && daterange(p_vigente_de, p_vigente_ate, '[]')
  ) then
    raise exception 'Já existe versão começando em % ou depois que cruza este período. Ajuste a vigência dela antes.',
      to_char(p_vigente_de, 'DD/MM/YYYY') using errcode = '23P01';
  end if;

  -- A versão que já valia em p_vigente_de termina na véspera.
  if p_encerrar_anterior then
    select v.id, v.vigente_de, v.vigente_ate into v_ant
    from public.profissionais_disponibilidade_versoes v
    where v.profissional_id = p_profissional_id
      and v.vigente_de < p_vigente_de
      and (v.vigente_ate is null or v.vigente_ate >= p_vigente_de)
    limit 1;
    if found then
      update public.profissionais_disponibilidade_versoes
         set vigente_ate = p_vigente_de - 1
       where id = v_ant.id;
      insert into public.profissionais_disponibilidade_eventos
        (profissional_id, versao_id, tipo, antes, depois, motivo, usuario_id, usuario_nome)
      values (
        p_profissional_id, v_ant.id, 'encerrar',
        jsonb_build_object('vigente_de', v_ant.vigente_de, 'vigente_ate', v_ant.vigente_ate),
        jsonb_build_object('vigente_de', v_ant.vigente_de, 'vigente_ate', p_vigente_de - 1),
        'Substituída por nova versão a partir de ' || to_char(p_vigente_de, 'DD/MM/YYYY'),
        auth.uid(), coalesce(v_nome, 'Usuário do Pulsar')
      );
    end if;
  end if;

  insert into public.profissionais_disponibilidade_versoes (
    profissional_id, vigente_de, vigente_ate, dias_ativos, origem, restaurada_de, motivo,
    criado_por, criado_por_nome
  ) values (
    p_profissional_id, p_vigente_de, p_vigente_ate,
    coalesce((select array_agg(distinct d order by d) from unnest(p_dias) d), '{}'),
    p_origem, p_restaurada_de, nullif(btrim(coalesce(p_motivo, '')), ''),
    auth.uid(), coalesce(v_nome, 'Usuário do Pulsar')
  )
  returning id into v_versao;

  v_n := public.sp_prof_disp_gravar_faixas(v_versao, p_profissional_id, p_faixas);

  insert into public.profissionais_disponibilidade_eventos
    (profissional_id, versao_id, tipo, depois, motivo, usuario_id, usuario_nome)
  values (
    p_profissional_id, v_versao, case when p_origem = 'restaurada' then 'restaurar' else 'criar' end,
    jsonb_build_object('vigente_de', p_vigente_de, 'vigente_ate', p_vigente_ate, 'faixas', v_n, 'dias', p_dias),
    nullif(btrim(coalesce(p_motivo, '')), ''),
    auth.uid(), coalesce(v_nome, 'Usuário do Pulsar')
  );

  return v_versao;
end $$;

comment on function public.profissional_disponibilidade_criar_versao(bigint, date, date, smallint[], jsonb, text, text, boolean, uuid) is
  'Cria uma versão da disponibilidade (valida faixas, terapias habilitadas, locais e período). Com p_encerrar_anterior, a versão que valia na data de início termina na véspera. Exige cadastros_profissionais.';

create or replace function public.profissional_disponibilidade_alterar_vigencia(
  p_versao_id    uuid,
  p_vigente_de   date,
  p_vigente_ate  date,
  p_motivo       text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v       record;
  v_nome  text;
  v_hoje  date := public.hoje_brasilia();
begin
  if auth.uid() is null or not public.usuario_tem_permissao('cadastros_profissionais') then
    raise exception 'Sem permissão para alterar a disponibilidade.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Informe o motivo da alteração de vigência.' using errcode = '22023';
  end if;
  if coalesce(length(p_motivo), 0) > 500 then
    raise exception 'Motivo longo demais (máximo 500).' using errcode = '22023';
  end if;

  select * into v from public.profissionais_disponibilidade_versoes where id = p_versao_id for update;
  if not found then
    raise exception 'Versão não encontrada.' using errcode = 'P0002';
  end if;
  if p_vigente_de is null or (p_vigente_ate is not null and p_vigente_ate < p_vigente_de) then
    raise exception 'Período inválido.' using errcode = '22023';
  end if;
  -- O início de uma versão que já começou a valer é fato consumado.
  if p_vigente_de <> v.vigente_de and v.vigente_de <= v_hoje then
    raise exception 'Esta versão já começou a valer em %; o início não pode mudar. Encerre-a e crie outra.',
      to_char(v.vigente_de, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  if p_vigente_de = v.vigente_de and p_vigente_ate is not distinct from v.vigente_ate then
    return;
  end if;

  select u.nome into v_nome from public.usuarios u where u.id = auth.uid();

  update public.profissionais_disponibilidade_versoes
     set vigente_de = p_vigente_de, vigente_ate = p_vigente_ate
   where id = p_versao_id;

  insert into public.profissionais_disponibilidade_eventos
    (profissional_id, versao_id, tipo, antes, depois, motivo, usuario_id, usuario_nome)
  values (
    v.profissional_id, p_versao_id,
    case when p_vigente_de = v.vigente_de and p_vigente_ate is not null
              and (v.vigente_ate is null or p_vigente_ate < v.vigente_ate)
         then 'encerrar' else 'alterar_vigencia' end,
    jsonb_build_object('vigente_de', v.vigente_de, 'vigente_ate', v.vigente_ate),
    jsonb_build_object('vigente_de', p_vigente_de, 'vigente_ate', p_vigente_ate),
    btrim(p_motivo), auth.uid(), coalesce(v_nome, 'Usuário do Pulsar')
  );
end $$;

comment on function public.profissional_disponibilidade_alterar_vigencia(uuid, date, date, text) is
  'Encerra ou ajusta a vigência de uma versão (motivo obrigatório; início só muda se ainda não começou). Grava evento. Exige cadastros_profissionais.';

-- ═════════════════════════════════════════════════════════════════════════════
-- RLS e GRANTs
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.profissionais_disponibilidade_versoes        enable row level security;
alter table public.profissionais_disponibilidade_faixas         enable row level security;
alter table public.profissionais_disponibilidade_faixa_terapias enable row level security;
alter table public.profissionais_disponibilidade_eventos        enable row level security;

do $$
declare pol record;
begin
  for pol in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('profissionais_disponibilidade_versoes', 'profissionais_disponibilidade_faixas',
                        'profissionais_disponibilidade_faixa_terapias', 'profissionais_disponibilidade_eventos')
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

create policy "prof_disp_versoes_select" on public.profissionais_disponibilidade_versoes
  for select to authenticated using (public.usuario_tem_permissao('cadastros_profissionais'));
create policy "prof_disp_faixas_select" on public.profissionais_disponibilidade_faixas
  for select to authenticated using (public.usuario_tem_permissao('cadastros_profissionais'));
create policy "prof_disp_faixa_terapias_select" on public.profissionais_disponibilidade_faixa_terapias
  for select to authenticated using (public.usuario_tem_permissao('cadastros_profissionais'));
create policy "prof_disp_eventos_select" on public.profissionais_disponibilidade_eventos
  for select to authenticated using (public.usuario_tem_permissao('cadastros_profissionais'));

revoke all on public.profissionais_disponibilidade_versoes        from public, anon, authenticated;
revoke all on public.profissionais_disponibilidade_faixas         from public, anon, authenticated;
revoke all on public.profissionais_disponibilidade_faixa_terapias from public, anon, authenticated;
revoke all on public.profissionais_disponibilidade_eventos        from public, anon, authenticated;
revoke all on public.vw_profissionais_disponibilidade_versoes     from public, anon, authenticated;
revoke all on public.vw_profissionais_grade_situacao              from public, anon, authenticated;

grant select on public.profissionais_disponibilidade_versoes        to authenticated, service_role;
grant select on public.profissionais_disponibilidade_faixas         to authenticated, service_role;
grant select on public.profissionais_disponibilidade_faixa_terapias to authenticated, service_role;
grant select on public.profissionais_disponibilidade_eventos        to authenticated, service_role;
grant select on public.vw_profissionais_disponibilidade_versoes     to authenticated, service_role;
grant select on public.vw_profissionais_grade_situacao              to authenticated, service_role;

revoke all on function public.hoje_brasilia() from public, anon;
grant execute on function public.hoje_brasilia() to authenticated, service_role;

revoke all on function public.profissionais_locais() from public, anon;
grant execute on function public.profissionais_locais() to authenticated;

revoke all on function public.sp_prof_disp_gravar_faixas(uuid, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.sp_prof_disp_versoes_guarda()   from public, anon, authenticated;
revoke all on function public.sp_prof_disp_imutavel()          from public, anon, authenticated;
revoke all on function public.sp_prof_disp_eventos_brasilia()  from public, anon, authenticated;

revoke all on function public.profissional_disponibilidade_criar_versao(bigint, date, date, smallint[], jsonb, text, text, boolean, uuid) from public, anon;
revoke all on function public.profissional_disponibilidade_alterar_vigencia(uuid, date, date, text) from public, anon;
grant execute on function public.profissional_disponibilidade_criar_versao(bigint, date, date, smallint[], jsonb, text, text, boolean, uuid) to authenticated;
grant execute on function public.profissional_disponibilidade_alterar_vigencia(uuid, date, date, text) to authenticated;
