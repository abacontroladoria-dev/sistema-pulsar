// Teste da migration 20261019220000 (Fase 2b do app de evoluções) no PGlite.
// Prova: marcar "substituído" na Central de Terapeutas grava a cobertura da
// sessão da Grade (e desmarcar remove), sem nunca derrubar a gravação da
// Central; sessão registrada não muda; a cobertura manual da Grade não é
// removida pela Central; o agendado lê o texto da sessão coberta; carga
// inicial; migration reroda.
//
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   cp <repo>/supabase/tests/app_cobertura_pela_central.pglite.mjs /tmp/pg/
//   node /tmp/pg/app_cobertura_pela_central.pglite.mjs <repo>/supabase/migrations/20261019210000_app_agenda_cobertura.sql <repo>/supabase/migrations/20261019220000_app_cobertura_pela_central.sql
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'
const db = new PGlite()
let f = 0; const ok = (c, m) => { console.log(c ? '  ok  ' : '  FALHA', m); if (!c) f++ }

const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const S = (n) => `10000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const ADMIN = U(1), DIR = U(2), RECEP = U(3), TA = U(4), TB = U(5), TC = U(6)

await db.exec(`
create schema auth;
create role anon; create role authenticated; create role service_role bypassrls;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table public.profissionais (id bigint primary key, nome text, ativo boolean default true, tita_profissional_id bigint unique);
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
create table public.controle_terapeutico (
  id uuid primary key default gen_random_uuid(), tita_agendamento_id bigint unique, status text,
  profissional_substituto_id bigint, profissional_substituto_nome text,
  confirmado_por uuid, confirmado_por_nome text, data_atendimento date, hora_inicial time,
  profissional_id bigint);

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
create function public.sp_grade_falta_recepcao(bigint, bigint, bigint, text, date, time) returns text
language sql stable as $$ select null::text $$;
`)
await db.exec(readFileSync(process.argv[2], 'utf8'))

// Detalhe como está em produção antes desta migration (20261019120000).
await db.exec(`
create function public.sp_grade_detalhe_evolucao_interno(p uuid) returns jsonb language sql stable security definer as $$
  select jsonb_build_object('registrado', e.agendamento_id is not null, 'descricao_evolucao', e.descricao_evolucao, 'carimbo', 'c')
    from (select p as id) x left join public.grade_evolucoes e on e.agendamento_id = x.id $$;
create function public.grade_detalhe_evolucao(p_agendamento_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb := public.sp_grade_detalhe_evolucao_interno(p_agendamento_id);
begin
  if public.sp_grade_pode_evoluir(p_agendamento_id) then return v; end if;
  return v || jsonb_build_object('descricao_evolucao', null, 'carimbo', null);
end $$;
create function public.grade_registrar_evolucao(p_ag uuid, p_desc text) returns void
language plpgsql security definer as $$
declare v record;
begin
  perform public.sp_grade_exigir_evoluir(p_ag);
  select * into v from public.sp_grade_autor_evolucao();
  insert into public.grade_evolucoes (agendamento_id, status_execucao, possui_tratativa, tratativa_profissional_id, descricao_evolucao)
  values (p_ag, 'Realizado', true, v.profissional_id, p_desc);
end $$;

insert into public.profissionais values (10, 'Ana', true, 900), (11, 'Bruno', true, 901), (12, 'Carla', true, 902);
insert into public.usuarios values
  ('${ADMIN}', 'Admin', 'admin', true, null),
  ('${DIR}', 'Diretora', 'diretoria', true, null),
  ('${RECEP}', 'Recep', 'recepcao', true, null),
  ('${TA}', 'Ana (login)', 'terapeuta', true, 10),
  ('${TB}', 'Bruno (login)', 'terapeuta', true, 11),
  ('${TC}', 'Carla (login)', 'terapeuta', true, 12);
insert into public.pacientes values (1, 'Pedro', null), (2, 'Zé Erro', null);
insert into public.grade_agendamentos (id, data, hora_inicio, hora_fim, paciente_id, paciente_nome, profissional_id, profissional_nome, terapia_nome, tita_agendamento_id) values
  ('${S(1)}', current_date - 1, '08:00', '08:40', 1, 'Pedro', 10, 'Ana', 'Fono', 5001),  -- marcada antes (carga inicial)
  ('${S(2)}', current_date - 1, '09:00', '09:40', 1, 'Pedro', 10, 'Ana', 'Fono', 5002),  -- marcada antes, já registrada
  ('${S(3)}', current_date - 1, '10:00', '10:40', 1, 'Pedro', 10, 'Ana', 'Fono', 5003),  -- vai ser marcada depois
  ('${S(4)}', current_date - 1, '11:00', '11:40', 1, 'Pedro', 10, 'Ana', 'Fono', 5004),  -- cobertura manual da Grade
  ('${S(5)}', current_date - 1, '12:00', '12:40', 2, 'Zé Erro', 10, 'Ana', 'Fono', 5005), -- histórico falha
  ('${S(6)}', current_date - 1, '13:00', '13:40', 1, 'Pedro', 10, 'Ana', 'Fono', 5006),  -- substituto = agendado
  ('${S(7)}', current_date - 1, '14:00', '14:40', 1, 'Pedro', 10, 'Ana', 'Fono', 5007);  -- substituto desconhecido
insert into public.grade_evolucoes (agendamento_id, status_execucao, possui_tratativa, tratativa_profissional_id, descricao_evolucao)
values ('${S(2)}', 'Realizado', true, 10, 'Ana atendeu');
insert into public.controle_terapeutico (tita_agendamento_id, status, profissional_substituto_id, confirmado_por, confirmado_por_nome) values
  (5001, 'substituido', 901, '${RECEP}', 'Recep'),
  (5002, 'substituido', 901, '${RECEP}', 'Recep');
`)

const mig = readFileSync(process.argv[3], 'utf8')
await db.exec(mig); await db.exec(mig)

const como = async (uid, sql, params = []) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false)`)
  try { return { rows: (await db.query(sql, params)).rows } }
  catch (e) { return { erro: e } }
  finally { await db.exec(`select set_config('request.jwt.claim.sub', '', false)`) }
}
const cob = async (s) => (await db.query(`select profissional_id::int p, origem from public.grade_coberturas where agendamento_id = $1`, [s])).rows[0]
const eventos = async (s, acao) => (await db.query(`select count(*)::int n from public.grade_eventos where agendamento_id = $1 and acao = $2`, [s, acao])).rows[0].n

// Carga inicial
ok((await cob(S(1)))?.p === 11 && (await cob(S(1))).origem === 'central', 'carga inicial: substituição já marcada vira cobertura')
ok(await eventos(S(1), 'cobertura_definida') === 1, 'carga inicial vai para o histórico, uma vez só (migration rodou 2x)')
ok(!(await cob(S(2))), 'carga inicial pula sessão já registrada')

// Marcar na Central
await db.exec(`insert into public.controle_terapeutico (tita_agendamento_id, status, profissional_substituto_id, confirmado_por, confirmado_por_nome)
               values (5003, 'substituido', 901, '${RECEP}', 'Recep')`)
ok((await cob(S(3)))?.p === 11, 'marcar substituído na Central grava a cobertura')
await db.exec(`update public.controle_terapeutico set status = 'substituido' where tita_agendamento_id = 5003`)
ok(await eventos(S(3), 'cobertura_definida') === 1, 'regravar igual não duplica o histórico')
ok(erro(await como(TA, `select public.grade_registrar_evolucao($1, 'x')`, [S(3)]), '42501'), 'agendado não evolui a sessão substituída')
await db.exec(`update public.controle_terapeutico set profissional_substituto_id = 902 where tita_agendamento_id = 5003`)
ok((await cob(S(3)))?.p === 12 && await eventos(S(3), 'cobertura_definida') === 2, 'trocar o substituto troca a cobertura')
await db.exec(`update public.controle_terapeutico set status = 'disponivel', profissional_substituto_id = null where tita_agendamento_id = 5003`)
ok(!(await cob(S(3))) && await eventos(S(3), 'cobertura_removida') === 1, 'desmarcar na Central remove a cobertura')
ok(!(await como(TA, `select public.grade_registrar_evolucao($1, 'voltou')`, [S(3)])).erro, 'sem cobertura, o agendado volta a evoluir')
await db.exec(`update public.controle_terapeutico set status = 'substituido', profissional_substituto_id = 901 where tita_agendamento_id = 5003`)
ok(!(await cob(S(3))), 'sessão já registrada não recebe cobertura da Central')

// Cobertura manual da Grade
ok(!(await como(RECEP, `select public.grade_definir_cobertura($1, 12)`, [S(4)])).erro, 'Grade ainda define cobertura manual')
ok((await cob(S(4)))?.origem === 'grade', 'cobertura manual fica com origem grade')
await db.exec(`insert into public.controle_terapeutico (tita_agendamento_id, status, confirmado_por) values (5004, 'disponivel', '${RECEP}')`)
ok((await cob(S(4)))?.p === 12, 'Central sem substituição não remove cobertura manual')
await db.exec(`update public.controle_terapeutico set status = 'substituido', profissional_substituto_id = 901 where tita_agendamento_id = 5004`)
ok((await cob(S(4)))?.p === 11 && (await cob(S(4))).origem === 'central', 'Central marcando substituto assume a cobertura')
ok(!(await como(RECEP, `select public.grade_definir_cobertura($1, 12)`, [S(4)])).erro && (await cob(S(4))).origem === 'grade', 'redefinir pela Grade volta a origem para grade')

// Casos que não viram cobertura
await db.exec(`insert into public.controle_terapeutico (tita_agendamento_id, status, profissional_substituto_id) values (5006, 'substituido', 900)`)
ok(!(await cob(S(6))), 'substituto igual ao agendado não vira cobertura')
await db.exec(`insert into public.controle_terapeutico (tita_agendamento_id, status, profissional_substituto_id) values (5007, 'substituido', 999)`)
ok(!(await cob(S(7))), 'substituto desconhecido não vira cobertura')
const fora = await como(null, `insert into public.controle_terapeutico (tita_agendamento_id, status, profissional_substituto_id) values (7777, 'substituido', 901) returning id`)
ok(!fora.erro && fora.rows.length === 1, 'sessão fora da Grade: a Central grava normalmente')

// Falha no gatilho não derruba a Central
await db.exec(`alter table public.grade_eventos add constraint teste_falha check (resumo not like '%Zé Erro%')`)
const r5 = await como(null, `insert into public.controle_terapeutico (tita_agendamento_id, status, profissional_substituto_id) values (5005, 'substituido', 901) returning id`)
ok(!r5.erro && r5.rows.length === 1, 'erro na cobertura não derruba a gravação da Central')
ok(!(await cob(S(5))), 'e a cobertura incompleta é desfeita')
await db.exec(`alter table public.grade_eventos drop constraint teste_falha`)

// Apagar a linha da Central
await db.exec(`delete from public.controle_terapeutico where tita_agendamento_id = 5001`)
ok(!(await cob(S(1))), 'apagar a linha da Central remove a cobertura')
await db.exec(`insert into public.controle_terapeutico (tita_agendamento_id, status, profissional_substituto_id) values (5001, 'substituido', 901)`)

// Leitura do texto da evolução
ok(!(await como(TB, `select public.grade_registrar_evolucao($1, 'Bruno cobriu')`, [S(1)])).erro, 'substituto da Central evolui')
const texto = async (uid, s) => (await como(uid, `select public.grade_detalhe_evolucao($1) ->> 'descricao_evolucao' t`, [s])).rows?.[0]?.t
ok(await texto(TB, S(1)) === 'Bruno cobriu', 'quem cobriu lê o texto')
ok(await texto(TA, S(1)) === 'Bruno cobriu', 'agendado lê o texto da sessão coberta')
ok(await texto(TC, S(1)) === null, 'outro terapeuta não lê')
ok(await texto(DIR, S(1)) === null, 'diretoria continua sem o texto')
ok(await texto(ADMIN, S(1)) === 'Bruno cobriu', 'admin lê')
ok(erro(await como(TA, `select public.grade_registrar_evolucao($1, 'x')`, [S(1)]), '42501'), 'ler não dá ao agendado o direito de gravar')

const ex = async (r, fn) => (await db.query(`select has_function_privilege($1, $2, 'EXECUTE') a`, [r, fn])).rows[0].a
ok(!(await ex('authenticated', 'public.sp_grade_pode_ler_evolucao(uuid)')), 'auxiliar de leitura fechada')

function erro(r, code, trecho) { return !!r.erro && (!code || r.erro.code === code) && (!trecho || r.erro.message.includes(trecho)) }
process.exit(f ? 1 : 0)
