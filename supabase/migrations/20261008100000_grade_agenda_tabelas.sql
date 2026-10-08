-- Grade (Cronograma) — agenda PRÓPRIA do Pulsar. Parte 1: tabelas.
--
-- Plano: docs/PLANO_GRADE_CRONOGRAMA.md. Decisões do usuário (07/10/2026):
--
--   - NADA É ESCRITO NO TITA. Toda alteração feita na Grade vale só aqui. O TiTa
--     só é LIDO, e só quando alguém clica em "Importar do TiTa" (lê a cópia já
--     sincronizada em csv_grades_profissionais; nenhuma chamada à API).
--   - A grade de cada profissional vem da Disponibilidade do cadastro
--     (profissionais_disponibilidade_*), com capacidade por faixa.
--   - Auditoria completa: quem criou, quem excluiu, quando, por quê.
--   - Agendamento anterior à saída de um profissional NUNCA é apagado.
--
-- Tabelas:
--
--   grade_importacoes  — cada clique em "Importar do TiTa" (prévia → aplicada);
--   grade_series       — a regra de repetição ("toda segunda às 08:40");
--   grade_agendamentos — UMA LINHA POR SESSÃO (ocorrências materializadas). É a
--                        tabela focal da agenda: sem CPF/CBO/registro (são do
--                        cadastro) e sem evolução/tratativa/execução (serão do
--                        Controle Terapêutico, que vai apontar para o id daqui);
--   grade_bloqueios    — horários fechados do profissional (férias, administrativo);
--   grade_eventos      — trilha append-only, com resumo legível.
--
-- Regras de integridade (gatilhos):
--
--   1. Sessão nunca é apagada: exclusão é LÓGICA (situacao = 'excluido' + quem,
--      quando, motivo, escopo). DELETE é recusado.
--   2. Passado congelado: sessão com data anterior a hoje (Brasília) não muda —
--      "excluir" vale de hoje em diante.
--   3. A identidade da sessão (quem, quando, o quê, onde) não muda depois de
--      gravada; corrigir = excluir e criar outra. Só a exclusão e o vínculo com
--      o id do TiTa (nulo → valor, na importação) podem ser gravados depois.
--   4. Eventos são imutáveis.
--
-- Escrita só pelas RPCs (próximas migrations); leitura só com a permissão
-- cronograma_grade. anon sem nada. Idempotente.

-- ═════════════════════════════════════════════════════════════════════════════
-- A) Importações do TiTa
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.grade_importacoes (
  id                 uuid primary key default gen_random_uuid(),
  janela_inicio      date not null,
  janela_fim         date not null,
  situacao           text not null default 'previa',
  -- Contadores da prévia.
  contadores         jsonb not null default '{}'::jsonb,
  -- Soma do que foi aplicado (a aplicação roda em lotes de profissionais).
  aplicado           jsonb not null default '{}'::jsonb,
  -- Último sincronizado_em de grade_sync_dia dentro da janela (frescor do que foi lido).
  frescor            timestamptz,
  criado_por         uuid,
  criado_por_nome    text,
  criado_em          timestamptz not null default now(),
  aplicada_em        timestamptz,
  aplicada_por       uuid,
  aplicada_por_nome  text,

  constraint grade_importacoes_janela_check
    check (janela_fim >= janela_inicio and janela_fim - janela_inicio <= 120),
  constraint grade_importacoes_situacao_check
    check (situacao in ('previa', 'aplicando', 'aplicada', 'descartada'))
);

create index if not exists idx_grade_importacoes_criado_em
  on public.grade_importacoes (criado_em desc);

comment on table public.grade_importacoes is
  'Cada "Importar do TiTa" da Grade: janela lida, contadores da prévia e do que foi aplicado. Só leitura de csv_grades_profissionais; nada vai ao TiTa.';

-- ═════════════════════════════════════════════════════════════════════════════
-- B) Séries (regra de repetição)
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.grade_series (
  id                     uuid primary key default gen_random_uuid(),
  paciente_id            bigint not null references public.pacientes(id_paciente) on delete restrict,
  profissional_id        bigint not null references public.profissionais(id) on delete restrict,
  terapia_id             bigint not null references public.cadastro_terapias(id),
  terapia_nome           text not null,
  terapia_exibicao_id    bigint references public.cadastro_terapias(id),
  terapia_exibicao_nome  text,

  -- 0 = domingo … 6 = sábado (extract(dow)). Sempre o dia de data_inicio.
  dia_semana             smallint not null,
  hora_inicio            time not null,
  hora_fim               time not null,

  -- Local (cronograma_salas.id) SEM FK, com cópia do nome — mesmo motivo das
  -- faixas de disponibilidade: Ocupação de Salas apaga sala com DELETE físico.
  local_id               uuid,
  sala_nome              text,
  unidade_nome           text,

  -- 'unica' = uma sessão só; 'semanal' = a cada `intervalo_semanas` semanas
  -- (1 = toda semana, 2 = quinzenal…).
  frequencia             text not null default 'semanal',
  intervalo_semanas      smallint not null default 1,
  data_inicio            date not null,
  -- null = CONTÍNUA (sem término). As sessões são materializadas até o
  -- horizonte (6 meses) e o pg_cron noturno estende.
  data_fim               date,
  -- "Termina após N sessões": a série nasce inteira e data_fim é a última data.
  total_sessoes          smallint,
  -- Até onde as sessões já foram geradas.
  materializada_ate      date,

  situacao               text not null default 'ativa',
  -- Primeira data que deixou de existir ("excluir desta em diante",
  -- inativação do profissional). As sessões a partir dela ficam excluídas.
  encerrada_a_partir     date,
  encerrada_em           timestamptz,
  encerrada_por          uuid,
  encerrada_por_nome     text,
  motivo_encerramento    text,

  origem                 text not null default 'pulsar',
  importacao_id          uuid references public.grade_importacoes(id),
  -- Série inferida da grade do TiTa: paciente|profissional|terapia|dia|hora
  -- (ids do Pulsar). Reimportar casa por aqui.
  tita_chave             text,
  observacao             text,

  criado_em              timestamptz not null default now(),
  criado_por             uuid,
  criado_por_nome        text,
  atualizado_em          timestamptz not null default now(),

  constraint grade_series_dia_check        check (dia_semana between 0 and 6),
  constraint grade_series_horario_check    check (hora_fim > hora_inicio),
  constraint grade_series_frequencia_check check (frequencia in ('unica', 'semanal')),
  constraint grade_series_intervalo_check  check (intervalo_semanas between 1 and 8),
  constraint grade_series_periodo_check    check (data_fim is null or data_fim >= data_inicio),
  constraint grade_series_total_check      check (total_sessoes is null or total_sessoes between 1 and 520),
  constraint grade_series_situacao_check   check (situacao in ('ativa', 'encerrada')),
  constraint grade_series_encerrada_check  check ((situacao = 'encerrada') = (encerrada_a_partir is not null)),
  constraint grade_series_origem_check     check (origem in ('pulsar', 'tita_importacao')),
  constraint grade_series_textos_check     check (
        coalesce(length(observacao), 0) <= 1000
    and coalesce(length(motivo_encerramento), 0) <= 500
  )
);

create index if not exists idx_grade_series_profissional on public.grade_series (profissional_id, situacao);
create index if not exists idx_grade_series_paciente     on public.grade_series (paciente_id, situacao);
create unique index if not exists uq_grade_series_tita_chave
  on public.grade_series (tita_chave) where tita_chave is not null;

comment on table public.grade_series is
  'Regra de repetição de um agendamento da Grade (paciente × profissional × terapia × dia/hora). As sessões ficam em grade_agendamentos. data_fim null = contínua.';

-- ═════════════════════════════════════════════════════════════════════════════
-- C) Agendamentos (uma linha por sessão)
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.grade_agendamentos (
  id                     uuid primary key default gen_random_uuid(),
  serie_id               uuid references public.grade_series(id) on delete restrict,

  -- Quando
  data                   date not null,
  dia_semana             smallint not null default 0,   -- gatilho
  hora_inicio            time not null,
  hora_fim               time not null,
  duracao_min            smallint not null default 0,   -- gatilho

  -- Quem (nomes copiados no momento: a agenda continua legível se o cadastro mudar)
  paciente_id            bigint not null references public.pacientes(id_paciente) on delete restrict,
  paciente_nome          text not null,
  profissional_id        bigint not null references public.profissionais(id) on delete restrict,
  profissional_nome      text not null,

  -- O quê
  terapia_id             bigint not null references public.cadastro_terapias(id),
  terapia_nome           text not null,
  terapia_exibicao_id    bigint references public.cadastro_terapias(id),
  terapia_exibicao_nome  text,

  -- Onde
  local_id               uuid,
  sala_nome              text,
  unidade_nome           text,

  -- Situação (exclusão é sempre lógica)
  situacao               text not null default 'agendado',
  excluido_em            timestamptz,
  excluido_por           uuid,
  excluido_por_nome      text,
  motivo_exclusao        text,
  escopo_exclusao        text,
  lote_id                uuid,

  -- Vínculo com o TiTa (só leitura: de onde veio, nunca para onde vai)
  origem                 text not null default 'pulsar',
  tita_agendamento_id    bigint,
  tita_paciente_id       bigint,
  tita_profissional_id   bigint,
  tita_terapia_id        bigint,
  importacao_id          uuid references public.grade_importacoes(id),

  -- Rastreio
  criado_em              timestamptz not null default now(),
  criado_por             uuid,
  criado_por_nome        text,
  atualizado_em          timestamptz not null default now(),

  constraint grade_agend_horario_check  check (hora_fim > hora_inicio),
  constraint grade_agend_situacao_check check (situacao in ('agendado', 'excluido')),
  constraint grade_agend_origem_check   check (origem in ('pulsar', 'tita_importacao')),
  constraint grade_agend_escopo_check   check (
    escopo_exclusao is null
    or escopo_exclusao in ('somente_esta', 'desta_em_diante', 'inativacao_profissional', 'importacao_tita')
  ),
  -- Excluída ⇔ tem quando e escopo da exclusão.
  constraint grade_agend_exclusao_check check (
    (situacao = 'excluido') = (excluido_em is not null and escopo_exclusao is not null)
  ),
  constraint grade_agend_motivo_check   check (coalesce(length(motivo_exclusao), 0) <= 500)
);

create index if not exists idx_grade_agend_profissional_data on public.grade_agendamentos (profissional_id, data);
create index if not exists idx_grade_agend_paciente_data     on public.grade_agendamentos (paciente_id, data);
create index if not exists idx_grade_agend_serie_data        on public.grade_agendamentos (serie_id, data);
create index if not exists idx_grade_agend_data              on public.grade_agendamentos (data) where situacao = 'agendado';
create unique index if not exists uq_grade_agend_tita_id
  on public.grade_agendamentos (tita_agendamento_id) where tita_agendamento_id is not null;

comment on table public.grade_agendamentos is
  'Agenda do Pulsar: uma linha por sessão. Exclusão LÓGICA (situacao = excluido, com quem/quando/motivo/escopo); passado congelado; DELETE recusado. Escrita só pelas RPCs grade_*. Nada daqui vai ao TiTa.';
comment on column public.grade_agendamentos.origem is
  'pulsar = criada na Grade; tita_importacao = trazida (ou projetada a partir de série trazida) do TiTa pelo botão "Importar do TiTa".';
comment on column public.grade_agendamentos.tita_agendamento_id is
  'Id da sessão no TiTa quando veio de lá. Uma sessão excluída aqui continua com o id: reimportar nunca a traz de volta.';

-- ═════════════════════════════════════════════════════════════════════════════
-- D) Bloqueios
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.grade_bloqueios (
  id                  uuid primary key default gen_random_uuid(),
  profissional_id     bigint not null references public.profissionais(id) on delete restrict,
  data_inicio         date not null,
  -- null = sem término.
  data_fim            date,
  -- Ambos nulos = dia inteiro.
  hora_inicio         time,
  hora_fim            time,
  -- null = todos os dias do período; senão só estes (0 = domingo … 6 = sábado).
  dias_semana         smallint[],
  tipo                text not null default 'bloqueio',
  motivo              text not null,

  situacao            text not null default 'ativo',
  excluido_em         timestamptz,
  excluido_por        uuid,
  excluido_por_nome   text,
  motivo_exclusao     text,

  origem              text not null default 'pulsar',
  importacao_id       uuid references public.grade_importacoes(id),
  -- Bloqueio vindo do TiTa ("Horário Bloqueado"/"Horário Administrativo"):
  -- 'A:<id da sessão no TiTa>'. Reimportar não duplica.
  tita_chave          text,

  criado_em           timestamptz not null default now(),
  criado_por          uuid,
  criado_por_nome     text,
  atualizado_em       timestamptz not null default now(),

  constraint grade_bloq_periodo_check  check (data_fim is null or data_fim >= data_inicio),
  constraint grade_bloq_horario_check  check (
    (hora_inicio is null and hora_fim is null)
    or (hora_inicio is not null and hora_fim is not null and hora_fim > hora_inicio)
  ),
  constraint grade_bloq_dias_check     check (dias_semana is null or (cardinality(dias_semana) > 0 and dias_semana <@ array[0,1,2,3,4,5,6]::smallint[])),
  constraint grade_bloq_tipo_check     check (tipo in ('bloqueio', 'administrativo', 'ferias', 'outro')),
  constraint grade_bloq_motivo_check   check (length(btrim(motivo)) between 2 and 300),
  constraint grade_bloq_situacao_check check (situacao in ('ativo', 'excluido')),
  constraint grade_bloq_exclusao_check check ((situacao = 'excluido') = (excluido_em is not null)),
  constraint grade_bloq_origem_check   check (origem in ('pulsar', 'tita_importacao')),
  constraint grade_bloq_motivo_exc_check check (coalesce(length(motivo_exclusao), 0) <= 500)
);

create index if not exists idx_grade_bloq_profissional on public.grade_bloqueios (profissional_id, data_inicio) where situacao = 'ativo';
create unique index if not exists uq_grade_bloq_tita_chave
  on public.grade_bloqueios (tita_chave) where tita_chave is not null;

comment on table public.grade_bloqueios is
  'Horários fechados de um profissional na Grade (férias, administrativo…). Feriados NÃO são copiados aqui: vêm de public.feriados. Exclusão lógica; período que já passou não é reescrito.';

-- ═════════════════════════════════════════════════════════════════════════════
-- E) Eventos (trilha append-only)
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.grade_eventos (
  id                  bigint generated always as identity primary key,
  acao                text not null,
  agendamento_id      uuid,
  serie_id            uuid,
  bloqueio_id         uuid,
  importacao_id       uuid,
  lote_id             uuid,
  -- Para filtrar o Registro de alterações por pessoa.
  profissional_id     bigint,
  paciente_id         bigint,
  quantidade          integer not null default 1,
  antes               jsonb,
  depois              jsonb,
  motivo              text,
  -- Uma linha pronta para a tela.
  resumo              text not null,
  feito_por           uuid,
  feito_por_nome      text,
  feito_em            timestamptz not null default now(),
  feito_em_brasilia   text,

  constraint grade_eventos_acao_check check (acao in (
    'criado', 'excluido', 'serie_encerrada', 'estendido',
    'importado', 'bloqueio_criado', 'bloqueio_excluido', 'inativacao_profissional'
  ))
);

create index if not exists idx_grade_eventos_feito_em     on public.grade_eventos (feito_em desc);
create index if not exists idx_grade_eventos_agendamento  on public.grade_eventos (agendamento_id) where agendamento_id is not null;
create index if not exists idx_grade_eventos_serie        on public.grade_eventos (serie_id) where serie_id is not null;
create index if not exists idx_grade_eventos_lote         on public.grade_eventos (lote_id) where lote_id is not null;
create index if not exists idx_grade_eventos_profissional on public.grade_eventos (profissional_id, feito_em desc);
create index if not exists idx_grade_eventos_paciente     on public.grade_eventos (paciente_id, feito_em desc);

comment on table public.grade_eventos is
  'Registro de alterações da Grade (append-only): criação de série, exclusões, bloqueios, importações, inativação de profissional. resumo = frase pronta para a tela.';

-- ═════════════════════════════════════════════════════════════════════════════
-- F) Gatilhos
-- ═════════════════════════════════════════════════════════════════════════════

-- Eventos: carimbo de Brasília e imutabilidade.
create or replace function public.sp_grade_eventos_brasilia()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.feito_em := now();
  new.feito_em_brasilia := to_char(new.feito_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');
  return new;
end $$;

drop trigger if exists trg_grade_eventos_brasilia on public.grade_eventos;
create trigger trg_grade_eventos_brasilia
  before insert on public.grade_eventos
  for each row execute function public.sp_grade_eventos_brasilia();

create or replace function public.sp_grade_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% é histórico imutável: % não é permitido.', tg_table_name, tg_op using errcode = '42501';
end $$;

drop trigger if exists trg_grade_eventos_imutavel on public.grade_eventos;
create trigger trg_grade_eventos_imutavel
  before update or delete on public.grade_eventos
  for each row execute function public.sp_grade_imutavel();

-- Agendamentos: campos derivados, identidade imutável, passado congelado,
-- exclusão só lógica e sem volta, vínculo TiTa só de nulo para valor.
create or replace function public.sp_grade_agendamentos_guarda()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- O que pode mudar depois de gravado. Todo o resto é a identidade da sessão.
  c_mutaveis constant text[] := array[
    'situacao', 'excluido_em', 'excluido_por', 'excluido_por_nome', 'motivo_exclusao',
    'escopo_exclusao', 'lote_id', 'tita_agendamento_id', 'importacao_id', 'atualizado_em'
  ];
begin
  if tg_op = 'DELETE' then
    raise exception 'Agendamento é histórico: não pode ser apagado (use a exclusão).' using errcode = '42501';
  end if;

  new.dia_semana  := extract(dow from new.data)::smallint;
  new.duracao_min := (extract(epoch from (new.hora_fim - new.hora_inicio)) / 60)::smallint;
  new.atualizado_em := now();

  if tg_op = 'INSERT' then
    new.criado_em := now();
    -- Sessão nova no passado só vem da importação (a semana corrente do TiTa).
    if new.data < public.hoje_brasilia() and new.origem <> 'tita_importacao' then
      raise exception 'Não é possível agendar em data passada (%).', to_char(new.data, 'DD/MM/YYYY')
        using errcode = '22023';
    end if;
    return new;
  end if;

  -- UPDATE
  if (to_jsonb(new) - c_mutaveis) is distinct from (to_jsonb(old) - c_mutaveis) then
    raise exception 'A sessão não pode ser alterada; exclua e crie outra.' using errcode = '42501';
  end if;

  if old.tita_agendamento_id is not null
     and new.tita_agendamento_id is distinct from old.tita_agendamento_id then
    raise exception 'O vínculo com o TiTa não muda depois de gravado.' using errcode = '42501';
  end if;

  if old.situacao = 'excluido' then
    if new.situacao <> 'excluido'
       or new.excluido_em      is distinct from old.excluido_em
       or new.excluido_por     is distinct from old.excluido_por
       or new.motivo_exclusao  is distinct from old.motivo_exclusao
       or new.escopo_exclusao  is distinct from old.escopo_exclusao
       or new.lote_id          is distinct from old.lote_id then
      raise exception 'Sessão excluída é histórico: a exclusão não pode ser desfeita nem reescrita.' using errcode = '42501';
    end if;
  elsif new.situacao = 'excluido' and old.data < public.hoje_brasilia() then
    raise exception 'Sessão de % já passou: não pode ser excluída.', to_char(old.data, 'DD/MM/YYYY')
      using errcode = '42501';
  end if;

  new.criado_em := old.criado_em;
  return new;
end $$;

drop trigger if exists trg_grade_agendamentos_guarda on public.grade_agendamentos;
create trigger trg_grade_agendamentos_guarda
  before insert or update or delete on public.grade_agendamentos
  for each row execute function public.sp_grade_agendamentos_guarda();

-- Séries: identidade imutável; o que muda é o ciclo de vida (fim, horizonte,
-- encerramento). Encerrada não reabre.
create or replace function public.sp_grade_series_guarda()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c_mutaveis constant text[] := array[
    'data_fim', 'materializada_ate', 'situacao', 'encerrada_a_partir', 'encerrada_em',
    'encerrada_por', 'encerrada_por_nome', 'motivo_encerramento', 'importacao_id', 'atualizado_em'
  ];
begin
  if tg_op = 'DELETE' then
    raise exception 'Série é histórico: não pode ser apagada (encerre-a).' using errcode = '42501';
  end if;

  new.atualizado_em := now();

  if tg_op = 'INSERT' then
    new.criado_em := now();
    if new.dia_semana is distinct from extract(dow from new.data_inicio)::smallint then
      raise exception 'O dia da semana da série precisa ser o da data de início.' using errcode = '22023';
    end if;
    return new;
  end if;

  if (to_jsonb(new) - c_mutaveis) is distinct from (to_jsonb(old) - c_mutaveis) then
    raise exception 'Só o fim e o encerramento de uma série podem mudar.' using errcode = '42501';
  end if;
  if old.situacao = 'encerrada' and (
       new.situacao <> 'encerrada'
       or new.encerrada_a_partir is distinct from old.encerrada_a_partir
       or new.encerrada_em is distinct from old.encerrada_em) then
    raise exception 'Série encerrada não reabre.' using errcode = '42501';
  end if;

  new.criado_em := old.criado_em;
  return new;
end $$;

drop trigger if exists trg_grade_series_guarda on public.grade_series;
create trigger trg_grade_series_guarda
  before insert or update or delete on public.grade_series
  for each row execute function public.sp_grade_series_guarda();

-- Bloqueios: só a exclusão e o encurtamento do fim (sem reescrever o passado).
create or replace function public.sp_grade_bloqueios_guarda()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c_mutaveis constant text[] := array[
    'data_fim', 'situacao', 'excluido_em', 'excluido_por', 'excluido_por_nome',
    'motivo_exclusao', 'atualizado_em'
  ];
  v_hoje date := public.hoje_brasilia();
begin
  if tg_op = 'DELETE' then
    raise exception 'Bloqueio é histórico: não pode ser apagado (exclua-o).' using errcode = '42501';
  end if;

  new.atualizado_em := now();

  if tg_op = 'INSERT' then
    new.criado_em := now();
    if new.data_inicio < v_hoje and new.origem <> 'tita_importacao' then
      raise exception 'O bloqueio não pode começar no passado.' using errcode = '22023';
    end if;
    return new;
  end if;

  if (to_jsonb(new) - c_mutaveis) is distinct from (to_jsonb(old) - c_mutaveis) then
    raise exception 'O bloqueio não pode ser alterado; exclua e crie outro.' using errcode = '42501';
  end if;
  if old.situacao = 'excluido' then
    raise exception 'Bloqueio excluído é histórico.' using errcode = '42501';
  end if;
  if new.data_fim is distinct from old.data_fim then
    -- Só encurtar, e nunca para antes de ontem: os dias passados ficam como foram.
    if new.data_fim is null
       or (old.data_fim is not null and new.data_fim > old.data_fim)
       or new.data_fim < v_hoje - 1 then
      raise exception 'O fim do bloqueio só pode ser antecipado, e não para antes de ontem.' using errcode = '42501';
    end if;
  end if;
  if new.situacao = 'excluido' and old.data_inicio < v_hoje then
    raise exception 'Bloqueio que já começou é encerrado, não excluído.' using errcode = '42501';
  end if;

  new.criado_em := old.criado_em;
  return new;
end $$;

drop trigger if exists trg_grade_bloqueios_guarda on public.grade_bloqueios;
create trigger trg_grade_bloqueios_guarda
  before insert or update or delete on public.grade_bloqueios
  for each row execute function public.sp_grade_bloqueios_guarda();

-- ═════════════════════════════════════════════════════════════════════════════
-- G) RLS e GRANTs — leitura com cronograma_grade; escrita só via RPC
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.grade_importacoes  enable row level security;
alter table public.grade_series       enable row level security;
alter table public.grade_agendamentos enable row level security;
alter table public.grade_bloqueios    enable row level security;
alter table public.grade_eventos      enable row level security;

do $$
declare pol record;
begin
  for pol in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('grade_importacoes', 'grade_series', 'grade_agendamentos', 'grade_bloqueios', 'grade_eventos')
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

create policy "grade_importacoes_select" on public.grade_importacoes
  for select to authenticated using (public.usuario_tem_permissao('cronograma_grade'));
create policy "grade_series_select" on public.grade_series
  for select to authenticated using (public.usuario_tem_permissao('cronograma_grade'));
create policy "grade_agendamentos_select" on public.grade_agendamentos
  for select to authenticated using (public.usuario_tem_permissao('cronograma_grade'));
create policy "grade_bloqueios_select" on public.grade_bloqueios
  for select to authenticated using (public.usuario_tem_permissao('cronograma_grade'));
create policy "grade_eventos_select" on public.grade_eventos
  for select to authenticated using (public.usuario_tem_permissao('cronograma_grade'));

revoke all on public.grade_importacoes  from public, anon, authenticated;
revoke all on public.grade_series       from public, anon, authenticated;
revoke all on public.grade_agendamentos from public, anon, authenticated;
revoke all on public.grade_bloqueios    from public, anon, authenticated;
revoke all on public.grade_eventos      from public, anon, authenticated;

grant select on public.grade_importacoes  to authenticated, service_role;
grant select on public.grade_series       to authenticated, service_role;
grant select on public.grade_agendamentos to authenticated, service_role;
grant select on public.grade_bloqueios    to authenticated, service_role;
grant select on public.grade_eventos      to authenticated, service_role;

revoke all on function public.sp_grade_eventos_brasilia()    from public, anon, authenticated;
revoke all on function public.sp_grade_imutavel()            from public, anon, authenticated;
revoke all on function public.sp_grade_agendamentos_guarda() from public, anon, authenticated;
revoke all on function public.sp_grade_series_guarda()       from public, anon, authenticated;
revoke all on function public.sp_grade_bloqueios_guarda()    from public, anon, authenticated;
