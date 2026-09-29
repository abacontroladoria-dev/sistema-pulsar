-- Status Laudos e Senhas: meses FECHADOS no relatório de senhas.
--
-- Pedido do usuário (29/09/2026): o que foi importado de meses anteriores ao
-- mês corrente é INALTERÁVEL. Um upload novo só mexe do mês corrente em diante;
-- o que o arquivo trouxer de mês fechado é ignorado. Em 29/09/2026 o mês aberto
-- é setembro (janeiro a agosto ficam como estão); em 01/10/2026 setembro fecha
-- sozinho, sem ninguém rodar nada — o corte é calculado na hora de cada upload.
--
-- ─── O mês de uma autorização ───────────────────────────────────────────────
--
-- `competencia` = mês da "Data da lista" (na falta dela, do "Criado em"). Medido
-- em 29/09/2026 no relatório de 810 autorizações: a Data da lista está sempre
-- preenchida e é o mês do pedido. "Criado em" foi descartado como régua: 17
-- autorizações da lista de SETEMBRO foram criadas no fim de agosto e ficariam
-- congeladas como agosto. Pela Data da lista, nenhuma autorização criada em
-- setembro tinha lista de agosto ou antes — nada novo se perde.
--
-- ─── Como o upload monta a foto nova ────────────────────────────────────────
--
-- Continua valendo "a tela usa a importação mais recente". Cada upload grava uma
-- importação nova, montada assim a partir da anterior (a BASE):
--
--   1. MANTIDAS: as autorizações da base com competência < mês corrente, copiadas
--      exatamente como estão (e com a importação de onde vieram, em
--      `origem_importacao_id`). Também fica como está a autorização da base que
--      o arquivo trouxe com competência fechada — o arquivo não a altera.
--   2. APLICADAS: as do arquivo com competência >= mês corrente, menos as que já
--      entraram em 1 (ID congelado não é reaberto por mudar de mês na origem).
--   3. IGNORADAS: o resto do arquivo (mês fechado). Contadas, não gravadas.
--   4. REMOVIDAS: autorizações de mês ABERTO que estavam na base e não vieram no
--      arquivo — como antes, o arquivo é a verdade do mês aberto.
--
-- Primeira importação da história (sem base): tudo entra. É a carga inicial;
-- não há o que proteger ainda.
--
-- ─── Inalterável de verdade ─────────────────────────────────────────────────
--
-- Três camadas, para "inalterável" não depender do código da rota:
--   a. A função só INSERE. As linhas mantidas são copiadas do próprio banco, não
--      do arquivo.
--   b. service_role perde UPDATE, DELETE e TRUNCATE nas duas tabelas: fica só
--      SELECT e INSERT. (anon/authenticated continuam sem nada.)
--   c. Gatilhos recusam UPDATE, DELETE e TRUNCATE para QUALQUER papel, o dono
--      inclusive — vale mesmo se alguém devolver o privilégio por engano.
--      Corrigir uma importação errada passa a exigir o dono (postgres)
--      desligando o gatilho de propósito, no SQL Editor.
--
-- Idempotente. NÃO use `supabase db push` (histórico de migrations
-- dessincronizado): aplique este arquivo no SQL Editor.

-- ─── 1. O mês de cada autorização ──────────────────────────────────────────

-- Uma definição só, usada pela coluna gerada E pela função de importação.
create or replace function public.laudos_senhas_competencia(p_data_lista date, p_criado_em timestamp)
returns date
language sql
immutable
set search_path = public
as $$
  select date_trunc('month', coalesce(p_data_lista, p_criado_em::date)::timestamp)::date
$$;

alter table public.laudos_senhas_autorizacoes
  add column if not exists competencia date
    generated always as (public.laudos_senhas_competencia(data_lista, criado_em_origem)) stored;

-- De qual importação esta versão da autorização veio. Nas linhas copiadas para
-- a frente (mês fechado), aponta para a importação ORIGINAL, não a que copiou.
alter table public.laudos_senhas_autorizacoes
  add column if not exists origem_importacao_id uuid;

-- Carga do que já existe: cada linha veio da própria importação. Roda ANTES dos
-- gatilhos de bloqueio (seção 4); numa segunda execução não há linha nula e o
-- UPDATE não toca nada.
update public.laudos_senhas_autorizacoes
   set origem_importacao_id = importacao_id
 where origem_importacao_id is null;

alter table public.laudos_senhas_autorizacoes
  alter column origem_importacao_id set not null;

create index if not exists idx_laudos_senhas_autorizacoes_origem
  on public.laudos_senhas_autorizacoes (origem_importacao_id);

-- ─── 2. Chaves estrangeiras adiáveis ───────────────────────────────────────
--
-- A função grava as autorizações ANTES do cabeçalho: os totais do cabeçalho
-- saem das próprias gravações (ROW_COUNT), sem um segundo cálculo que poderia
-- divergir — e o cabeçalho não pode ser atualizado depois (seção 4). Por isso
-- as chaves só são conferidas no fim da transação.
do $$
declare
  v_nome text;
begin
  select conname into v_nome
    from pg_constraint
   where conrelid = 'public.laudos_senhas_autorizacoes'::regclass
     and contype = 'f'
     and conkey = array[(select attnum from pg_attribute
                          where attrelid = 'public.laudos_senhas_autorizacoes'::regclass
                            and attname = 'importacao_id')];
  if v_nome is null then
    raise exception 'chave estrangeira de laudos_senhas_autorizacoes.importacao_id não encontrada';
  end if;
  execute format(
    'alter table public.laudos_senhas_autorizacoes alter constraint %I deferrable initially deferred',
    v_nome);

  if not exists (select 1 from pg_constraint
                  where conname = 'laudos_senhas_autorizacoes_origem_fkey'
                    and conrelid = 'public.laudos_senhas_autorizacoes'::regclass) then
    alter table public.laudos_senhas_autorizacoes
      add constraint laudos_senhas_autorizacoes_origem_fkey
      foreign key (origem_importacao_id) references public.laudos_senhas_importacoes(id)
      deferrable initially deferred;
  end if;
end;
$$;

-- ─── 3. O que cada importação fez ──────────────────────────────────────────
--
-- Nulas nas importações de antes desta migration (não havia corte).
alter table public.laudos_senhas_importacoes
  add column if not exists mes_corte date,
  add column if not exists base_importacao_id uuid references public.laudos_senhas_importacoes(id),
  add column if not exists autorizacoes_arquivo integer check (autorizacoes_arquivo >= 0),
  add column if not exists aplicadas_do_arquivo integer check (aplicadas_do_arquivo >= 0),
  add column if not exists ignoradas_mes_fechado integer check (ignoradas_mes_fechado >= 0),
  add column if not exists mantidas_da_base integer check (mantidas_da_base >= 0),
  add column if not exists removidas_mes_aberto integer check (removidas_mes_aberto >= 0);

comment on column public.laudos_senhas_importacoes.mes_corte is
  'Primeiro dia do mês corrente (Brasília) no upload. Autorizações com competência anterior a ele vieram da base, intocadas; as do arquivo foram ignoradas.';
comment on column public.laudos_senhas_autorizacoes.competencia is
  'Mês da autorização: 1º dia do mês da Data da lista (ou do Criado em). Mês anterior ao corrente = fechado, inalterável.';
comment on column public.laudos_senhas_autorizacoes.origem_importacao_id is
  'Importação que trouxe esta versão da autorização. Em linha de mês fechado copiada para a frente, é a importação original.';

-- ─── 4. Inalterável ────────────────────────────────────────────────────────

create or replace function public.laudos_senhas_bloquear_alteracao()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception
    'laudos_senhas: % em % recusado. As importações de senhas são inalteráveis: suba um relatório novo (meses fechados não mudam).',
    tg_op, tg_table_name
    using errcode = '42501';
end;
$$;

drop trigger if exists trg_laudos_senhas_autorizacoes_inalteravel on public.laudos_senhas_autorizacoes;
create trigger trg_laudos_senhas_autorizacoes_inalteravel
  before update or delete on public.laudos_senhas_autorizacoes
  for each row execute function public.laudos_senhas_bloquear_alteracao();

drop trigger if exists trg_laudos_senhas_autorizacoes_sem_truncate on public.laudos_senhas_autorizacoes;
create trigger trg_laudos_senhas_autorizacoes_sem_truncate
  before truncate on public.laudos_senhas_autorizacoes
  for each statement execute function public.laudos_senhas_bloquear_alteracao();

drop trigger if exists trg_laudos_senhas_importacoes_inalteravel on public.laudos_senhas_importacoes;
create trigger trg_laudos_senhas_importacoes_inalteravel
  before update or delete on public.laudos_senhas_importacoes
  for each row execute function public.laudos_senhas_bloquear_alteracao();

drop trigger if exists trg_laudos_senhas_importacoes_sem_truncate on public.laudos_senhas_importacoes;
create trigger trg_laudos_senhas_importacoes_sem_truncate
  before truncate on public.laudos_senhas_importacoes
  for each statement execute function public.laudos_senhas_bloquear_alteracao();

-- O gatilho de "importado_em_brasilia" rodava também em UPDATE, que não existe
-- mais: fica só no INSERT.
drop trigger if exists trg_laudos_senhas_importado_em_brasilia on public.laudos_senhas_importacoes;
create trigger trg_laudos_senhas_importado_em_brasilia
  before insert on public.laudos_senhas_importacoes
  for each row execute function public.set_laudos_senhas_importado_em_brasilia();

-- ─── 5. O mês corrente ─────────────────────────────────────────────────────
--
-- Função à parte, sem parâmetro: ninguém de fora escolhe o "hoje" do corte
-- (passar uma data antiga reabriria meses fechados). O relógio é o do banco, em
-- Brasília.
create or replace function public.laudos_senhas_mes_corte()
returns date
language sql
stable
set search_path = public
as $$
  select date_trunc('month', now() at time zone 'America/Sao_Paulo')::date
$$;

-- ─── 6. A importação ───────────────────────────────────────────────────────

create or replace function public.laudos_senhas_importar(
  p_arquivo_nome text,
  p_arquivo_sha256 text,
  p_total_linhas integer,
  p_importado_por uuid,
  p_importado_por_nome text,
  p_autorizacoes jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
  v_existente record;
  v_base uuid;
  v_corte date;
  v_arquivo integer;
  v_mantidas integer;
  v_aplicadas integer;
  v_removidas integer;
begin
  if p_autorizacoes is null or jsonb_typeof(p_autorizacoes) <> 'array'
     or jsonb_array_length(p_autorizacoes) = 0 then
    raise exception 'laudos_senhas_importar: nenhuma autorização no arquivo'
      using errcode = '22023';
  end if;

  -- Uma importação por vez: duas simultâneas copiariam da mesma base e a
  -- segunda apagaria o que a primeira aplicou. Também resolve o duplo clique.
  perform pg_advisory_xact_lock(hashtext('public.laudos_senhas_importar'));

  select id, importado_em_brasilia, importado_por_nome
    into v_existente
    from public.laudos_senhas_importacoes
   where arquivo_sha256 = p_arquivo_sha256;
  if found then
    return jsonb_build_object(
      'duplicado', true,
      'importacao_id', v_existente.id,
      'importado_em_brasilia', v_existente.importado_em_brasilia,
      'importado_por_nome', v_existente.importado_por_nome
    );
  end if;

  v_corte := public.laudos_senhas_mes_corte();

  -- A base é a importação em uso — a MESMA ordem com que a tela escolhe.
  select id into v_base
    from public.laudos_senhas_importacoes
   order by importado_em desc
   limit 1;

  v_arquivo := jsonb_array_length(p_autorizacoes);

  -- 1. MANTIDAS: mês fechado da base, copiado do banco tal como está. E a
  --    autorização de mês aberto que o arquivo trouxe como mês fechado: o
  --    arquivo é ignorado para ela, então vale a versão que já existia.
  insert into public.laudos_senhas_autorizacoes (
    importacao_id, origem_importacao_id, id_autorizacao, id_laudo, id_favorecido, plano,
    data_lista, situacao_dentro, senha_dentro, liberacao_dentro, validade_dentro,
    situacao_fora, senha_fora, liberacao_fora, validade_fora,
    criado_em_origem, atualizado_em_origem,
    arquivo_autorizacao, cronograma_convenio, observacoes, especialidades
  )
  select
    v_id, b.origem_importacao_id, b.id_autorizacao, b.id_laudo, b.id_favorecido, b.plano,
    b.data_lista, b.situacao_dentro, b.senha_dentro, b.liberacao_dentro, b.validade_dentro,
    b.situacao_fora, b.senha_fora, b.liberacao_fora, b.validade_fora,
    b.criado_em_origem, b.atualizado_em_origem,
    b.arquivo_autorizacao, b.cronograma_convenio, b.observacoes, b.especialidades
  from public.laudos_senhas_autorizacoes b
  where b.importacao_id = v_base
    and (
      b.competencia < v_corte
      or exists (
        select 1
          from jsonb_to_recordset(p_autorizacoes) as a(id_autorizacao text, data_lista date, criado_em_origem timestamp)
         where a.id_autorizacao = b.id_autorizacao
           and public.laudos_senhas_competencia(a.data_lista, a.criado_em_origem) < v_corte
      )
    );
  get diagnostics v_mantidas = row_count;

  -- 2. APLICADAS: mês aberto do arquivo (competência nula conta como aberta:
  --    sem data não há como provar que o mês fechou). Sem base, tudo entra.
  --    O `not exists` deixa de fora o ID que já entrou em 1.
  insert into public.laudos_senhas_autorizacoes (
    importacao_id, origem_importacao_id, id_autorizacao, id_laudo, id_favorecido, plano,
    data_lista, situacao_dentro, senha_dentro, liberacao_dentro, validade_dentro,
    situacao_fora, senha_fora, liberacao_fora, validade_fora,
    criado_em_origem, atualizado_em_origem,
    arquivo_autorizacao, cronograma_convenio, observacoes, especialidades
  )
  select
    v_id, v_id, x.id_autorizacao, x.id_laudo, x.id_favorecido, x.plano,
    x.data_lista, x.situacao_dentro, x.senha_dentro, x.liberacao_dentro, x.validade_dentro,
    x.situacao_fora, x.senha_fora, x.liberacao_fora, x.validade_fora,
    x.criado_em_origem, x.atualizado_em_origem,
    x.arquivo_autorizacao, x.cronograma_convenio, x.observacoes,
    coalesce(x.especialidades, '[]'::jsonb)
  from jsonb_to_recordset(p_autorizacoes) as x(
    id_autorizacao text,
    id_laudo text,
    id_favorecido bigint,
    plano text,
    data_lista date,
    situacao_dentro text,
    senha_dentro text,
    liberacao_dentro date,
    validade_dentro date,
    situacao_fora text,
    senha_fora text,
    liberacao_fora date,
    validade_fora date,
    criado_em_origem timestamp,
    atualizado_em_origem timestamp,
    arquivo_autorizacao text,
    cronograma_convenio text,
    observacoes text,
    especialidades jsonb
  )
  where (
      v_base is null
      or public.laudos_senhas_competencia(x.data_lista, x.criado_em_origem) is null
      or public.laudos_senhas_competencia(x.data_lista, x.criado_em_origem) >= v_corte
    )
    and not exists (
      select 1 from public.laudos_senhas_autorizacoes n
       where n.importacao_id = v_id and n.id_autorizacao = x.id_autorizacao
    );
  get diagnostics v_aplicadas = row_count;

  -- 4. REMOVIDAS: da base, o que não chegou à importação nova (só pode ser de
  --    mês aberto — o fechado foi todo copiado em 1).
  select count(*) into v_removidas
    from public.laudos_senhas_autorizacoes b
   where b.importacao_id = v_base
     and not exists (
       select 1 from public.laudos_senhas_autorizacoes n
        where n.importacao_id = v_id and n.id_autorizacao = b.id_autorizacao
     );

  insert into public.laudos_senhas_importacoes
    (id, arquivo_nome, arquivo_sha256, total_linhas, total_autorizacoes,
     importado_por, importado_por_nome,
     mes_corte, base_importacao_id, autorizacoes_arquivo, aplicadas_do_arquivo,
     ignoradas_mes_fechado, mantidas_da_base, removidas_mes_aberto)
  values
    (v_id, p_arquivo_nome, p_arquivo_sha256, p_total_linhas, v_mantidas + v_aplicadas,
     p_importado_por, p_importado_por_nome,
     v_corte, v_base, v_arquivo, v_aplicadas,
     v_arquivo - v_aplicadas, v_mantidas, v_removidas);

  return jsonb_build_object(
    'duplicado', false,
    'importacao_id', v_id,
    'autorizacoes', v_mantidas + v_aplicadas,
    'mes_corte', v_corte,
    'primeira_importacao', v_base is null,
    'autorizacoes_arquivo', v_arquivo,
    'aplicadas_do_arquivo', v_aplicadas,
    'ignoradas_mes_fechado', v_arquivo - v_aplicadas,
    'mantidas_da_base', v_mantidas,
    'removidas_mes_aberto', v_removidas
  );
end;
$$;

comment on function public.laudos_senhas_importar(text, text, integer, uuid, text, jsonb) is
  'Grava uma importação nova a partir da anterior: meses fechados (competência < mês corrente em Brasília) são copiados intocados e o que o arquivo traz deles é ignorado; o mês aberto vem do arquivo. Mesmo sha256 = duplicado. Só service_role executa.';
comment on table public.laudos_senhas_autorizacoes is
  'Uma linha por ID autorização por importação, com as especialidades em jsonb. Sem nome nem CPF do paciente. Casa com a tela por (id_laudo, id_favorecido). Só INSERT: UPDATE/DELETE/TRUNCATE recusados por gatilho. Só service_role.';
comment on table public.laudos_senhas_importacoes is
  'Cada upload do relatorio_autorizacoes_assim_*.csv. A tela usa a importação mais recente. Meses fechados vêm da importação anterior, intocados. Só INSERT: UPDATE/DELETE/TRUNCATE recusados por gatilho. Só service_role.';

-- ─── 7. Acesso ─────────────────────────────────────────────────────────────

alter table public.laudos_senhas_importacoes enable row level security;
alter table public.laudos_senhas_importacoes force row level security;
alter table public.laudos_senhas_autorizacoes enable row level security;
alter table public.laudos_senhas_autorizacoes force row level security;

revoke all on public.laudos_senhas_importacoes from public, anon, authenticated, service_role;
revoke all on public.laudos_senhas_autorizacoes from public, anon, authenticated, service_role;
grant select, insert on public.laudos_senhas_importacoes to service_role;
grant select, insert on public.laudos_senhas_autorizacoes to service_role;

revoke all on function public.laudos_senhas_importar(text, text, integer, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.laudos_senhas_importar(text, text, integer, uuid, text, jsonb)
  to service_role;

revoke all on function public.laudos_senhas_mes_corte() from public, anon, authenticated;
grant execute on function public.laudos_senhas_mes_corte() to service_role;

-- A coluna gerada chama esta função a cada INSERT feito pela service_role.
revoke all on function public.laudos_senhas_competencia(date, timestamp) from public, anon, authenticated;
grant execute on function public.laudos_senhas_competencia(date, timestamp) to service_role;

revoke all on function public.laudos_senhas_bloquear_alteracao() from public, anon, authenticated;
revoke all on function public.set_laudos_senhas_importado_em_brasilia() from public, anon, authenticated;
