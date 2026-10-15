-- =============================================================================
-- Painel de Entrada de Pacientes de Convênio — prazos das etapas 0 a 7
-- =============================================================================
-- Até aqui os prazos viviam só no calc.py da tarefa da Carol (fluxo v4,
-- 09/10/2026). Esta migration põe os prazos VIGENTES no Pulsar, editáveis só por
-- Direção (role 'diretoria') e Admin (role 'admin'), com histórico completo.
--
-- O calc continua gravando o painel com os prazos dele; a rota
-- /api/indicadores/entrada-convenio reaplica os prazos daqui sobre os `dias`
-- de cada etapa (lib/indicadores/entradaConvenio.ts, aplicarPrazos): régua do
-- fluxo, meta ponta a ponta e quem está dentro ou fora do prazo mudam na hora.
--
-- Escrita: só pela RPC painel_entrada_convenio_alterar_prazo, chamada pela rota
-- com service_role depois de conferir o papel. A RPC confere o papel de novo
-- (segunda tranca), lê nome/e-mail/papel do banco e grava prazo + histórico na
-- mesma transação. O histórico não aceita UPDATE nem DELETE.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Prazos vigentes (uma linha por etapa)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.painel_entrada_convenio_prazos (
  etapa          text primary key check (etapa ~ '^E[0-7]$'),
  nome           text not null,
  prazo          integer not null check (prazo between 0 and 60),
  -- Valor do calc.py (fluxo v4): o "Voltar ao padrão" da tela.
  prazo_padrao   integer not null check (prazo_padrao between 0 and 60),
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid
);

insert into public.painel_entrada_convenio_prazos (etapa, nome, prazo, prazo_padrao) values
  ('E0', 'Abrir formulário',         0, 0),
  ('E1', 'Elegibilidade',            1, 1),
  ('E2', 'Agendar entrevista',       1, 1),
  ('E3', 'Entrevista / avaliação',   5, 5),
  ('E4', 'Montar cronograma',        5, 5),
  ('E5', 'Apresentar e aprovar',     1, 1),
  ('E6', 'Autorização da operadora', 1, 1),
  ('E7', 'Iniciar atendimento',      5, 5)
on conflict (etapa) do nothing;

comment on table public.painel_entrada_convenio_prazos is
  'Prazo vigente (dias úteis) de cada etapa do Painel de Entrada. Altera só pela RPC painel_entrada_convenio_alterar_prazo (Direção e Admin).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Histórico (só cresce)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.painel_entrada_convenio_prazos_historico (
  id                   bigint generated always as identity primary key,
  etapa                text not null,
  etapa_nome           text not null,
  prazo_anterior       integer not null,
  prazo_novo           integer not null,
  prazo_padrao         integer not null,
  meta_anterior        integer not null,
  meta_nova            integer not null,
  motivo               text not null check (char_length(btrim(motivo)) between 10 and 1000),
  -- Snapshot de quem alterou: um join em usuarios não sobrevive a troca de nome
  -- ou desativação, e o histórico precisa ser legível meses depois.
  usuario_id           uuid not null,
  usuario_nome         text,
  usuario_email        text,
  usuario_role         text not null,
  alterado_em          timestamptz not null default now(),
  alterado_em_brasilia text not null,
  -- "Elegibilidade (Etapa 1): 1 → 2 dias úteis · meta 19 → 20 dias úteis"
  resumo               text not null,
  -- Efeito no momento da alteração, calculado pela rota sobre a última rodada:
  -- contagens antes/depois, % no prazo da etapa antes/depois, mediana, e quais
  -- pacientes mudaram de situação.
  impacto              jsonb not null default '{}'::jsonb,
  -- Os 8 prazos depois da alteração: reconstrói a régua de qualquer momento.
  prazos_vigentes      jsonb not null
);

create index if not exists idx_painel_entrada_convenio_prazos_historico_alterado_em
  on public.painel_entrada_convenio_prazos_historico (alterado_em desc);

comment on table public.painel_entrada_convenio_prazos_historico is
  'Toda alteração de prazo do Painel de Entrada: antes/depois, meta, motivo, autor (snapshot), impacto e os prazos vigentes. Não aceita UPDATE nem DELETE.';

create or replace function public.painel_entrada_convenio_prazos_historico_imutavel()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'o histórico de prazos do Painel de Entrada não pode ser alterado nem apagado'
    using errcode = '42501';
end;
$$;

drop trigger if exists trg_painel_entrada_convenio_prazos_historico_imutavel
  on public.painel_entrada_convenio_prazos_historico;
create trigger trg_painel_entrada_convenio_prazos_historico_imutavel
  before update or delete on public.painel_entrada_convenio_prazos_historico
  for each row execute function public.painel_entrada_convenio_prazos_historico_imutavel();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Alterar um prazo (rota, service_role)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.painel_entrada_convenio_alterar_prazo(
  p_etapa      text,
  p_prazo      integer,
  p_motivo     text,
  p_usuario_id uuid,
  p_impacto    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _u         public.usuarios%rowtype;
  _linha     public.painel_entrada_convenio_prazos%rowtype;
  _motivo    text := btrim(coalesce(p_motivo, ''));
  _agora     timestamptz := now();
  _meta_ant  integer;
  _meta_nova integer;
  _vigentes  jsonb;
  _resumo    text;
  _id        bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'só a rota do painel altera prazos' using errcode = '42501';
  end if;

  -- Segunda tranca: a rota já conferiu, mas o papel vem do banco, não do cliente.
  select * into _u from public.usuarios where id = p_usuario_id;
  if _u.id is null or not coalesce(_u.ativo, false) or coalesce(_u.role, '') not in ('admin', 'diretoria') then
    raise exception 'só Direção e Admin alteram prazos' using errcode = '42501';
  end if;

  if p_prazo is null or p_prazo < 0 or p_prazo > 60 then
    raise exception 'o prazo precisa ficar entre 0 e 60 dias úteis' using errcode = '22023';
  end if;
  if char_length(_motivo) < 10 then
    raise exception 'escreva o motivo da alteração (mínimo de 10 caracteres)' using errcode = '22023';
  end if;
  if char_length(_motivo) > 1000 then
    raise exception 'o motivo passou de 1000 caracteres' using errcode = '22023';
  end if;

  select * into _linha
    from public.painel_entrada_convenio_prazos
   where etapa = p_etapa
     for update;
  if _linha.etapa is null then
    raise exception 'etapa desconhecida: %', p_etapa using errcode = '22023';
  end if;
  if _linha.prazo = p_prazo then
    raise exception 'o prazo desta etapa já é % dias úteis', p_prazo using errcode = '22023';
  end if;

  select sum(prazo)::int into _meta_ant from public.painel_entrada_convenio_prazos;
  _meta_nova := _meta_ant - _linha.prazo + p_prazo;

  update public.painel_entrada_convenio_prazos
     set prazo = p_prazo, atualizado_em = _agora, atualizado_por = p_usuario_id
   where etapa = p_etapa;

  select jsonb_object_agg(etapa, prazo order by etapa) into _vigentes
    from public.painel_entrada_convenio_prazos;

  _resumo := format('%s (Etapa %s): %s → %s %s · meta %s → %s dias úteis',
    _linha.nome, substr(p_etapa, 2), _linha.prazo, p_prazo,
    case when p_prazo = 1 then 'dia útil' else 'dias úteis' end,
    _meta_ant, _meta_nova);

  insert into public.painel_entrada_convenio_prazos_historico (
    etapa, etapa_nome, prazo_anterior, prazo_novo, prazo_padrao, meta_anterior, meta_nova,
    motivo, usuario_id, usuario_nome, usuario_email, usuario_role,
    alterado_em, alterado_em_brasilia, resumo, impacto, prazos_vigentes
  ) values (
    p_etapa, _linha.nome, _linha.prazo, p_prazo, _linha.prazo_padrao, _meta_ant, _meta_nova,
    _motivo, _u.id, _u.nome, _u.email, _u.role,
    _agora, to_char(_agora at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI:SS'),
    _resumo,
    case when jsonb_typeof(p_impacto) = 'object' then p_impacto else '{}'::jsonb end,
    _vigentes
  )
  returning id into _id;

  return jsonb_build_object('id', _id, 'resumo', _resumo, 'meta', _meta_nova);
end;
$$;

comment on function public.painel_entrada_convenio_alterar_prazo(text, integer, text, uuid, jsonb) is
  'Altera o prazo de uma etapa e grava o histórico na mesma transação. Só service_role; o usuário precisa ser admin ou diretoria ativo.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Leitura: vigentes + histórico completo
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.painel_entrada_convenio_prazos()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.usuario_tem_permissao('indicadores_entrada_convenio') then
    raise exception 'sem permissão para o Painel de Entrada de Pacientes'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'vigentes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'etapa', p.etapa, 'nome', p.nome, 'prazo', p.prazo,
               'prazo_padrao', p.prazo_padrao, 'atualizado_em', p.atualizado_em)
             order by p.etapa)
        from public.painel_entrada_convenio_prazos p), '[]'::jsonb),
    'historico', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.alterado_em desc, h.id desc)
        from public.painel_entrada_convenio_prazos_historico h), '[]'::jsonb));
end;
$$;

comment on function public.painel_entrada_convenio_prazos() is
  'Prazos vigentes e histórico completo do Painel de Entrada. Só service_role (a rota confere indicadores_entrada_convenio).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS e grants
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.painel_entrada_convenio_prazos           enable row level security;
alter table public.painel_entrada_convenio_prazos_historico enable row level security;

revoke all on public.painel_entrada_convenio_prazos           from public, anon, authenticated;
revoke all on public.painel_entrada_convenio_prazos_historico from public, anon, authenticated;
revoke all on public.painel_entrada_convenio_prazos           from service_role;
revoke all on public.painel_entrada_convenio_prazos_historico from service_role;
grant select on public.painel_entrada_convenio_prazos           to service_role;
grant select on public.painel_entrada_convenio_prazos_historico to service_role;

revoke all on function public.painel_entrada_convenio_prazos_historico_imutavel()               from public, anon, authenticated;
revoke all on function public.painel_entrada_convenio_alterar_prazo(text, integer, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.painel_entrada_convenio_prazos()                                  from public, anon, authenticated;

grant execute on function public.painel_entrada_convenio_alterar_prazo(text, integer, text, uuid, jsonb) to service_role;
grant execute on function public.painel_entrada_convenio_prazos()                                  to service_role;
