-- =============================================================================
-- Painel de Entrada de Pacientes de Convênio (Leve, ASSIM, FUSEx)
-- =============================================================================
-- Aba /cronograma/indicadores?tab=entrada-convenio, código de permissão
-- indicadores_entrada_convenio (catálogo em 20261013095600).
--
-- Quem calcula NÃO é o Pulsar. A tarefa agendada do claude.ai na conta da Carol
-- lê o ClickUp (3 listas, comentários e o chat de autorização) às 7h40 e 12h40,
-- roda o calc.py do pacote de implantação e grava o resultado ("painel.json")
-- numa página de Doc fixa do ClickUp. A Edge Function painel-entrada-convenio
-- copia essa página para cá logo depois, com um token próprio
-- (CLICKUP_TOKEN_PAINEL, conta adm2), só com GET.
--
-- Por que copiar em vez de ler o ClickUp ao vivo da tela: o Doc é a única fonte
-- que já vem calculada (com a leitura de comentários e chat), e a cópia mantém o
-- histórico diário para o gráfico de medianas que o Handoff sugere (seção 8).
--
-- Contrato com a tarefa da Carol: o JSON é o "dados" do painel.json, versao_fluxo
-- 4. Campo novo ou renomeado precisa ser combinado antes — a Edge Function recusa
-- um JSON fora da forma e o painel fica com a rodada anterior (alerta aberto).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Config (linha única): onde está o Doc
-- ─────────────────────────────────────────────────────────────────────────────
-- IDs em tabela, não em secret: não são segredo, e trocar de página não pode
-- exigir redeploy. Preenchidos pelo snippet
-- supabase/snippets/20261013_painel_entrada_convenio_config.sql.
create table if not exists public.painel_entrada_convenio_config (
  id            smallint primary key default 1 check (id = 1),
  workspace_id  text not null default '9011600909',
  doc_id        text,
  page_id       text,
  ativo         boolean not null default true,
  atualizado_em timestamptz not null default now()
);

insert into public.painel_entrada_convenio_config (id) values (1)
on conflict (id) do nothing;

comment on table public.painel_entrada_convenio_config is
  'Página de Doc do ClickUp onde a tarefa da Carol grava o painel.json. Linha única (id=1).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Snapshots e leituras
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.painel_entrada_convenio_snapshots (
  id            bigint generated always as identity primary key,
  -- Data da rodada do calc.py (só data: o calc não grava hora).
  gerado_em     date not null,
  versao_fluxo  integer not null,
  -- Última edição da página no ClickUp = hora em que a tarefa da Carol gravou.
  publicado_em  timestamptz,
  lido_em       timestamptz not null default now(),
  -- md5 do jsonb: a mesma rodada lida duas vezes não vira duas linhas.
  hash          text not null unique,
  dados         jsonb not null
);

create index if not exists idx_painel_entrada_convenio_snapshots_lido_em
  on public.painel_entrada_convenio_snapshots (lido_em desc);

comment on table public.painel_entrada_convenio_snapshots is
  'Cópias do painel.json (chave "dados") publicadas pela tarefa da Carol. Uma linha por conteúdo distinto.';

create table if not exists public.painel_entrada_convenio_leituras (
  id          bigint generated always as identity primary key,
  lido_em     timestamptz not null default now(),
  origem      text not null check (origem in ('cron', 'manual')),
  status      text not null check (status in ('novo', 'sem_mudanca', 'erro', 'ignorado')),
  snapshot_id bigint references public.painel_entrada_convenio_snapshots(id) on delete set null,
  erro        text
);

create index if not exists idx_painel_entrada_convenio_leituras_lido_em
  on public.painel_entrada_convenio_leituras (lido_em desc);

comment on table public.painel_entrada_convenio_leituras is
  'Cada tentativa de copiar o Doc, com o motivo quando falha. É o que a tela mostra como "última leitura".';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Regras na Central de Alertas
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.alertas_regras
  (codigo, modulo, nome, setor_destino, prioridade, tolerancia_minutos)
values
  ('painel_entrada_convenio_falhou', 'sync',
   'Painel de Entrada de Pacientes: leitura do ClickUp falhou', 'admin', 'alta', 0),
  ('painel_entrada_convenio_desatualizado', 'sync',
   'Painel de Entrada de Pacientes: sem dado novo há mais de 1 dia útil', 'admin', 'media', 0)
on conflict (codigo) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Dias úteis desde a rodada
-- ─────────────────────────────────────────────────────────────────────────────
-- Seg-sex menos os feriados INTEGRAIS de public.feriados (parcial ainda é dia de
-- trabalho). Mesma régua do calc.py, que usa os feriados do RJ.
create or replace function public.painel_entrada_convenio_dias_uteis_atras(p_data date)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int
    from generate_series(p_data + 1, (now() at time zone 'America/Sao_Paulo')::date, interval '1 day') g(d)
   where extract(isodow from g.d) < 6
     and not exists (
       select 1 from public.feriados f
        where f.data = g.d::date and f.tipo = 'integral'
     );
$$;

comment on function public.painel_entrada_convenio_dias_uteis_atras(date) is
  'Dias úteis (seg-sex sem feriado integral) entre a data e hoje em São Paulo. 0 = hoje ou futuro.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Alertas (abrir / resolver)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.painel_entrada_convenio_abrir_alerta(p_regra text, p_titulo text, p_descricao text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _hoje text := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD');
begin
  -- Fingerprint por dia: o índice único parcial de alertas (só os abertos) faz
  -- a segunda falha do mesmo dia cair no "do nothing".
  with novo as (
    insert into public.alertas (
      modulo, regra_codigo, origem, entidade_tipo, entidade_id, entidade_ref,
      titulo, descricao, prioridade, status, setor_destino, fingerprint
    )
    select 'sync', r.codigo, 'sistema', 'painel_entrada_convenio', _hoje,
           jsonb_build_object('descricao', p_descricao),
           p_titulo, p_descricao, r.prioridade, 'aberto', 'admin',
           concat_ws('|', p_regra, _hoje)
      from public.alertas_regras r
     where r.codigo = p_regra
    on conflict do nothing
    returning id
  )
  insert into public.alertas_eventos (
    alerta_id, entidade_tipo, entidade_id, tipo, autor_tipo, autor_nome, descricao
  )
  select novo.id, 'painel_entrada_convenio', _hoje, 'deteccao', 'sistema', 'Sistema', p_descricao
    from novo;
end;
$$;

create or replace function public.painel_entrada_convenio_resolver_alerta(p_regra text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.alertas
     set status = 'resolvido', resolucao = 'automatico', resolvido_em = now(), atualizado_em = now()
   where regra_codigo = p_regra
     and status <> 'resolvido';
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Registrar uma leitura (chamada pela Edge Function, service_role)
-- ─────────────────────────────────────────────────────────────────────────────
-- A validação completa da forma fica na Edge Function (TypeScript); aqui só o
-- mínimo para nada torto chegar à tabela mesmo que alguém chame a RPC direto.
create or replace function public.painel_entrada_convenio_registrar(
  p_origem       text,
  p_dados        jsonb,
  p_publicado_em timestamptz,
  p_erro         text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _origem   text := case when p_origem = 'manual' then 'manual' else 'cron' end;
  _erro     text := p_erro;
  _hash     text;
  _snap_id  bigint;
  _status   text;
  _ultimo   date;
  _atras    integer;
begin
  if _erro is null then
    if p_dados is null
       or jsonb_typeof(p_dados) <> 'object'
       or coalesce(p_dados->>'gerado_em', '') !~ '^\d{4}-\d{2}-\d{2}$'
       or jsonb_typeof(p_dados->'pacientes') is distinct from 'array'
       or jsonb_typeof(p_dados->'etapas') is distinct from 'array'
       or jsonb_typeof(p_dados->'resumo') is distinct from 'object' then
      _erro := 'JSON fora da forma do painel.json (gerado_em, resumo, etapas, pacientes)';
    end if;
  end if;

  if _erro is not null then
    insert into public.painel_entrada_convenio_leituras (origem, status, erro)
    values (_origem, 'erro', left(_erro, 2000));
    perform public.painel_entrada_convenio_abrir_alerta(
      'painel_entrada_convenio_falhou',
      'Painel de Entrada de Pacientes não foi atualizado',
      concat('A leitura do Doc do ClickUp falhou: ', left(_erro, 500),
             '. O painel continua mostrando a rodada anterior.'));
    return jsonb_build_object('status', 'erro', 'erro', _erro);
  end if;

  _hash := md5(p_dados::text);

  insert into public.painel_entrada_convenio_snapshots (gerado_em, versao_fluxo, publicado_em, hash, dados)
  values ((p_dados->>'gerado_em')::date,
          coalesce((p_dados->>'versao_fluxo')::int, 0),
          p_publicado_em, _hash, p_dados)
  on conflict (hash) do nothing
  returning id into _snap_id;

  if _snap_id is null then
    _status := 'sem_mudanca';
    select id into _snap_id from public.painel_entrada_convenio_snapshots where hash = _hash;
  else
    _status := 'novo';
  end if;

  insert into public.painel_entrada_convenio_leituras (origem, status, snapshot_id)
  values (_origem, _status, _snap_id);

  perform public.painel_entrada_convenio_resolver_alerta('painel_entrada_convenio_falhou');

  -- Leitura funcionou, mas a tarefa da Carol pode ter parado de gravar.
  select max(gerado_em) into _ultimo from public.painel_entrada_convenio_snapshots;
  _atras := public.painel_entrada_convenio_dias_uteis_atras(_ultimo);
  if _atras > 1 then
    perform public.painel_entrada_convenio_abrir_alerta(
      'painel_entrada_convenio_desatualizado',
      'Painel de Entrada de Pacientes sem dado novo',
      concat('A última rodada gravada no Doc é de ', to_char(_ultimo, 'DD/MM/YYYY'),
             ' (', _atras, ' dias úteis). A tarefa agendada da Carol pode ter parado.'));
  else
    perform public.painel_entrada_convenio_resolver_alerta('painel_entrada_convenio_desatualizado');
  end if;

  return jsonb_build_object('status', _status, 'snapshot_id', _snap_id, 'dias_uteis_atras', _atras);
end;
$$;

comment on function public.painel_entrada_convenio_registrar(text, jsonb, timestamptz, text) is
  'Grava uma leitura do Doc (snapshot novo só se o conteúdo mudou) e abre/resolve os alertas. Só service_role.';

-- Leitura pulada (Doc ainda não configurado, chave desligada): registra para a
-- tela não mostrar "nunca leu" sem motivo.
create or replace function public.painel_entrada_convenio_registrar_ignorado(p_origem text, p_motivo text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.painel_entrada_convenio_leituras (origem, status, erro)
  values (case when p_origem = 'manual' then 'manual' else 'cron' end, 'ignorado', left(p_motivo, 2000));
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Leitura da tela
-- ─────────────────────────────────────────────────────────────────────────────
-- Devolve a última rodada + frescor + o selo de disponibilidade de cada
-- paciente. O selo casa o nome do JSON com o cadastro pelo MESMO normalizador do
-- cadastro (normalizar_nome_paciente) — por isso o nome completo é obrigatório
-- nas tasks do ClickUp.
--
-- Estados do selo (o formulário público só acha paciente ATIVO pelo CPF —
-- lib/disponibilidadePaciente.server.ts, pacientesPorCpf):
--   sem_cadastro       nenhum paciente ativo com esse nome: a família ainda não
--                      consegue usar o link
--   nome_ambiguo       mais de um paciente ativo com esse nome
--   sem_cpf            cadastrado, mas sem CPF válido: o link não acha a criança
--   nao_preenchida     link utilizável, nada enviado ainda
--   preenchida_familia última versão veio do formulário
--   preenchida_equipe  última versão lançada pela equipe ou importada
-- Só o estado e a data saem daqui; os horários continuam atrás de
-- cadastros_pacientes.
--
-- Quem chama é a rota /api/indicadores/entrada-convenio (service_role), que
-- confere indicadores_entrada_convenio antes — mesmo desenho de
-- /api/status-contratos, e o que deixa o localhost sem login (DISABLE_AUTH)
-- abrir a tela. A checagem abaixo é a segunda tranca, para o caso de alguém um
-- dia liberar a função para authenticated.
create or replace function public.painel_entrada_convenio_atual()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  _snap    public.painel_entrada_convenio_snapshots%rowtype;
  _leitura public.painel_entrada_convenio_leituras%rowtype;
  _disp    jsonb := '[]'::jsonb;
  _atras   integer;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.usuario_tem_permissao('indicadores_entrada_convenio') then
    raise exception 'sem permissão para o Painel de Entrada de Pacientes'
      using errcode = '42501';
  end if;

  select * into _leitura
    from public.painel_entrada_convenio_leituras
   order by lido_em desc, id desc
   limit 1;

  select * into _snap
    from public.painel_entrada_convenio_snapshots
   order by gerado_em desc, lido_em desc, id desc
   limit 1;

  if _snap.id is null then
    return jsonb_build_object(
      'snapshot', null,
      'ultima_leitura', case when _leitura.id is null then null else jsonb_build_object(
        'lido_em', _leitura.lido_em, 'status', _leitura.status, 'erro', _leitura.erro) end,
      'disponibilidade', '[]'::jsonb);
  end if;

  _atras := public.painel_entrada_convenio_dias_uteis_atras(_snap.gerado_em);

  with nomes as (
    select distinct p->>'paciente' as nome
      from jsonb_array_elements(_snap.dados->'pacientes') p
     where coalesce(p->>'paciente', '') <> ''
       and coalesce(p->>'situacao', '') <> 'encerrado'
  ),
  casados as (
    select n.nome,
           array_agg(pa.id_paciente order by pa.id_paciente) filter (where pa.id_paciente is not null) as ids
      from nomes n
      left join public.pacientes pa
        on pa.nome_normalizado = public.normalizar_nome_paciente(n.nome)
       and pa.ativo
       and not pa.ficticio
     group by n.nome
  ),
  unico as (
    select c.nome, c.ids, c.ids[1] as id
      from casados c
  ),
  ultima as (
    select distinct on (v.paciente_id) v.paciente_id, v.origem, v.criado_em
      from public.pacientes_disponibilidade_versoes v
     where v.paciente_id in (select u.id from unico u where cardinality(u.ids) = 1)
     order by v.paciente_id, v.numero_versao desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'nome', u.nome,
           'paciente_id', case when cardinality(u.ids) = 1 then u.id end,
           'estado', case
              when u.ids is null or cardinality(u.ids) = 0 then 'sem_cadastro'
              when cardinality(u.ids) > 1 then 'nome_ambiguo'
              when ul.paciente_id is not null and ul.origem = 'formulario' then 'preenchida_familia'
              when ul.paciente_id is not null then 'preenchida_equipe'
              when length(regexp_replace(coalesce(pa.cpf, ''), '\D', '', 'g')) <> 11 then 'sem_cpf'
              else 'nao_preenchida'
            end,
           'preenchida_em', ul.criado_em)), '[]'::jsonb)
    into _disp
    from unico u
    left join public.pacientes pa on pa.id_paciente = u.id and cardinality(u.ids) = 1
    left join ultima ul on ul.paciente_id = u.id and cardinality(u.ids) = 1;

  return jsonb_build_object(
    'snapshot', jsonb_build_object(
      'id', _snap.id,
      'gerado_em', _snap.gerado_em,
      'publicado_em', _snap.publicado_em,
      'lido_em', _snap.lido_em,
      'versao_fluxo', _snap.versao_fluxo,
      'dados', _snap.dados),
    'dias_uteis_atras', _atras,
    'desatualizado', _atras > 1,
    'ultima_leitura', case when _leitura.id is null then null else jsonb_build_object(
      'lido_em', _leitura.lido_em, 'status', _leitura.status, 'erro', _leitura.erro) end,
    'disponibilidade', _disp);
end;
$$;

comment on function public.painel_entrada_convenio_atual() is
  'Tela do Painel de Entrada de Pacientes: última rodada, frescor e selo de disponibilidade. Só service_role (a rota confere indicadores_entrada_convenio).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. RLS e grants
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.painel_entrada_convenio_config    enable row level security;
alter table public.painel_entrada_convenio_snapshots enable row level security;
alter table public.painel_entrada_convenio_leituras  enable row level security;

do $$
declare pol record;
begin
  for pol in
    select policyname, tablename from pg_policies
     where schemaname = 'public'
       and tablename in ('painel_entrada_convenio_config',
                         'painel_entrada_convenio_snapshots',
                         'painel_entrada_convenio_leituras')
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- A tela lê pela RPC; a policy existe para o histórico (gráfico futuro) poder
-- ser lido direto sem abrir para quem não tem a aba.
create policy "painel_entrada_convenio_snapshots_select" on public.painel_entrada_convenio_snapshots
  for select to authenticated
  using (public.usuario_tem_permissao('indicadores_entrada_convenio'));

revoke all on public.painel_entrada_convenio_config    from public, anon, authenticated;
revoke all on public.painel_entrada_convenio_snapshots from public, anon, authenticated;
revoke all on public.painel_entrada_convenio_leituras  from public, anon, authenticated;

grant select on public.painel_entrada_convenio_snapshots to authenticated;

grant select, update                 on public.painel_entrada_convenio_config    to service_role;
grant select, insert                 on public.painel_entrada_convenio_snapshots to service_role;
grant select, insert                 on public.painel_entrada_convenio_leituras  to service_role;

-- Funções nascem com EXECUTE para PUBLIC (e anon é PUBLIC): o revoke é o que
-- fecha /rest/v1/rpc.
revoke all on function public.painel_entrada_convenio_dias_uteis_atras(date)                      from public, anon, authenticated;
revoke all on function public.painel_entrada_convenio_abrir_alerta(text, text, text)              from public, anon, authenticated;
revoke all on function public.painel_entrada_convenio_resolver_alerta(text)                       from public, anon, authenticated;
revoke all on function public.painel_entrada_convenio_registrar(text, jsonb, timestamptz, text)   from public, anon, authenticated;
revoke all on function public.painel_entrada_convenio_registrar_ignorado(text, text)              from public, anon, authenticated;
revoke all on function public.painel_entrada_convenio_atual()                                     from public, anon, authenticated;

grant execute on function public.painel_entrada_convenio_registrar(text, jsonb, timestamptz, text) to service_role;
grant execute on function public.painel_entrada_convenio_registrar_ignorado(text, text)            to service_role;
grant execute on function public.painel_entrada_convenio_atual()                                   to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Disparo e agendamento
-- ─────────────────────────────────────────────────────────────────────────────
-- Fire-and-forget: net.http_post só enfileira, a função não espera a resposta
-- (esperar já estourou o statement_timeout no sync-grade-csv, 20261001130001).
-- O guard de segredo ausente é o de 20260902120000: sem ele, 'Bearer ' || NULL
-- vira header nulo, a Edge Function responde 401 e o pg_cron marca SUCESSO.
create or replace function public.fn_painel_entrada_convenio_disparar()
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  _url   text := 'https://wmugemamnqxjfpxrlwes.supabase.co/functions/v1/painel-entrada-convenio';
  _token text;
begin
  select decrypted_secret into _token
    from vault.decrypted_secrets where name = 'cron_service_role_key';
  if _token is null then
    raise exception 'fn_painel_entrada_convenio_disparar: segredo cron_service_role_key ausente no Vault';
  end if;

  perform net.http_post(
    url     := _url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || _token,
      'Content-Type',  'application/json'
    ),
    body                 := '{"origem":"cron"}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

comment on function public.fn_painel_entrada_convenio_disparar() is
  'Invoca a Edge Function painel-entrada-convenio com a chave do Vault. Agendada em painel-entrada-convenio e painel-entrada-convenio-repique.';

revoke all on function public.fn_painel_entrada_convenio_disparar() from public, anon, authenticated;

-- Cron do Supabase roda em UTC; São Paulo é UTC-3 fixo.
--   painel-entrada-convenio          10:55 e 15:55 UTC = 7h55 e 12h55, 15 min
--                                    depois de cada rodada da Carol
--   painel-entrada-convenio-repique  11:25 e 16:25 UTC = 8h25 e 13h25: a rodada
--                                    dela (Opus, ~30 pacientes com comentários)
--                                    pode passar de 15 min. Conteúdo repetido
--                                    não vira linha nova (hash), então o repique
--                                    custa um GET.
do $cron$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'painel-entrada-convenio') then
      perform cron.unschedule('painel-entrada-convenio');
    end if;
    if exists (select 1 from cron.job where jobname = 'painel-entrada-convenio-repique') then
      perform cron.unschedule('painel-entrada-convenio-repique');
    end if;

    perform cron.schedule('painel-entrada-convenio', '55 10,15 * * 1-5',
      $cmd$select public.fn_painel_entrada_convenio_disparar()$cmd$);
    perform cron.schedule('painel-entrada-convenio-repique', '25 11,16 * * 1-5',
      $cmd$select public.fn_painel_entrada_convenio_disparar()$cmd$);
  end if;
end
$cron$;
