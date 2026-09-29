-- Status Laudos e Senhas: o relatório de autorizações da ASSIM
-- (`relatorio_autorizacoes_assim_*.csv`), subido à mão na tela
-- /acompanhamento/laudos.
--
-- ─── O que o arquivo é (medido em 28/09/2026) ────────────────────────────────
--
-- CSV `;`, UTF-8 com BOM, 27 colunas, 626 linhas. A unidade real é a
-- AUTORIZAÇÃO, não a linha: 95 `ID autorização`, uma linha por especialidade.
-- Senhas, datas, situações, "Criado em" e "Atualizado em" são UNIFORMES dentro
-- de cada autorização (0 divergências em 95) — por isso esta tabela guarda UMA
-- linha por autorização, com as especialidades num jsonb.
--
-- Um laudo pode ter mais de uma autorização (5 de 88). A regra de qual delas
-- representa o laudo NÃO mora aqui: mora em frontend/lib/laudos/senhas.ts,
-- testada. O banco guarda o relatório como ele é.
--
-- ─── Dado sensível ──────────────────────────────────────────────────────────
--
-- O relatório traz nome e CPF do paciente. NENHUM dos dois entra aqui: a tela
-- já tem o nome pelo Órbita e pelo cadastro, e o CPF não tem uso nesta tela.
-- O parser (lib/laudos/senhas.ts) nem os lê, e `jsonb_to_recordset` abaixo só
-- extrai as colunas declaradas — um CPF que chegasse no payload seria ignorado.
--
-- ─── Foto oficial ───────────────────────────────────────────────────────────
--
-- Cada upload é uma importação. A tela usa SEMPRE a mais recente
-- (`order by importado_em desc limit 1`); as anteriores ficam como histórico.
-- Um laudo que sai do relatório passa a aparecer "Sem senha" — é o que o
-- relatório diz.
--
-- ─── Acesso ─────────────────────────────────────────────────────────────────
--
-- Igual a orbita_laudos_* (20260828100000): RLS ligada e forçada, SEM policies,
-- e nenhum GRANT para anon/authenticated. Só a service_role lê e grava, pela
-- rota /api/acompanhamento-laudos(/senhas), que checa sessão e permissão.
--
-- Idempotente.

create table if not exists public.laudos_senhas_importacoes (
  id uuid primary key default gen_random_uuid(),
  arquivo_nome text not null,
  -- O nome do arquivo varia a cada download; o conteúdo é o que identifica.
  -- Subir o mesmo arquivo duas vezes devolve a importação existente.
  arquivo_sha256 text not null unique,
  total_linhas integer not null check (total_linhas >= 0),
  total_autorizacoes integer not null check (total_autorizacoes >= 0),
  -- Nulo no desenvolvimento local (DISABLE_AUTH), onde não há sessão.
  importado_por uuid references public.usuarios(id) on delete set null,
  importado_por_nome text,
  importado_em timestamptz not null default now(),
  -- String já formatada em Brasília, como cadastros_auditoria.criado_em_brasilia.
  -- Coluna GERADA não serve: to_char() e AT TIME ZONE não são IMMUTABLE.
  importado_em_brasilia text
);

create index if not exists idx_laudos_senhas_importacoes_importado_em
  on public.laudos_senhas_importacoes (importado_em desc);

create table if not exists public.laudos_senhas_autorizacoes (
  importacao_id uuid not null
    references public.laudos_senhas_importacoes(id) on delete cascade,
  id_autorizacao text not null,

  -- `ID laudo` = o `ID Laudo` do Órbita; `ID favorecido` = pacientes.tita_paciente_id.
  -- O casamento com a tela exige OS DOIS iguais (lib/laudos/senhas.ts).
  id_laudo text not null,
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

  -- "Criado em"/"Atualizado em" do sistema da ASSIM — hora local, sem fuso.
  criado_em_origem timestamp,
  atualizado_em_origem timestamp,

  arquivo_autorizacao text,
  cronograma_convenio text,
  observacoes text,

  -- [{especialidade, grupo, quantidade_autorizada, quantidade_solicitada,
  --   codigo_guia, descricao_guia, em_uso}] — uma entrada por linha do CSV.
  especialidades jsonb not null default '[]'::jsonb,

  primary key (importacao_id, id_autorizacao)
);

create index if not exists idx_laudos_senhas_autorizacoes_laudo
  on public.laudos_senhas_autorizacoes (importacao_id, id_laudo);

create or replace function public.set_laudos_senhas_importado_em_brasilia()
returns trigger language plpgsql set search_path = public as $$
begin
  new.importado_em_brasilia :=
    to_char(new.importado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');
  return new;
end;
$$;

drop trigger if exists trg_laudos_senhas_importado_em_brasilia on public.laudos_senhas_importacoes;
create trigger trg_laudos_senhas_importado_em_brasilia
  before insert or update on public.laudos_senhas_importacoes
  for each row execute function public.set_laudos_senhas_importado_em_brasilia();

-- ─── Importação atômica ─────────────────────────────────────────────────────
--
-- Cabeçalho + autorizações numa transação só: uma rede que cai no meio não pode
-- deixar uma importação "mais recente" com metade das autorizações — a tela
-- mostraria "Sem senha" para a outra metade sem erro nenhum.
--
-- `on conflict (arquivo_sha256) do nothing` resolve também o duplo clique: o
-- segundo envio do mesmo arquivo vira `duplicado`, não erro de unicidade.
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
  v_id uuid;
  v_existente record;
  v_total integer;
begin
  if p_autorizacoes is null or jsonb_typeof(p_autorizacoes) <> 'array'
     or jsonb_array_length(p_autorizacoes) = 0 then
    raise exception 'laudos_senhas_importar: nenhuma autorização no arquivo'
      using errcode = '22023';
  end if;

  v_total := jsonb_array_length(p_autorizacoes);

  insert into public.laudos_senhas_importacoes
    (arquivo_nome, arquivo_sha256, total_linhas, total_autorizacoes,
     importado_por, importado_por_nome)
  values
    (p_arquivo_nome, p_arquivo_sha256, p_total_linhas, v_total,
     p_importado_por, p_importado_por_nome)
  on conflict (arquivo_sha256) do nothing
  returning id into v_id;

  if v_id is null then
    select id, importado_em_brasilia, importado_por_nome
      into v_existente
      from public.laudos_senhas_importacoes
     where arquivo_sha256 = p_arquivo_sha256;
    return jsonb_build_object(
      'duplicado', true,
      'importacao_id', v_existente.id,
      'importado_em_brasilia', v_existente.importado_em_brasilia,
      'importado_por_nome', v_existente.importado_por_nome
    );
  end if;

  insert into public.laudos_senhas_autorizacoes (
    importacao_id, id_autorizacao, id_laudo, id_favorecido, plano, data_lista,
    situacao_dentro, senha_dentro, liberacao_dentro, validade_dentro,
    situacao_fora, senha_fora, liberacao_fora, validade_fora,
    criado_em_origem, atualizado_em_origem,
    arquivo_autorizacao, cronograma_convenio, observacoes, especialidades
  )
  select
    v_id, x.id_autorizacao, x.id_laudo, x.id_favorecido, x.plano, x.data_lista,
    x.situacao_dentro, x.senha_dentro, x.liberacao_dentro, x.validade_dentro,
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
  );

  return jsonb_build_object(
    'duplicado', false,
    'importacao_id', v_id,
    'autorizacoes', v_total
  );
end;
$$;

comment on table public.laudos_senhas_importacoes is
  'Cada upload do relatorio_autorizacoes_assim_*.csv na tela Status Laudos e Senhas. A tela usa a importação mais recente; as anteriores são histórico. Deduplicado por sha256 do conteúdo. Só service_role.';
comment on table public.laudos_senhas_autorizacoes is
  'Uma linha por ID autorização do relatório da ASSIM, com as especialidades em jsonb. Sem nome nem CPF do paciente, de propósito. Casa com a tela por (id_laudo, id_favorecido). Só service_role.';
comment on function public.laudos_senhas_importar(text, text, integer, uuid, text, jsonb) is
  'Grava cabeçalho + autorizações numa transação. Mesmo sha256 = devolve a importação existente com duplicado=true. Só service_role executa.';

-- ===== Acesso =====

alter table public.laudos_senhas_importacoes enable row level security;
alter table public.laudos_senhas_importacoes force row level security;
alter table public.laudos_senhas_autorizacoes enable row level security;
alter table public.laudos_senhas_autorizacoes force row level security;

revoke all on public.laudos_senhas_importacoes from public, anon, authenticated;
revoke all on public.laudos_senhas_autorizacoes from public, anon, authenticated;
grant select, insert, update, delete on public.laudos_senhas_importacoes to service_role;
grant select, insert, update, delete on public.laudos_senhas_autorizacoes to service_role;

revoke all on function public.laudos_senhas_importar(text, text, integer, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.laudos_senhas_importar(text, text, integer, uuid, text, jsonb)
  to service_role;

revoke all on function public.set_laudos_senhas_importado_em_brasilia() from public, anon, authenticated;
