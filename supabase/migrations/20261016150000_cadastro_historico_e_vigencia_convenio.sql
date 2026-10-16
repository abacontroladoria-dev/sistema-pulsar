-- Histórico pelo BANCO e vigência do convênio (decisão de 16/10/2026).
--
-- Modelo: cada fato mora num lugar só. O agendamento guarda quem/o quê/onde/
-- quando; nome e convênio são lidos do cadastro na hora. "Como era antes" se
-- responde pelo histórico. Para isso o histórico precisa ser completo:
--
--   1. Gatilho de histórico em pacientes e profissionais: TODA alteração de
--      campo, venha da tela, da importação do TiTa ou de RPC, entra em
--      cadastros_auditoria (antes/depois da linha, como a tela já gravava). Até
--      aqui era a tela que gravava, depois de salvar: importação e RPC não
--      entravam, e falha de gravação passava sem ninguém ver.
--      Inativar/reativar continuam registrados pela tela (levam o MOTIVO que a
--      pessoa digitou): mudança só de `ativo`/`data_saida` não duplica aqui.
--
--   2. pacientes_convenio_vigencias: o convênio de cada paciente por período
--      (de/até). Mantida pelo gatilho; responde "qual convênio valia em 12/03"
--      com convenio_do_paciente_em(paciente, data) — remuneração, faturamento e
--      previsão dependem disso. Não é cópia no agendamento: é histórico.
--
--   3. Carga inicial: a vigência atual de todo paciente, e as TROCAS já
--      visíveis na grade (120 dias) reconstruídas — data = primeira sessão no
--      convênio novo — só quando a troca é única (sem ir e voltar) e o
--      convênio novo é o atual do cadastro. O nome bruto da grade fica em
--      convenio_nome_grade (ele pode vir errado); o nome vale o do catálogo.
--      Medido em 16/10/2026: 22 pacientes, todos com troca única.
--
-- Depende de 20261016140000. Idempotente.

set lock_timeout = '5s';

-- ═════════════════════════════════════════════════════════════════════════════
-- A) Histórico de alterações pelo banco
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.sp_cadastro_historico()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Colunas técnicas: mudam sozinhas e não são fato do cadastro.
  c_ignorar constant text[] := array[
    'sincronizado_em', 'nome_normalizado', 'atualizado_em', 'updated_at', 'criado_em',
    'id_usuario', 'nome_usuario_responsavel', 'dados_tita', 'sincronizado_tita_em'
  ];
  -- Situação: a tela registra com o motivo (inativar/reativar).
  c_situacao constant text[] := array['ativo', 'data_saida'];
  v_antes   jsonb := to_jsonb(old) - c_ignorar;
  v_depois  jsonb := to_jsonb(new) - c_ignorar;
  v_campos  text[];
  v_tabela  text := case tg_table_name when 'pacientes' then 'paciente' else 'profissional' end;
  v_id      text := case tg_table_name when 'pacientes' then (to_jsonb(new) ->> 'id_paciente') else (to_jsonb(new) ->> 'id') end;
  v_nome    text;
begin
  if v_antes = v_depois then
    return new;
  end if;
  select array_agg(k order by k) into v_campos
  from jsonb_object_keys(v_depois) k
  where (v_antes -> k) is distinct from (v_depois -> k);
  if v_campos is null or v_campos <@ c_situacao then
    return new;
  end if;

  v_nome := coalesce(
    nullif(current_setting('pulsar.autor', true), ''),
    (select u.nome from public.usuarios u where u.id = auth.uid()),
    'Sistema'
  );

  insert into public.cadastros_auditoria (
    tabela, registro_id, acao, paciente_id, paciente_nome, convenio_nome, alvo_nome,
    antes, depois, resumo, motivo, usuario_id, usuario_nome
  ) values (
    v_tabela, v_id, 'editar',
    case when v_tabela = 'paciente' then (v_id)::bigint end,
    case when v_tabela = 'paciente' then to_jsonb(new) ->> 'nome' end,
    case when v_tabela = 'paciente' then to_jsonb(new) ->> 'convenio_nome' end,
    to_jsonb(new) ->> 'nome',
    v_antes, v_depois,
    'Alterado: ' || array_to_string(v_campos, ', '),
    nullif(current_setting('pulsar.origem_mudanca', true), ''),
    auth.uid(), v_nome
  );
  return new;
end $$;

revoke all on function public.sp_cadastro_historico() from public, anon, authenticated;

drop trigger if exists trg_pacientes_historico on public.pacientes;
create trigger trg_pacientes_historico
  after update on public.pacientes
  for each row execute function public.sp_cadastro_historico();

drop trigger if exists trg_profissionais_historico on public.profissionais;
create trigger trg_profissionais_historico
  after update on public.profissionais
  for each row execute function public.sp_cadastro_historico();

-- ═════════════════════════════════════════════════════════════════════════════
-- B) Vigência do convênio
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.pacientes_convenio_vigencias (
  id                    bigint      generated always as identity primary key,
  paciente_id           bigint      not null references public.pacientes(id_paciente) on delete cascade,
  convenio_catalogo_id  bigint      references public.convenios(id) on delete set null,
  convenio_nome         text        not null,
  -- null = desde o começo do registro.
  vigente_de            date,
  -- null = vale até hoje.
  vigente_ate           date,
  origem                text        not null,
  -- Reconstruída da grade: o nome como estava lá (pode vir errado).
  convenio_nome_grade   text,
  criado_em             timestamptz not null default now(),
  constraint pac_conv_vig_periodo_check check (vigente_ate is null or vigente_de is null or vigente_ate >= vigente_de),
  constraint pac_conv_vig_origem_check check (origem in ('cadastro', 'inicial', 'reconstruido_da_grade'))
);

create unique index if not exists uq_pac_conv_vig_aberta
  on public.pacientes_convenio_vigencias (paciente_id) where vigente_ate is null;
create index if not exists idx_pac_conv_vig_paciente
  on public.pacientes_convenio_vigencias (paciente_id, vigente_de);

comment on table public.pacientes_convenio_vigencias is
  'Convênio do paciente por período. Mantida pelo gatilho de pacientes (troca de convênio fecha a vigência na véspera e abre outra hoje). Use convenio_do_paciente_em(paciente, data).';

create or replace function public.sp_pacientes_convenio_vigencia()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := public.hoje_brasilia();
begin
  if tg_op = 'UPDATE'
     and new.convenio_nome is not distinct from old.convenio_nome
     and new.convenio_catalogo_id is not distinct from old.convenio_catalogo_id then
    return new;
  end if;

  -- Correção no mesmo dia: ajusta a vigência aberta hoje em vez de criar outra.
  if exists (select 1 from public.pacientes_convenio_vigencias
              where paciente_id = new.id_paciente and vigente_ate is null and vigente_de = v_hoje) then
    if new.convenio_nome is null then
      delete from public.pacientes_convenio_vigencias
       where paciente_id = new.id_paciente and vigente_ate is null and vigente_de = v_hoje;
    else
      update public.pacientes_convenio_vigencias
         set convenio_catalogo_id = new.convenio_catalogo_id, convenio_nome = new.convenio_nome, origem = 'cadastro'
       where paciente_id = new.id_paciente and vigente_ate is null and vigente_de = v_hoje;
    end if;
    return new;
  end if;

  update public.pacientes_convenio_vigencias
     set vigente_ate = v_hoje - 1
   where paciente_id = new.id_paciente and vigente_ate is null;

  if new.convenio_nome is not null then
    insert into public.pacientes_convenio_vigencias (paciente_id, convenio_catalogo_id, convenio_nome, vigente_de, origem)
    values (new.id_paciente, new.convenio_catalogo_id, new.convenio_nome,
            case when tg_op = 'INSERT' then null else v_hoje end, 'cadastro');
  end if;
  return new;
end $$;

revoke all on function public.sp_pacientes_convenio_vigencia() from public, anon, authenticated;

drop trigger if exists trg_pacientes_convenio_vigencia on public.pacientes;
create trigger trg_pacientes_convenio_vigencia
  after insert or update of convenio_nome, convenio_catalogo_id on public.pacientes
  for each row execute function public.sp_pacientes_convenio_vigencia();

-- Convênio que valia numa data.
create or replace function public.convenio_do_paciente_em(p_paciente_id bigint, p_data date)
returns table (convenio_catalogo_id bigint, convenio_nome text)
language sql
stable
security definer
set search_path = ''
as $$
  select v.convenio_catalogo_id, v.convenio_nome
  from public.pacientes_convenio_vigencias v
  where v.paciente_id = p_paciente_id
    and (v.vigente_de is null or v.vigente_de <= p_data)
    and (v.vigente_ate is null or v.vigente_ate >= p_data)
  order by v.vigente_de desc nulls last
  limit 1
$$;

comment on function public.convenio_do_paciente_em(bigint, date) is
  'Convênio do paciente numa data, pela vigência (histórico). Para remuneração, faturamento e previsão.';

revoke all on function public.convenio_do_paciente_em(bigint, date) from public, anon;
grant execute on function public.convenio_do_paciente_em(bigint, date) to authenticated, service_role;

alter table public.pacientes_convenio_vigencias enable row level security;
drop policy if exists "pac_conv_vig_select" on public.pacientes_convenio_vigencias;
create policy "pac_conv_vig_select" on public.pacientes_convenio_vigencias
  for select to authenticated using ((select public.usuario_tem_permissao('cadastros_pacientes')));
revoke all on public.pacientes_convenio_vigencias from public, anon, authenticated;
grant select on public.pacientes_convenio_vigencias to authenticated;
grant select on public.pacientes_convenio_vigencias to service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- C) Carga inicial (só para quem ainda não tem vigência)
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare
  n_trocas  integer := 0;
  n_inicial integer := 0;
begin
  -- Trocas visíveis na grade: exatamente 2 convênios em 120 dias, o antigo
  -- termina antes de o novo começar, e o novo é o convênio atual do cadastro.
  create temporary table tmp_trocas on commit drop as
  with s as (
    select pa.id_paciente, g.data, public.sp_normalizar_convenio(g.convenio_nome) as n, btrim(g.convenio_nome) as bruto
    from public.csv_grades_profissionais g
    join public.pacientes pa on pa.tita_paciente_id = g.paciente_id
    where g.ativo and g.status_agendamento = 'Agendado' and g.unidade_id = 280
      and g.data between public.hoje_brasilia() - 120 and public.hoje_brasilia()
      and public.sp_normalizar_convenio(g.convenio_nome) is not null
      and not exists (select 1 from public.pacientes_convenio_vigencias v where v.paciente_id = pa.id_paciente)
  ),
  por as (
    select s.id_paciente, s.n, min(s.data) as primeira, max(s.data) as ultima, (array_agg(s.bruto order by s.data desc))[1] as bruto
    from s group by s.id_paciente, s.n
  ),
  dois as (
    select id_paciente from por group by id_paciente having count(*) = 2
  )
  select a.id_paciente, a.n as antigo_n, a.bruto as antigo_bruto, b.n as novo_n, b.primeira as novo_desde
  from por a
  join por b on b.id_paciente = a.id_paciente and b.n <> a.n and a.ultima < b.primeira
  join dois d on d.id_paciente = a.id_paciente
  join public.pacientes p on p.id_paciente = a.id_paciente
  where public.sp_normalizar_convenio(p.convenio_nome) = b.n;

  insert into public.pacientes_convenio_vigencias
    (paciente_id, convenio_catalogo_id, convenio_nome, vigente_de, vigente_ate, origem, convenio_nome_grade)
  select t.id_paciente, cv.id, coalesce(cv.nome, t.antigo_bruto), null, t.novo_desde - 1, 'reconstruido_da_grade', t.antigo_bruto
  from tmp_trocas t
  left join lateral (
    select c.id, c.nome from public.convenios c where public.sp_normalizar_convenio(c.nome) = t.antigo_n order by c.id limit 1
  ) cv on true;

  insert into public.pacientes_convenio_vigencias
    (paciente_id, convenio_catalogo_id, convenio_nome, vigente_de, vigente_ate, origem)
  select p.id_paciente, p.convenio_catalogo_id, p.convenio_nome, t.novo_desde, null, 'reconstruido_da_grade'
  from tmp_trocas t
  join public.pacientes p on p.id_paciente = t.id_paciente;
  get diagnostics n_trocas = row_count;

  insert into public.pacientes_convenio_vigencias (paciente_id, convenio_catalogo_id, convenio_nome, vigente_de, vigente_ate, origem)
  select p.id_paciente, p.convenio_catalogo_id, p.convenio_nome, null, null, 'inicial'
  from public.pacientes p
  where p.convenio_nome is not null
    and public.sp_normalizar_convenio(p.convenio_nome) <> 'ainda nao selecionado'
    and not exists (select 1 from public.pacientes_convenio_vigencias v where v.paciente_id = p.id_paciente);
  get diagnostics n_inicial = row_count;

  raise notice 'Vigências: % troca(s) reconstruída(s) da grade, % paciente(s) com a vigência atual.', n_trocas, n_inicial;
end $$;
