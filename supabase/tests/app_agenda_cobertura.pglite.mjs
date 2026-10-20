// Teste da migration 20261019210000 (Fase 2 do app de evoluções) no PGlite.
// Prova: terapeuta evolui/marca falta só na sessão de que é o profissional
// efetivo, já iniciada, sem registro e sem falta da recepção; só falta do
// paciente; evolução no nome dele; cobertura muda quem atende; app_agenda e
// app_agenda_profissionais por papel; migration reroda.
//
// As RPCs grandes (grade_registrar_evolucao/falta/limpar) entram aqui reduzidas
// ao que importa: chamam sp_grade_exigir_evoluir e gravam como as reais.
//
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   cp <repo>/supabase/tests/app_agenda_cobertura.pglite.mjs /tmp/pg/
//   node /tmp/pg/app_agenda_cobertura.pglite.mjs <repo>/supabase/migrations/20261019210000_app_agenda_cobertura.sql
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'
const db = new PGlite()
let f = 0; const ok = (c, m) => { console.log(c ? '  ok  ' : '  FALHA', m); if (!c) f++ }

const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const S = (n) => `10000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const ADMIN = U(1), DIR = U(2), RECEP = U(3), TA = U(4), TB = U(5), TINATIVO = U(6)

await db.exec(`
create schema auth;
create role anon; create role authenticated; create role service_role bypassrls;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table public.profissionais (id bigint primary key, nome text, ativo boolean default true);
create table public.usuarios (id uuid primary key, nome text, role text, ativo boolean default true, profissional_id bigint);
create table public.pacientes (id_paciente bigint primary key, nome text, tita_paciente_id bigint);
create table public.grade_agendamentos (
  id uuid primary key, serie_id uuid, data date, hora_inicio time, hora_fim time,
  paciente_id bigint, paciente_nome text, profissional_id bigint, profissional_nome text,
  terapia_nome text, terapia_exibicao_nome text, sala_nome text, unidade_nome text,
  situacao text default 'agendado', tita_agendamento_id bigint, tita_paciente_id bigint);
create table public.grade_evolucoes (
  agendamento_id uuid primary key references public.grade_agendamentos(id),
  status_execucao text, justificativa text, tipo_falta text, possui_tratativa boolean default false,
  tratativa_profissional_id bigint, tratativa_profissional_nome text, tratativa_criada_em timestamptz,
  descricao_evolucao text, origem text default 'pulsar');
create table public.grade_eventos (
  id bigint generated always as identity, acao text, agendamento_id uuid, serie_id uuid,
  profissional_id bigint, paciente_id bigint, quantidade int, antes jsonb, depois jsonb,
  resumo text, feito_por uuid, feito_por_nome text,
  constraint grade_eventos_acao_check check (acao in ('criado','evoluido')));

create function public.sp_grade_eh_admin() returns boolean language sql stable security definer as $$
  select exists (select 1 from public.usuarios u where u.id = auth.uid() and coalesce(u.ativo, true) and u.role = 'admin') $$;
create function public.usuario_tem_permissao(p text) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.ativo and u.role in ('admin','diretoria','recepcao')) $$;
create function public.sp_grade_exigir_permissao() returns void language plpgsql stable security definer as $$
begin
  if auth.uid() is not null and not public.usuario_tem_permissao('cronograma_grade') then
    raise exception 'Sem permissão para a Grade.' using errcode = '42501';
  end if;
end $$;
create function public.sp_grade_autor_evolucao() returns table (usuario_id uuid, usuario_nome text, profissional_id bigint)
language sql stable security definer as $$
  select u.id, u.nome, u.profissional_id from public.usuarios u where u.id = auth.uid() $$;
-- Falta da recepção: só a sessão do paciente 99.
create function public.sp_grade_falta_recepcao(bigint, bigint, bigint, text, date, time) returns text
language sql stable as $$ select case when $2 = 99 then 'paciente' end $$;
`)
const mig = readFileSync(process.argv[2], 'utf8')
await db.exec(mig); await db.exec(mig)

// RPCs de gravação, reduzidas (mesma porta de entrada e mesmo autor das reais).
await db.exec(`
create function public.grade_registrar_evolucao(p_ag uuid, p_desc text, p_sub bigint default null) returns void
language plpgsql security definer as $$
declare a record; v record;
begin
  perform public.sp_grade_exigir_evoluir(p_ag);
  select * into a from public.grade_agendamentos where id = p_ag;
  select * into v from public.sp_grade_autor_evolucao();
  insert into public.grade_evolucoes (agendamento_id, status_execucao, possui_tratativa, tratativa_profissional_id, descricao_evolucao)
  values (p_ag, 'Realizado', true,
          case when p_sub is not null and p_sub <> a.profissional_id then p_sub
               when v.profissional_id is not null and v.profissional_id <> a.profissional_id then v.profissional_id
               else a.profissional_id end, p_desc)
  on conflict (agendamento_id) do update set status_execucao = 'Realizado', possui_tratativa = true,
    tipo_falta = null, tratativa_profissional_id = excluded.tratativa_profissional_id, descricao_evolucao = excluded.descricao_evolucao;
end $$;
create function public.grade_registrar_falta(p_ag uuid, p_tipo text) returns void
language plpgsql security definer as $$
begin
  perform public.sp_grade_exigir_evoluir(p_ag);
  insert into public.grade_evolucoes (agendamento_id, status_execucao, tipo_falta, possui_tratativa)
  values (p_ag, 'Cancelado', p_tipo, false)
  on conflict (agendamento_id) do update set status_execucao = 'Cancelado', tipo_falta = excluded.tipo_falta, possui_tratativa = false;
end $$;
create function public.grade_limpar_evolucao(p_ag uuid) returns void
language plpgsql security definer as $$
begin
  perform public.sp_grade_exigir_evoluir(p_ag);
  delete from public.grade_evolucoes where agendamento_id = p_ag;
end $$;

insert into public.profissionais values (10, 'Ana', true), (11, 'Bruno', true), (12, 'Carla Desligada', false);
insert into public.usuarios values
  ('${ADMIN}', 'Admin', 'admin', true, null),
  ('${DIR}', 'Diretora', 'diretoria', true, null),
  ('${RECEP}', 'Recep', 'recepcao', true, null),
  ('${TA}', 'Ana (login)', 'terapeuta', true, 10),
  ('${TB}', 'Bruno (login)', 'terapeuta', true, 11),
  ('${TINATIVO}', 'Carla (login)', 'terapeuta', true, 12);
insert into public.pacientes values (1, 'Pedro', null), (99, 'Faltou Na Recepcao', null);
insert into public.grade_agendamentos (id, data, hora_inicio, hora_fim, paciente_id, paciente_nome, profissional_id, profissional_nome, terapia_nome) values
  ('${S(1)}', current_date - 1, '10:00', '10:40', 1, 'Pedro', 10, 'Ana', 'Fono'),   -- Ana, passada
  ('${S(2)}', current_date + 1, '10:00', '10:40', 1, 'Pedro', 10, 'Ana', 'Fono'),   -- Ana, futura
  ('${S(3)}', current_date - 1, '11:00', '11:40', 1, 'Pedro', 10, 'Ana', 'Fono'),   -- Ana, vai ser coberta por Bruno
  ('${S(4)}', current_date - 1, '12:00', '12:40', 99, 'X', 10, 'Ana', 'Fono'),      -- falta da recepção
  ('${S(5)}', current_date - 1, '13:00', '13:40', 1, 'Pedro', 10, 'Ana', 'Fono'),   -- p/ falta
  ('${S(6)}', current_date - 1, '14:00', '14:40', 1, 'Pedro', 12, 'Carla', 'Fono'), -- profissional inativo
  ('${S(7)}', current_date - 1, '15:00', '15:40', 1, 'Pedro', 10, 'Ana', 'Fono');   -- p/ substituto
`)

const como = async (uid, sql, params = []) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false)`)
  try { return { rows: (await db.query(sql, params)).rows } }
  catch (e) { return { erro: e } }
  finally { await db.exec(`select set_config('request.jwt.claim.sub', '', false)`) }
}
const erro = (r, code, trecho) => !!r.erro && (!code || r.erro.code === code) && (!trecho || r.erro.message.includes(trecho))

// Terapeuta na própria sessão
ok(!(await como(TA, `select public.grade_registrar_evolucao($1, 'Sessão ok')`, [S(1)])).erro, 'terapeuta evolui a própria sessão já iniciada')
const evol = (await db.query(`select tratativa_profissional_id t from public.grade_evolucoes where agendamento_id = $1`, [S(1)])).rows[0]
ok(evol?.t == 10, 'evolução fica no nome dele')
ok(erro(await como(TA, `select public.grade_registrar_evolucao($1, 'de novo')`, [S(1)]), '42501', 'já tem registro'), 'não reescreve registro existente')
ok(erro(await como(TA, `select public.grade_limpar_evolucao($1)`, [S(1)]), '42501', 'já tem registro'), 'não limpa registro')
ok(erro(await como(TA, `select public.grade_registrar_evolucao($1, 'cedo')`, [S(2)]), '22023', 'não começou'), 'sessão futura: espera começar')
ok(erro(await como(TA, `select public.grade_registrar_evolucao($1, 'x')`, [S(4)]), '42501', 'recepção registrou falta'), 'falta da recepção bloqueia')
ok(erro(await como(TA, `select public.grade_registrar_falta($1, 'terapeuta')`, [S(5)]), '42501', 'só falta do paciente'), 'terapeuta não marca falta do profissional')
ok(!(await como(TA, `select public.grade_registrar_falta($1, 'paciente')`, [S(5)])).erro, 'terapeuta marca falta do paciente')
ok(erro(await como(TA, `select public.grade_registrar_evolucao($1, 'x', 11)`, [S(7)]), '42501', 'nome de quem atendeu'), 'não põe a evolução no nome de outro')

// Outro terapeuta e cobertura
ok(erro(await como(TB, `select public.grade_registrar_evolucao($1, 'x')`, [S(3)]), '42501', 'Sem permissão'), 'outro terapeuta não evolui sessão alheia')
ok(erro(await como(TA, `select public.grade_definir_cobertura($1, 11)`, [S(3)]), '42501'), 'terapeuta não define cobertura')
ok(erro(await como(RECEP, `select public.grade_definir_cobertura($1, 10)`, [S(3)]), '22023', 'já é o da sessão'), 'cobertura não pode ser o próprio agendado')
ok(erro(await como(RECEP, `select public.grade_definir_cobertura($1, 11)`, [S(1)]), '22023', 'já tem evolução'), 'sessão já registrada não recebe cobertura')
ok(!(await como(RECEP, `select public.grade_definir_cobertura($1, 11)`, [S(3)])).erro, 'equipe da Grade define cobertura')
ok((await db.query(`select count(*)::int n from public.grade_eventos where acao = 'cobertura_definida'`)).rows[0].n === 1, 'cobertura vai para o histórico')
ok(erro(await como(TA, `select public.grade_registrar_evolucao($1, 'x')`, [S(3)]), '42501'), 'agendado original perde a sessão coberta')
ok(!(await como(TB, `select public.grade_registrar_evolucao($1, 'Cobri')`, [S(3)])).erro, 'quem cobre evolui')
ok((await db.query(`select tratativa_profissional_id t from public.grade_evolucoes where agendamento_id = $1`, [S(3)])).rows[0].t == 11, 'evolução da cobertura no nome de quem cobriu')

// Profissional inativo e admin
ok(erro(await como(TINATIVO, `select public.grade_registrar_evolucao($1, 'x')`, [S(6)]), '42501'), 'terapeuta de profissional inativo não evolui')
ok(!(await como(ADMIN, `select public.grade_registrar_evolucao($1, 'Admin evolui futuro')`, [S(2)])).erro, 'admin segue sem as travas do terapeuta')
ok(!(await como(ADMIN, `select public.grade_limpar_evolucao($1)`, [S(2)])).erro, 'admin limpa')
ok(!(await como(RECEP, `select public.grade_remover_cobertura($1)`, [S(3)])).erro, 'equipe da Grade remove cobertura')
ok((await db.query(`select count(*)::int n from public.grade_eventos where acao = 'cobertura_removida'`)).rows[0].n === 1, 'remoção vai para o histórico')

// app_agenda
await como(RECEP, `select public.grade_definir_cobertura($1, 11)`, [S(2)])
const de = `current_date - 2`, ate = `current_date + 2`
const agA = await como(TA, `select agendamento_id, cobertura_profissional_id, efetivo from public.app_agenda(${de}, ${ate})`)
ok(!agA.erro && agA.rows.length === 6, 'terapeuta vê a própria agenda (6 sessões, inclusive a coberta por outro)')
const cobertaA = agA.rows?.find((r) => r.agendamento_id === S(2))
ok(cobertaA?.cobertura_profissional_id == 11 && cobertaA.efetivo === false, 'sessão coberta por outro vem marcada e não é dele')
ok(agA.rows?.find((r) => r.agendamento_id === S(1))?.efetivo === true, 'sessão própria sem cobertura é dele')
const agB = await como(TB, `select agendamento_id, efetivo from public.app_agenda(${de}, ${ate}, 10)`)
ok(!agB.erro && agB.rows.length === 1 && agB.rows[0].agendamento_id === S(2) && agB.rows[0].efetivo === true,
  'quem cobre vê só a sessão coberta, como sua (parâmetro de profissional ignorado)')
const r4 = await como(TA, `select falta_recepcao, status_execucao from public.app_agenda(${de}, ${ate}) where agendamento_id = $1`, [S(4)])
ok(r4.rows?.[0]?.falta_recepcao === true && r4.rows[0].status_execucao === 'Cancelado', 'falta da recepção aparece como cancelada')
ok(erro(await como(DIR, `select * from public.app_agenda(${de}, ${ate})`), '22023', 'Escolha o profissional'), 'gestão precisa escolher o profissional')
ok((await como(DIR, `select * from public.app_agenda(${de}, ${ate}, 10)`)).rows?.length === 6, 'diretoria lê a agenda escolhida')
ok(erro(await como(RECEP, `select * from public.app_agenda(${de}, ${ate}, 10)`), '42501'), 'recepção não usa a agenda do app')
ok(erro(await como(TA, `select * from public.app_agenda(current_date, current_date + 40)`), '22023', 'Período'), 'período limitado a 31 dias')
ok((await como(ADMIN, `select * from public.app_agenda_profissionais()`)).rows?.length === 2, 'gestão lista os profissionais ativos')
ok(erro(await como(TA, `select * from public.app_agenda_profissionais()`), '42501'), 'terapeuta não lista profissionais')

const ex = async (r, fn) => (await db.query(`select has_function_privilege($1, $2, 'EXECUTE') a`, [r, fn])).rows[0].a
ok(!(await ex('anon', 'public.app_agenda(date,date,bigint)')) && await ex('authenticated', 'public.app_agenda(date,date,bigint)'), 'app_agenda: só logado')
ok(!(await ex('authenticated', 'public.sp_grade_pode_evoluir(uuid)')), 'auxiliares continuam fechadas')

process.exit(f ? 1 : 0)
