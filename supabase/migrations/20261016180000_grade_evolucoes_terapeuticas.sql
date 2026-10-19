-- Evoluções Terapêuticas e Registro de Faltas na Grade (Cronograma).
--
-- Plano: docs/PLANO_EVOLUCOES_TERAPEUTICAS.md. Decisões do usuário (16/10/2026):
--
--   1. QUEM PODE EVOLUIR AGORA: exclusivamente role = 'admin' (public.is_admin()).
--      Nem 'diretoria' pode evoluir neste momento. A função sp_grade_pode_evoluir()
--      concentra a regra em um único ponto para, no futuro, liberar o acesso do
--      profissional terapeuta (via usuarios.profissional_id).
--   2. REALIZADO POR: nunca é escolhido manualmente em lista. O banco capta
--      automaticamente quem está logado (auth.uid() → public.usuarios.nome e
--      eventual vínculo com public.profissionais). Quando quem realizou difere de
--      quem estava agendado na sessão, caracteriza SUBSTITUIÇÃO.
--   3. TRANSIÇÃO COERENTE DO TITA: a Grade lê apenas public.grade_evolucoes.
--      O que já foi evoluído ou marcado como falta no TiTa (csv_grades_profissionais)
--      é espelhado com origem = 'tita_importacao', sem nunca sobrescrever o que
--      foi registrado ou editado no Pulsar (origem = 'pulsar'). Depois do corte
--      do TiTa (sistema_tita_corte), o espelhamento para e tudo segue no Pulsar.
--   4. INCONSISTÊNCIA (Recepção marcou falta × Profissional evoluiu): cruzada
--      com fila_autorizacoes (status = 'falta' e falta_revertida_em is null).
--      Visível apenas para admin; para o profissional (no futuro), aparece
--      apenas como falta alegada pela recepção.
--   5. PONTE PARA central-pacientes/ E relacionamento-prestador/rp/:
--      vw_grade_execucao_pulsar entrega os mesmos nomes e domínios de colunas
--      consumidos hoje por buscarGradeParaRP e listar_central_pacientes.

-- ═════════════════════════════════════════════════════════════════════════════
-- A) Vínculo opcional usuario → profissional (para o futuro acesso do terapeuta)
--    e garantia das colunas de execução na cópia do TiTa
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.usuarios
  add column if not exists profissional_id bigint references public.profissionais(id) on delete set null;

create index if not exists idx_usuarios_profissional_id
  on public.usuarios (profissional_id) where profissional_id is not null;

comment on column public.usuarios.profissional_id is
  'Vínculo opcional do usuário do Pulsar com o cadastro de profissionais. Usado pelas evoluções terapêuticas para identificar automaticamente o terapeuta logado.';

-- Garante que as colunas de execução existam em csv_grades_profissionais mesmo
-- em ambientes de teste que não aplicaram 20260806100000 / 20260909160000.
alter table public.csv_grades_profissionais
  add column if not exists status_execucao             text,
  add column if not exists justificativa               text,
  add column if not exists possui_tratativa            boolean,
  add column if not exists tratativa_profissional_id   bigint,
  add column if not exists tratativa_profissional_nome text,
  add column if not exists tratativa_criada_em         timestamptz,
  add column if not exists tratativa_origem            text,
  add column if not exists evolucao_vinculo            text,
  add column if not exists descricao_evolucao          text,
  add column if not exists tratativas                  smallint,
  add column if not exists tratativas_distintas        smallint;

-- ═════════════════════════════════════════════════════════════════════════════
-- B) Tabela public.grade_evolucoes (1:1 com grade_agendamentos)
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.grade_evolucoes (
  agendamento_id              uuid primary key references public.grade_agendamentos(id) on delete restrict,
  tita_agendamento_id         bigint,

  -- Execução / Falta (mesmo vocabulário canônico de lib/remuneracao/rotulosExecucao.ts)
  status_execucao             text not null,
  justificativa               text,
  tipo_falta                  text,

  -- Tratativa / Evolução (espelha csv_grade_profissionais)
  possui_tratativa            boolean not null default false,
  tratativa_profissional_id   bigint references public.profissionais(id) on delete restrict,
  tratativa_profissional_nome text,
  tratativa_usuario_id        uuid,
  tratativa_criada_em         timestamptz,
  tratativa_origem            text not null default 'Prontuario',
  evolucao_vinculo            text not null default 'Agendamento ativo',
  descricao_evolucao          text,
  tratativas                  smallint not null default 0,
  tratativas_distintas        smallint not null default 0,

  -- Origem do registro ('pulsar' prevalece sempre sobre 'tita_importacao')
  origem                      text not null default 'pulsar',

  -- Rastreio de última ação
  registrado_por              uuid,
  registrado_por_nome         text,
  criado_em                   timestamptz not null default now(),
  atualizado_em               timestamptz not null default now(),

  constraint grade_evol_status_check
    check (status_execucao in ('Realizado', 'Cancelado')),
  constraint grade_evol_tipo_falta_check
    check (tipo_falta is null or tipo_falta in ('paciente', 'terapeuta')),
  constraint grade_evol_origem_check
    check (origem in ('pulsar', 'tita_importacao')),
  constraint grade_evol_vinculo_check
    check (evolucao_vinculo in ('Agendamento ativo', 'Agendamento excluído', 'Sem agendamento')),
  constraint grade_evol_descricao_check
    check (coalesce(length(descricao_evolucao), 0) <= 20000),
  constraint grade_evol_consistencia_pulsar_check
    check (
      origem = 'tita_importacao'
      or (
        status_execucao = 'Realizado'
        and possui_tratativa = true
        and tipo_falta is null
        and length(btrim(coalesce(descricao_evolucao, ''))) > 0
      )
      or (
        status_execucao = 'Cancelado'
        and possui_tratativa = false
        and tipo_falta in ('paciente', 'terapeuta')
        and descricao_evolucao is null
      )
    )
);

create index if not exists idx_grade_evolucoes_tita_id
  on public.grade_evolucoes (tita_agendamento_id) where tita_agendamento_id is not null;

create index if not exists idx_grade_evolucoes_profissional
  on public.grade_evolucoes (tratativa_profissional_id) where tratativa_profissional_id is not null;

comment on table public.grade_evolucoes is
  'Execução clínica e presença de cada sessão de grade_agendamentos (1:1). Guarda evolução terapêutica (Realizado + descrição + quem evoluiu + carimbo de data/hora) ou falta (Cancelado + paciente/terapeuta). Registros com origem = pulsar nunca são sobrescritos pela importação do TiTa.';

-- Novas ações auditáveis em grade_eventos.
alter table public.grade_eventos drop constraint if exists grade_eventos_acao_check;
alter table public.grade_eventos add constraint grade_eventos_acao_check check (acao in (
  'criado', 'excluido', 'serie_encerrada', 'estendido',
  'importado', 'bloqueio_criado', 'bloqueio_excluido', 'inativacao_profissional',
  'evoluido', 'evolucao_editada', 'falta_registrada', 'evolucao_removida'
));

-- Gatilho de guarda: protege origem = 'pulsar' contra sobrescrita do TiTa e
-- mantém criado_em / atualizado_em.
create or replace function public.sp_grade_evolucoes_guarda()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  if tg_op = 'INSERT' then
    new.criado_em := coalesce(new.criado_em, now());
    return new;
  end if;

  if old.origem = 'pulsar' and new.origem = 'tita_importacao' then
    raise exception 'Evolução registrada no Pulsar não pode ser sobrescrita pela importação do TiTa.'
      using errcode = '42501';
  end if;

  new.criado_em := old.criado_em;
  return new;
end $$;

drop trigger if exists trg_grade_evolucoes_guarda on public.grade_evolucoes;
create trigger trg_grade_evolucoes_guarda
  before insert or update on public.grade_evolucoes
  for each row execute function public.sp_grade_evolucoes_guarda();

-- ═════════════════════════════════════════════════════════════════════════════
-- C) Auxiliares de acesso e autoria
-- ═════════════════════════════════════════════════════════════════════════════

-- É exclusivamente admin? (Nem diretoria entra aqui.)
create or replace function public.sp_grade_eh_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.usuarios u
    where u.id = auth.uid()
      and coalesce(u.ativo, true)
      and u.role = 'admin'
  )
$$;

-- Ponto único da regra "Quem pode evoluir / marcar falta".
-- Hoje: apenas admin. No futuro: liberar também quando o profissional logado
-- tiver acesso à agenda.
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
  -- Regra atual: apenas 'admin' pode evoluir (nem diretoria pode).
  return public.sp_grade_eh_admin();
end $$;

create or replace function public.sp_grade_exigir_evoluir(p_agendamento_id uuid default null)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.sp_grade_pode_evoluir(p_agendamento_id) then
    raise exception 'Apenas administradores podem evoluir ou registrar falta na Grade por enquanto.'
      using errcode = '42501';
  end if;
end $$;

-- Identifica automaticamente quem está realizando a evolução/falta a partir do
-- usuário logado (auth.uid()). Nunca recebe nome escolhido manualmente.
create or replace function public.sp_grade_autor_evolucao()
returns table (
  usuario_id       uuid,
  usuario_nome     text,
  profissional_id  bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_nome  text;
  v_email text;
  v_prof  bigint;
begin
  if v_uid is null then
    return query select null::uuid, 'Usuário do Pulsar'::text, null::bigint;
    return;
  end if;

  select u.nome, u.email, u.profissional_id
    into v_nome, v_email, v_prof
    from public.usuarios u
   where u.id = v_uid;

  -- Se o usuário ainda não tem profissional_id preenchido, tenta casar pelo
  -- e-mail com um profissional ativo.
  if v_prof is null and nullif(btrim(coalesce(v_email, '')), '') is not null then
    select p.id into v_prof
      from public.profissionais p
     where p.ativo
       and lower(btrim(coalesce(p.email, ''))) = lower(btrim(v_email))
     order by p.id
     limit 1;
  end if;

  -- Se vinculou a um profissional do cadastro, prefere o nome oficial dele;
  -- caso contrário (ex.: admin), usa o nome do usuário logado.
  if v_prof is not null then
    select coalesce(nullif(btrim(p.nome), ''), v_nome)
      into v_nome
      from public.profissionais p
     where p.id = v_prof;
  end if;

  return query select v_uid, coalesce(nullif(btrim(v_nome), ''), 'Usuário do Pulsar'), v_prof;
end $$;

-- Devolve para o cliente o acesso atual às evoluções e o nome que aparecerá em
-- "Realizado por".
create or replace function public.grade_meu_acesso_evolucao()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_autor record;
  v_admin boolean := public.sp_grade_eh_admin();
  v_pode  boolean := public.sp_grade_pode_evoluir(null);
begin
  perform public.sp_grade_exigir_permissao();
  select * into v_autor from public.sp_grade_autor_evolucao();
  return jsonb_build_object(
    'eh_admin', v_admin,
    'pode_evoluir', v_pode,
    'usuario_id', v_autor.usuario_id,
    'usuario_nome', v_autor.usuario_nome,
    'profissional_id', v_autor.profissional_id
  );
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- D) Espelhamento coerente do TiTa → public.grade_evolucoes
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.sp_grade_espelhar_evolucoes_tita(
  p_de  date default null,
  p_ate date default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_afetadas integer := 0;
begin
  -- Depois do corte definitivo do TiTa, nada mais é espelhado.
  if to_regprocedure('public.tita_cortado_em()') is not null then
    if public.tita_cortado_em() is not null then
      return 0;
    end if;
  end if;

  with fonte as (
    select distinct on (a.id)
      a.id as agendamento_id,
      a.tita_agendamento_id,
      a.profissional_id as ag_profissional_id,
      a.profissional_nome as ag_profissional_nome,
      case
        when g.possui_tratativa is true then 'Realizado'
        else 'Cancelado'
      end as status_execucao,
      case
        when g.possui_tratativa is true then null
        when lower(coalesce(g.justificativa, '')) ~ '(profissional|prestador|terapeuta)'
          then 'Não realizado — prestador'
        else coalesce(nullif(btrim(g.justificativa), ''), 'Não realizado — paciente')
      end as justificativa,
      case
        when g.possui_tratativa is true then null
        when lower(coalesce(g.justificativa, '')) ~ '(profissional|prestador|terapeuta)'
          then 'terapeuta'
        else 'paciente'
      end as tipo_falta,
      coalesce(g.possui_tratativa, false) as possui_tratativa,
      case
        when g.possui_tratativa is true then
          coalesce(
            pr_trat.id,
            case when g.tratativa_profissional_id = g.profissional_id then a.profissional_id else null end
          )
        else null
      end as tratativa_profissional_id,
      case
        when g.possui_tratativa is true then
          coalesce(
            pr_trat.nome,
            nullif(btrim(g.tratativa_profissional_nome), ''),
            a.profissional_nome
          )
        else null
      end as tratativa_profissional_nome,
      g.tratativa_criada_em,
      coalesce(nullif(btrim(g.tratativa_origem), ''), 'Prontuario') as tratativa_origem,
      case
        when g.evolucao_vinculo in ('Agendamento ativo', 'Agendamento excluído', 'Sem agendamento')
          then g.evolucao_vinculo
        when a.situacao = 'excluido' then 'Agendamento excluído'
        else 'Agendamento ativo'
      end as evolucao_vinculo,
      case
        when g.possui_tratativa is true then g.descricao_evolucao
        else null
      end as descricao_evolucao,
      case
        when g.possui_tratativa is true then greatest(coalesce(g.tratativas, 1), 1)::smallint
        else 0::smallint
      end as tratativas,
      case
        when g.possui_tratativa is true then greatest(coalesce(g.tratativas_distintas, 1), 1)::smallint
        else 0::smallint
      end as tratativas_distintas,
      coalesce(g.tratativa_criada_em, g.updated_at, now()) as momento
    from public.grade_agendamentos a
    join public.csv_grades_profissionais g
      on g.tita_agendamento_id = a.tita_agendamento_id
     and g.ativo is true
    left join public.profissionais pr_trat
      on pr_trat.tita_profissional_id = g.tratativa_profissional_id
    where a.tita_agendamento_id is not null
      and (p_de is null or a.data >= p_de)
      and (p_ate is null or a.data <= p_ate)
      and (
        g.possui_tratativa is true
        or lower(coalesce(g.status_execucao, '')) like '%cancel%'
        or lower(coalesce(g.status_execucao, '')) like '%nao realizad%'
        or lower(coalesce(g.status_execucao, '')) like '%não realizad%'
      )
    order by a.id, g.updated_at desc nulls last
  ),
  up as (
    insert into public.grade_evolucoes (
      agendamento_id, tita_agendamento_id, status_execucao, justificativa, tipo_falta,
      possui_tratativa, tratativa_profissional_id, tratativa_profissional_nome,
      tratativa_criada_em, tratativa_origem, evolucao_vinculo, descricao_evolucao,
      tratativas, tratativas_distintas, origem, registrado_por_nome, criado_em
    )
    select
      f.agendamento_id, f.tita_agendamento_id, f.status_execucao, f.justificativa, f.tipo_falta,
      f.possui_tratativa, f.tratativa_profissional_id, f.tratativa_profissional_nome,
      f.tratativa_criada_em, f.tratativa_origem, f.evolucao_vinculo, f.descricao_evolucao,
      f.tratativas, f.tratativas_distintas, 'tita_importacao',
      coalesce(f.tratativa_profissional_nome, 'Sincronização do TiTa'), f.momento
    from fonte f
    on conflict (agendamento_id) do update
       set tita_agendamento_id         = excluded.tita_agendamento_id,
           status_execucao             = excluded.status_execucao,
           justificativa               = excluded.justificativa,
           tipo_falta                  = excluded.tipo_falta,
           possui_tratativa            = excluded.possui_tratativa,
           tratativa_profissional_id   = excluded.tratativa_profissional_id,
           tratativa_profissional_nome = excluded.tratativa_profissional_nome,
           tratativa_criada_em         = excluded.tratativa_criada_em,
           tratativa_origem            = excluded.tratativa_origem,
           evolucao_vinculo            = excluded.evolucao_vinculo,
           descricao_evolucao          = coalesce(excluded.descricao_evolucao, public.grade_evolucoes.descricao_evolucao),
           tratativas                  = excluded.tratativas,
           tratativas_distintas        = excluded.tratativas_distintas,
           registrado_por_nome         = excluded.registrado_por_nome
     where public.grade_evolucoes.origem = 'tita_importacao'
    returning 1
  )
  select count(*) into v_afetadas from up;

  return v_afetadas;
end $$;

-- Carga inicial: espelha tudo o que já existe em grade_agendamentos × csv_grades_profissionais.
select public.sp_grade_espelhar_evolucoes_tita(null, null);

-- Atualiza grade_importar_tita_concluir para também espelhar as evoluções/faltas
-- da janela importada enquanto o corte do TiTa não estiver ativo.
create or replace function public.grade_importar_tita_concluir(p_importacao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  imp     record;
  v_nome  text := public.sp_grade_usuario_nome();
  a       jsonb;
  n       jsonb;
  num     integer;
begin
  perform public.sp_grade_exigir_permissao();
  perform pg_advisory_xact_lock(hashtext('grade_importar_tita'));

  select * into imp from public.grade_importacoes where id = p_importacao_id for update;
  if not found then
    raise exception 'Importação não encontrada.' using errcode = 'P0002';
  end if;
  if imp.situacao = 'aplicada' then
    return imp.aplicado;
  end if;
  if imp.situacao not in ('previa', 'aplicando') then
    raise exception 'Esta importação já foi %.', imp.situacao using errcode = '22023';
  end if;

  -- Espelha evoluções e faltas vindas do TiTa na janela (sem tocar em origem = 'pulsar').
  perform public.sp_grade_espelhar_evolucoes_tita(imp.janela_inicio, imp.janela_fim);

  update public.grade_importacoes
     set situacao = 'aplicada', aplicada_em = now(), aplicada_por = auth.uid(), aplicada_por_nome = v_nome
   where id = p_importacao_id;

  a := imp.aplicado;
  n := imp.contadores;
  num := coalesce((a ->> 'sessoes_novas')::integer, 0) + coalesce((a ->> 'restauradas')::integer, 0);
  insert into public.grade_eventos
    (acao, importacao_id, lote_id, quantidade, depois, resumo, feito_por, feito_por_nome)
  values (
    'importado', p_importacao_id, p_importacao_id, num,
    a || jsonb_build_object('janela_inicio', imp.janela_inicio, 'janela_fim', imp.janela_fim,
                            'pendencias', coalesce((n ->> 'pendencias')::integer, 0)),
    'Importado do TiTa (' || to_char(imp.janela_inicio, 'DD/MM') || ' a ' || to_char(imp.janela_fim, 'DD/MM/YYYY') || '): '
      || coalesce(a ->> 'sessoes_novas', '0') || ' nova(s), '
      || coalesce(a ->> 'restauradas', '0') || ' restaurada(s), '
      || coalesce(a ->> 'alteradas', '0') || ' alterada(s), '
      || coalesce(a ->> 'sumidos_excluidos', '0') || ' excluída(s) por não estarem mais no TiTa, '
      || coalesce(a ->> 'bloqueios', '0') || ' bloqueio(s)'
      || case when coalesce((n ->> 'pendencias')::integer, 0) > 0
              then '; ' || (n ->> 'pendencias') || ' pendência(s) de cadastro' else '' end,
    auth.uid(), v_nome
  );

  return coalesce(a, '{}'::jsonb);
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- E) Cruzamento de falta da recepção (fila_autorizacoes) e RPCs de leitura
-- ═════════════════════════════════════════════════════════════════════════════

-- Verifica na fila_autorizacoes (quando a tabela existe) se a recepção marcou
-- falta não revertida para o agendamento.
create or replace function public.sp_grade_falta_recepcao(
  p_tita_agendamento_id bigint,
  p_paciente_id         bigint,
  p_tita_paciente_id    bigint,
  p_paciente_nome       text,
  p_data                date,
  p_hora_inicio         time
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tipo text;
begin
  if to_regclass('public.fila_autorizacoes') is null then
    return null;
  end if;

  -- Camada 1: por tita_agendamento_id (mais confiável).
  if p_tita_agendamento_id is not null then
    execute $q$
      select coalesce(nullif(btrim(fa.tipo_falta), ''), 'paciente')
        from public.fila_autorizacoes fa
       where fa.tita_agendamento_id = $1
         and fa.status = 'falta'
         and fa.falta_revertida_em is null
       order by fa.id
       limit 1
    $q$ into v_tipo using p_tita_agendamento_id;

    if v_tipo is not null then
      return v_tipo;
    end if;
  end if;

  -- Camada 2: por data + horário + paciente (id ou nome normalizado).
  execute $q$
    select coalesce(nullif(btrim(fa.tipo_falta), ''), 'paciente')
      from public.fila_autorizacoes fa
     where fa.data_atendimento = $1
       and fa.status = 'falta'
       and fa.falta_revertida_em is null
       and left(coalesce(fa.horario::text, ''), 5) = to_char($2, 'HH24:MI')
       and (
         (fa.paciente_id is not null and fa.paciente_id::bigint in ($3, coalesce($4, -1)))
         or public.normalizar_nome_paciente(fa.paciente_nome) = public.normalizar_nome_paciente($5)
       )
     order by fa.id
     limit 1
  $q$ into v_tipo using p_data, p_hora_inicio, p_paciente_id, p_tita_paciente_id, p_paciente_nome;

  return v_tipo;
end $$;

-- Resumo das evoluções e faltas de um período para pintar os ícones ao lado de
-- cada sessão em /cronograma/grade?visao=profissional (sem trafegar o texto
-- clínico da descrição na listagem da grade).
create or replace function public.grade_resumo_evolucoes_periodo(
  p_de            date,
  p_ate           date,
  p_profissionais bigint[] default null
)
returns table (
  agendamento_id              uuid,
  status_execucao             text,
  justificativa               text,
  tipo_falta                  text,
  possui_tratativa            boolean,
  tratativa_profissional_id   bigint,
  tratativa_profissional_nome text,
  tratativa_criada_em         timestamptz,
  origem                      text,
  substituicao                boolean,
  falta_recepcao              boolean,
  tipo_falta_recepcao         text,
  inconsistencia              boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin boolean := public.sp_grade_eh_admin();
begin
  perform public.sp_grade_exigir_permissao();

  return query
  select
    a.id as agendamento_id,
    coalesce(e.status_execucao, case when fr.tipo is not null then 'Cancelado'::text else null end) as status_execucao,
    coalesce(
      e.justificativa,
      case when fr.tipo = 'terapeuta' then 'Não realizado — prestador' when fr.tipo is not null then 'Não realizado — paciente' else null end
    ) as justificativa,
    coalesce(e.tipo_falta, fr.tipo) as tipo_falta,
    coalesce(e.possui_tratativa, false) as possui_tratativa,
    case when coalesce(e.possui_tratativa, false) then e.tratativa_profissional_id else null end as tratativa_profissional_id,
    case when coalesce(e.possui_tratativa, false) then coalesce(pr_tr.nome, e.tratativa_profissional_nome) else null end as tratativa_profissional_nome,
    case when coalesce(e.possui_tratativa, false) then e.tratativa_criada_em else null end as tratativa_criada_em,
    e.origem,
    (
      coalesce(e.possui_tratativa, false)
      and (
        (e.tratativa_profissional_id is not null and e.tratativa_profissional_id <> a.profissional_id)
        or (
          e.tratativa_profissional_id is null
          and e.tratativa_profissional_nome is not null
          and lower(btrim(e.tratativa_profissional_nome)) <> lower(btrim(coalesce(pr_ag.nome, a.profissional_nome)))
        )
      )
    ) as substituicao,
    (fr.tipo is not null) as falta_recepcao,
    fr.tipo as tipo_falta_recepcao,
    -- Inconsistência = recepção marcou falta E profissional evoluiu. Só existe para admin.
    (v_admin and fr.tipo is not null and coalesce(e.possui_tratativa, false)) as inconsistencia
  from public.grade_agendamentos a
  left join public.grade_evolucoes e
    on e.agendamento_id = a.id
  left join public.pacientes pac
    on pac.id_paciente = a.paciente_id
  left join public.profissionais pr_ag
    on pr_ag.id = a.profissional_id
  left join public.profissionais pr_tr
    on pr_tr.id = e.tratativa_profissional_id
  cross join lateral (
    select public.sp_grade_falta_recepcao(
      a.tita_agendamento_id,
      a.paciente_id,
      coalesce(a.tita_paciente_id, pac.tita_paciente_id),
      coalesce(pac.nome, a.paciente_nome),
      a.data,
      a.hora_inicio
    ) as tipo
  ) fr
  where a.situacao = 'agendado'
    and a.data >= p_de
    and a.data <= p_ate
    and (p_profissionais is null or a.profissional_id = any(p_profissionais))
    and (e.agendamento_id is not null or fr.tipo is not null);
end $$;

-- Detalhe completo de uma evolução (incluindo o texto da Descrição e os dados
-- do carimbo anexado em cadastro/profissionais).
create or replace function public.grade_detalhe_evolucao(p_agendamento_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a       record;
  e       record;
  pr_car  record;
  v_falta text;
  v_admin boolean := public.sp_grade_eh_admin();
  v_subst boolean := false;
begin
  if not public.sp_grade_pode_evoluir(p_agendamento_id) then
    perform public.sp_grade_exigir_permissao();
  end if;

  select
    ag.*,
    coalesce(pac.nome, ag.paciente_nome) as pac_nome_atual,
    coalesce(pac.tita_paciente_id, ag.tita_paciente_id) as pac_tita_id,
    coalesce(pr.nome, ag.profissional_nome) as prof_nome_atual
    into a
    from public.grade_agendamentos ag
    left join public.pacientes pac on pac.id_paciente = ag.paciente_id
    left join public.profissionais pr on pr.id = ag.profissional_id
   where ag.id = p_agendamento_id;

  if not found then
    raise exception 'Sessão não encontrada.' using errcode = 'P0002';
  end if;

  v_falta := public.sp_grade_falta_recepcao(
    a.tita_agendamento_id, a.paciente_id, a.pac_tita_id, a.pac_nome_atual, a.data, a.hora_inicio
  );

  select
    ev.*,
    coalesce(nullif(btrim(ev.tratativa_profissional_nome), ''), pr_t.nome) as exec_nome_atual
    into e
    from public.grade_evolucoes ev
    left join public.profissionais pr_t on pr_t.id = ev.tratativa_profissional_id
   where ev.agendamento_id = p_agendamento_id;

  if e.agendamento_id is not null and e.possui_tratativa then
    v_subst := (
      (e.tratativa_profissional_id is not null and e.tratativa_profissional_id <> a.profissional_id)
      or (
        e.tratativa_profissional_id is null
        and e.exec_nome_atual is not null
        and lower(btrim(e.exec_nome_atual)) <> lower(btrim(a.prof_nome_atual))
      )
    );
  end if;

  -- Carimbo: em caso de substituição, DEVE ser do profissional que substituiu.
  if v_subst then
    select
      p.id, p.nome, p.assinatura_path, p.tipo_registro, p.uf_registro, p.codigo_registro
      into pr_car
      from public.profissionais p
     where (e.tratativa_profissional_id is not null and p.id = e.tratativa_profissional_id)
        or (e.tratativa_profissional_id is null and lower(btrim(p.nome)) = lower(btrim(coalesce(e.exec_nome_atual, ''))))
     order by (p.id = e.tratativa_profissional_id) desc nulls last
     limit 1;
  end if;

  -- Se não houve substituição (ou se o substituto não foi localizado no cadastro),
  -- o carimbo é do profissional agendado da sessão.
  if not v_subst or not found then
    select
      p.id, p.nome, p.assinatura_path, p.tipo_registro, p.uf_registro, p.codigo_registro
      into pr_car
      from public.profissionais p
     where p.id = a.profissional_id;
  end if;

  return jsonb_build_object(
    'agendamento_id', a.id,
    'registrado', e.agendamento_id is not null,
    'status_execucao', coalesce(e.status_execucao, case when v_falta is not null then 'Cancelado' else null end),
    'justificativa', coalesce(
      e.justificativa,
      case when v_falta = 'terapeuta' then 'Não realizado — prestador' when v_falta is not null then 'Não realizado — paciente' else null end
    ),
    'tipo_falta', coalesce(e.tipo_falta, v_falta),
    'possui_tratativa', coalesce(e.possui_tratativa, false),
    'descricao_evolucao', e.descricao_evolucao,
    'tratativa_profissional_id', e.tratativa_profissional_id,
    'tratativa_profissional_nome', case
      when coalesce(e.possui_tratativa, false) then e.exec_nome_atual
      else null
    end,
    'tratativa_criada_em', e.tratativa_criada_em,
    'tratativa_criada_em_brasilia', case
      when e.tratativa_criada_em is not null
        then to_char(e.tratativa_criada_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI:SS')
      else null
    end,
    'tratativa_origem', e.tratativa_origem,
    'evolucao_vinculo', e.evolucao_vinculo,
    'origem', e.origem,
    'substituicao', v_subst,
    'registrado_por_nome', e.registrado_por_nome,
    'atualizado_em_brasilia', case
      when e.atualizado_em is not null
        then to_char(e.atualizado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI:SS')
      else null
    end,
    'falta_recepcao', v_falta is not null,
    'tipo_falta_recepcao', v_falta,
    'inconsistencia', (v_admin and v_falta is not null and coalesce(e.possui_tratativa, false)),
    'carimbo', jsonb_build_object(
      'profissional_id', pr_car.id,
      'profissional_nome', pr_car.nome,
      'assinatura_path', pr_car.assinatura_path,
      'tipo_registro', pr_car.tipo_registro,
      'uf_registro', pr_car.uf_registro,
      'codigo_registro', pr_car.codigo_registro
    )
  );
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- F) RPCs de escrita (exclusivas para quem sp_grade_exigir_evoluir libera)
-- ═════════════════════════════════════════════════════════════════════════════

drop function if exists public.grade_registrar_evolucao(uuid, text);
drop function if exists public.grade_registrar_evolucao(uuid, text, bigint);
create or replace function public.grade_registrar_evolucao(
  p_agendamento_id             uuid,
  p_descricao                  text,
  p_profissional_substituto_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a           record;
  ant         record;
  v_autor     record;
  pr_sub      record;
  v_trat_id   bigint;
  v_trat_nome text;
  v_texto     text := btrim(coalesce(p_descricao, ''));
  v_agora     timestamptz := now();
  v_vinculo   text;
  v_trat      smallint := 1;
  v_dist      smallint := 1;
  v_acao      text := 'evoluido';
  v_subst     boolean := false;
begin
  perform public.sp_grade_exigir_evoluir(p_agendamento_id);

  if length(v_texto) < 3 then
    raise exception 'Preencha a descrição da evolução.' using errcode = '22023';
  end if;
  if length(v_texto) > 20000 then
    raise exception 'A descrição da evolução excede o limite de 20.000 caracteres.' using errcode = '22023';
  end if;

  select
    ag.*,
    coalesce(pac.nome, ag.paciente_nome) as pac_nome_atual,
    coalesce(pr.nome, ag.profissional_nome) as prof_nome_atual
    into a
    from public.grade_agendamentos ag
    left join public.pacientes pac on pac.id_paciente = ag.paciente_id
    left join public.profissionais pr on pr.id = ag.profissional_id
   where ag.id = p_agendamento_id
   for update of ag;

  if not found then
    raise exception 'Sessão não encontrada.' using errcode = 'P0002';
  end if;

  select * into v_autor from public.sp_grade_autor_evolucao();
  v_vinculo := case when a.situacao = 'excluido' then 'Agendamento excluído' else 'Agendamento ativo' end;

  -- Determina profissional que realizou clinicamente:
  -- 1) Usuário informou explicitamente substituto diferente do agendado:
  if p_profissional_substituto_id is not null and p_profissional_substituto_id <> a.profissional_id then
    select p.id, p.nome into pr_sub
      from public.profissionais p
     where p.id = p_profissional_substituto_id;

    if not found then
      raise exception 'Profissional substituto não encontrado no cadastro.' using errcode = 'P0002';
    end if;

    v_trat_id := pr_sub.id;
    v_trat_nome := pr_sub.nome;
    v_subst := true;

  -- 2) Usuário logado é um profissional e difere do agendado (futuro acesso do terapeuta):
  elsif v_autor.profissional_id is not null and v_autor.profissional_id <> a.profissional_id then
    v_trat_id := v_autor.profissional_id;
    v_trat_nome := v_autor.usuario_nome;
    v_subst := true;

  -- 3) Não houve substituição:
  else
    v_trat_id := a.profissional_id;
    v_trat_nome := v_autor.usuario_nome;
    v_subst := false;
  end if;

  select * into ant from public.grade_evolucoes where agendamento_id = p_agendamento_id for update;
  if found and ant.possui_tratativa then
    v_acao := 'evolucao_editada';
    v_trat := greatest(coalesce(ant.tratativas, 1), 1);
    if coalesce(ant.tratativa_profissional_nome, '') <> ''
       and lower(btrim(ant.tratativa_profissional_nome)) <> lower(btrim(v_trat_nome)) then
      v_dist := greatest(coalesce(ant.tratativas_distintas, 1) + 1, 2);
    else
      v_dist := greatest(coalesce(ant.tratativas_distintas, 1), 1);
    end if;
  end if;

  insert into public.grade_evolucoes (
    agendamento_id, tita_agendamento_id, status_execucao, justificativa, tipo_falta,
    possui_tratativa, tratativa_profissional_id, tratativa_profissional_nome,
    tratativa_usuario_id, tratativa_criada_em, tratativa_origem, evolucao_vinculo,
    descricao_evolucao, tratativas, tratativas_distintas,
    origem, registrado_por, registrado_por_nome, criado_em, atualizado_em
  ) values (
    a.id, a.tita_agendamento_id, 'Realizado', null, null,
    true, v_trat_id, v_trat_nome,
    v_autor.usuario_id, v_agora, 'Prontuario', v_vinculo,
    v_texto, v_trat, v_dist,
    'pulsar', v_autor.usuario_id, v_autor.usuario_nome, v_agora, v_agora
  )
  on conflict (agendamento_id) do update
     set tita_agendamento_id         = excluded.tita_agendamento_id,
         status_execucao             = 'Realizado',
         justificativa               = null,
         tipo_falta                  = null,
         possui_tratativa            = true,
         tratativa_profissional_id   = excluded.tratativa_profissional_id,
         tratativa_profissional_nome = excluded.tratativa_profissional_nome,
         tratativa_usuario_id        = excluded.tratativa_usuario_id,
         tratativa_criada_em         = coalesce(public.grade_evolucoes.tratativa_criada_em, excluded.tratativa_criada_em),
         tratativa_origem            = 'Prontuario',
         evolucao_vinculo            = excluded.evolucao_vinculo,
         descricao_evolucao          = excluded.descricao_evolucao,
         tratativas                  = excluded.tratativas,
         tratativas_distintas        = excluded.tratativas_distintas,
         origem                      = 'pulsar',
         registrado_por              = excluded.registrado_por,
         registrado_por_nome         = excluded.registrado_por_nome,
         atualizado_em               = v_agora;

  insert into public.grade_eventos (
    acao, agendamento_id, serie_id, profissional_id, paciente_id, quantidade,
    antes, depois, resumo, feito_por, feito_por_nome
  ) values (
    v_acao, a.id, a.serie_id, a.profissional_id, a.paciente_id, 1,
    case when ant.agendamento_id is not null then jsonb_build_object(
      'status_execucao', ant.status_execucao,
      'tipo_falta', ant.tipo_falta,
      'tratativa_profissional_nome', ant.tratativa_profissional_nome
    ) else null end,
    jsonb_build_object(
      'status_execucao', 'Realizado',
      'tratativa_profissional_id', v_trat_id,
      'tratativa_profissional_nome', v_trat_nome,
      'substituicao', v_subst
    ),
    case when v_acao = 'evolucao_editada' then 'Evolução atualizada' else 'Sessão evoluída' end
      || ' (' || to_char(a.data, 'DD/MM/YYYY') || ' ' || to_char(a.hora_inicio, 'HH24:MI') || ') — '
      || a.pac_nome_atual || ' × ' || a.prof_nome_atual
      || case when v_subst then ' (Substituído por ' || v_trat_nome || ')' else '' end
      || ' · Realizado por ' || v_autor.usuario_nome,
    v_autor.usuario_id, v_autor.usuario_nome
  );

  return public.grade_detalhe_evolucao(p_agendamento_id);
end $$;

create or replace function public.grade_registrar_falta(
  p_agendamento_id uuid,
  p_tipo_falta     text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a          record;
  ant        record;
  v_autor    record;
  v_tipo     text := lower(btrim(coalesce(p_tipo_falta, '')));
  v_just     text;
  v_rotulo   text;
  v_vinculo  text;
  v_agora    timestamptz := now();
begin
  perform public.sp_grade_exigir_evoluir(p_agendamento_id);

  if v_tipo in ('profissional', 'prestador', 'falta do profissional', 'falta_profissional') then
    v_tipo := 'terapeuta';
  elsif v_tipo in ('paciente', 'falta do paciente', 'falta_paciente') then
    v_tipo := 'paciente';
  end if;
  if v_tipo not in ('paciente', 'terapeuta') then
    raise exception 'Escolha se a falta foi do paciente ou do profissional.' using errcode = '22023';
  end if;

  v_just   := case when v_tipo = 'terapeuta' then 'Não realizado — prestador' else 'Não realizado — paciente' end;
  v_rotulo := case when v_tipo = 'terapeuta' then 'Falta do profissional' else 'Falta do paciente' end;

  select
    ag.*,
    coalesce(pac.nome, ag.paciente_nome) as pac_nome_atual,
    coalesce(pr.nome, ag.profissional_nome) as prof_nome_atual
    into a
    from public.grade_agendamentos ag
    left join public.pacientes pac on pac.id_paciente = ag.paciente_id
    left join public.profissionais pr on pr.id = ag.profissional_id
   where ag.id = p_agendamento_id
   for update of ag;

  if not found then
    raise exception 'Sessão não encontrada.' using errcode = 'P0002';
  end if;

  select * into v_autor from public.sp_grade_autor_evolucao();
  v_vinculo := case when a.situacao = 'excluido' then 'Agendamento excluído' else 'Agendamento ativo' end;

  select * into ant from public.grade_evolucoes where agendamento_id = p_agendamento_id for update;

  insert into public.grade_evolucoes (
    agendamento_id, tita_agendamento_id, status_execucao, justificativa, tipo_falta,
    possui_tratativa, tratativa_profissional_id, tratativa_profissional_nome,
    tratativa_usuario_id, tratativa_criada_em, tratativa_origem, evolucao_vinculo,
    descricao_evolucao, tratativas, tratativas_distintas,
    origem, registrado_por, registrado_por_nome, criado_em, atualizado_em
  ) values (
    a.id, a.tita_agendamento_id, 'Cancelado', v_just, v_tipo,
    false, null, null,
    null, null, 'Prontuario', v_vinculo,
    null, 0, 0,
    'pulsar', v_autor.usuario_id, v_autor.usuario_nome, v_agora, v_agora
  )
  on conflict (agendamento_id) do update
     set tita_agendamento_id         = excluded.tita_agendamento_id,
         status_execucao             = 'Cancelado',
         justificativa               = excluded.justificativa,
         tipo_falta                  = excluded.tipo_falta,
         possui_tratativa            = false,
         tratativa_profissional_id   = null,
         tratativa_profissional_nome = null,
         tratativa_usuario_id        = null,
         tratativa_criada_em         = null,
         evolucao_vinculo            = excluded.evolucao_vinculo,
         descricao_evolucao          = null,
         tratativas                  = 0,
         tratativas_distintas        = 0,
         origem                      = 'pulsar',
         registrado_por              = excluded.registrado_por,
         registrado_por_nome         = excluded.registrado_por_nome,
         atualizado_em               = v_agora;

  insert into public.grade_eventos (
    acao, agendamento_id, serie_id, profissional_id, paciente_id, quantidade,
    antes, depois, motivo, resumo, feito_por, feito_por_nome
  ) values (
    'falta_registrada', a.id, a.serie_id, a.profissional_id, a.paciente_id, 1,
    case when ant.agendamento_id is not null then jsonb_build_object(
      'status_execucao', ant.status_execucao,
      'tipo_falta', ant.tipo_falta,
      'possui_tratativa', ant.possui_tratativa
    ) else null end,
    jsonb_build_object('status_execucao', 'Cancelado', 'tipo_falta', v_tipo, 'justificativa', v_just),
    v_rotulo,
    v_rotulo || ' (' || to_char(a.data, 'DD/MM/YYYY') || ' ' || to_char(a.hora_inicio, 'HH24:MI') || ') — '
      || a.pac_nome_atual || ' × ' || a.prof_nome_atual,
    v_autor.usuario_id, v_autor.usuario_nome
  );

  return public.grade_detalhe_evolucao(p_agendamento_id);
end $$;

create or replace function public.grade_limpar_evolucao(p_agendamento_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a       record;
  ant     record;
  v_autor record;
begin
  perform public.sp_grade_exigir_evoluir(p_agendamento_id);

  select
    ag.*,
    coalesce(pac.nome, ag.paciente_nome) as pac_nome_atual,
    coalesce(pr.nome, ag.profissional_nome) as prof_nome_atual
    into a
    from public.grade_agendamentos ag
    left join public.pacientes pac on pac.id_paciente = ag.paciente_id
    left join public.profissionais pr on pr.id = ag.profissional_id
   where ag.id = p_agendamento_id;

  if not found then
    raise exception 'Sessão não encontrada.' using errcode = 'P0002';
  end if;

  select * into v_autor from public.sp_grade_autor_evolucao();

  delete from public.grade_evolucoes
   where agendamento_id = p_agendamento_id
   returning * into ant;

  if found then
    insert into public.grade_eventos (
      acao, agendamento_id, serie_id, profissional_id, paciente_id, quantidade,
      antes, resumo, feito_por, feito_por_nome
    ) values (
      'evolucao_removida', a.id, a.serie_id, a.profissional_id, a.paciente_id, 1,
      jsonb_build_object(
        'status_execucao', ant.status_execucao,
        'tipo_falta', ant.tipo_falta,
        'possui_tratativa', ant.possui_tratativa,
        'tratativa_profissional_nome', ant.tratativa_profissional_nome
      ),
      'Registro de evolução/falta removido (' || to_char(a.data, 'DD/MM/YYYY') || ' ' || to_char(a.hora_inicio, 'HH24:MI') || ') — '
        || a.pac_nome_atual || ' × ' || a.prof_nome_atual,
      v_autor.usuario_id, v_autor.usuario_nome
    );
  end if;

  return public.grade_detalhe_evolucao(p_agendamento_id);
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- G) View de compatibilidade para central-pacientes/ e relacionamento-prestador/rp/
-- ═════════════════════════════════════════════════════════════════════════════
create or replace view public.vw_grade_execucao_pulsar
with (security_invoker = true)
as
select
  a.id as agendamento_id,
  a.tita_agendamento_id,
  a.serie_id,
  a.data,
  a.dia_semana,
  a.hora_inicio as hora_inicial,
  a.hora_fim as hora_final,
  a.duracao_min,
  a.paciente_id,
  coalesce(pac.nome, a.paciente_nome) as paciente_nome,
  pac.convenio_nome,
  a.profissional_id,
  coalesce(pr_ag.nome, a.profissional_nome) as profissional_nome,
  a.terapia_id,
  coalesce(ct.nome, a.terapia_nome) as terapia_nome,
  a.terapia_exibicao_id,
  coalesce(ct_ex.nome, a.terapia_exibicao_nome) as terapia_exibicao_nome,
  a.local_id,
  a.sala_nome,
  a.unidade_nome,
  case when a.situacao = 'agendado' then 'Agendado' else 'Cancelado' end as status_agendamento,
  -- Colunas de execução no formato esperado por relacionamento-prestador/rp/ (RP_FIELDS)
  e.status_execucao,
  e.justificativa,
  e.tipo_falta,
  e.possui_tratativa,
  e.tratativa_profissional_id,
  coalesce(pr_tr.nome, e.tratativa_profissional_nome) as tratativa_profissional_nome,
  e.tratativa_criada_em,
  e.tratativa_origem,
  e.evolucao_vinculo,
  e.descricao_evolucao,
  e.tratativas,
  e.tratativas_distintas,
  e.origem as execucao_origem,
  -- Colunas de controle operacional no formato esperado por central-pacientes/
  (
    coalesce(e.possui_tratativa, false)
    and (
      (e.tratativa_profissional_id is not null and e.tratativa_profissional_id <> a.profissional_id)
      or (
        e.tratativa_profissional_id is null
        and e.tratativa_profissional_nome is not null
        and lower(btrim(e.tratativa_profissional_nome)) <> lower(btrim(coalesce(pr_ag.nome, a.profissional_nome)))
      )
    )
  ) as is_substituicao,
  case
    when e.tratativa_profissional_id is not null and e.tratativa_profissional_id <> a.profissional_id
      then e.tratativa_profissional_id
    else null
  end as profissional_substituto_id,
  case
    when coalesce(e.possui_tratativa, false)
     and (
       (e.tratativa_profissional_id is not null and e.tratativa_profissional_id <> a.profissional_id)
       or (
         e.tratativa_profissional_id is null
         and e.tratativa_profissional_nome is not null
         and lower(btrim(e.tratativa_profissional_nome)) <> lower(btrim(coalesce(pr_ag.nome, a.profissional_nome)))
       )
     )
      then coalesce(pr_tr.nome, e.tratativa_profissional_nome)
    else null
  end as profissional_substituto_nome,
  coalesce(
    pr_tr.nome,
    e.tratativa_profissional_nome,
    pr_ag.nome,
    a.profissional_nome
  ) as profissional_realizou_nome,
  case
    when e.status_execucao = 'Realizado' then 'presente'
    when e.status_execucao = 'Cancelado' then 'faltou'
    else 'pendente'
  end as controle_status,
  coalesce(e.tratativa_criada_em, e.atualizado_em) as confirmado_em,
  coalesce(pr_tr.nome, e.tratativa_profissional_nome, e.registrado_por_nome) as confirmado_por_nome
from public.grade_agendamentos a
left join public.grade_evolucoes e on e.agendamento_id = a.id
left join public.pacientes pac on pac.id_paciente = a.paciente_id
left join public.profissionais pr_ag on pr_ag.id = a.profissional_id
left join public.profissionais pr_tr on pr_tr.id = e.tratativa_profissional_id
left join public.cadastro_terapias ct on ct.id = a.terapia_id
left join public.cadastro_terapias ct_ex on ct_ex.id = a.terapia_exibicao_id
where a.situacao = 'agendado';

comment on view public.vw_grade_execucao_pulsar is
  'Ponte de leitura da Grade + Evoluções para relacionamento-prestador/rp/ (mesmas colunas de RP_FIELDS em gradeRemuneracao.ts) e central-pacientes/ (mesmas colunas de controle_terapeutico em listar_central_pacientes).';

-- ═════════════════════════════════════════════════════════════════════════════
-- H) RLS e GRANTs
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.grade_evolucoes enable row level security;

drop policy if exists "grade_evolucoes_select" on public.grade_evolucoes;
create policy "grade_evolucoes_select" on public.grade_evolucoes
  for select to authenticated
  using ((select public.sp_grade_pode_evoluir(agendamento_id)));

revoke all on public.grade_evolucoes from public, anon, authenticated;
grant select on public.grade_evolucoes to authenticated, service_role;

revoke all on public.vw_grade_execucao_pulsar from public, anon, authenticated;
grant select on public.vw_grade_execucao_pulsar to authenticated, service_role;

revoke all on function public.sp_grade_evolucoes_guarda()                                           from public, anon, authenticated;
revoke all on function public.sp_grade_eh_admin()                                                   from public, anon, authenticated;
revoke all on function public.sp_grade_pode_evoluir(uuid)                                           from public, anon, authenticated;
revoke all on function public.sp_grade_exigir_evoluir(uuid)                                         from public, anon, authenticated;
revoke all on function public.sp_grade_autor_evolucao()                                             from public, anon, authenticated;
revoke all on function public.sp_grade_espelhar_evolucoes_tita(date, date)                          from public, anon, authenticated;
revoke all on function public.sp_grade_falta_recepcao(bigint, bigint, bigint, text, date, time)     from public, anon, authenticated;

revoke all on function public.grade_meu_acesso_evolucao()                                           from public, anon;
revoke all on function public.grade_resumo_evolucoes_periodo(date, date, bigint[])                  from public, anon;
revoke all on function public.grade_detalhe_evolucao(uuid)                                          from public, anon;
revoke all on function public.grade_registrar_evolucao(uuid, text, bigint)                           from public, anon;
revoke all on function public.grade_registrar_falta(uuid, text)                                     from public, anon;
revoke all on function public.grade_limpar_evolucao(uuid)                                           from public, anon;
revoke all on function public.grade_importar_tita_concluir(uuid)                                    from public, anon;

grant execute on function public.grade_meu_acesso_evolucao()                                        to authenticated;
grant execute on function public.grade_resumo_evolucoes_periodo(date, date, bigint[])               to authenticated;
grant execute on function public.grade_detalhe_evolucao(uuid)                                       to authenticated;
grant execute on function public.grade_registrar_evolucao(uuid, text, bigint)                        to authenticated;
grant execute on function public.grade_registrar_falta(uuid, text)                                  to authenticated;
grant execute on function public.grade_limpar_evolucao(uuid)                                        to authenticated;
grant execute on function public.grade_importar_tita_concluir(uuid)                                 to authenticated, service_role;
