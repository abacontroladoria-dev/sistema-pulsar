// Teste da migration 20261016130000 (funções, views e usuarios) no PGlite.
// Prova: fn_sync_* só para service_role; guias_avulsas e consultas da Central
// só para logado; login (email_por_username) e robô continuam para o anon;
// views com security_invoker; usuarios com RLS; migration reroda.
//
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   cp <repo>/supabase/tests/seguranca_funcoes_views_usuarios.pglite.mjs /tmp/pg/
//   node /tmp/pg/seguranca_funcoes_views_usuarios.pglite.mjs <repo>/supabase/migrations/20261016130000_seguranca_funcoes_views_usuarios.sql
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'
const db = new PGlite()
let f = 0; const ok = (c, m) => { console.log(c ? '  ok  ' : '  FALHA', m); if (!c) f++ }
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create table public.usuarios (id int); create table public.agenda_tita (id int);
create view public.vw_central_terapeutica as select * from public.agenda_tita;
create view public.vw_profissionais_disponiveis as select 1 as x;
grant all on public.vw_central_terapeutica, public.vw_profissionais_disponiveis, public.usuarios to anon;
create function public.fn_sync_tita_grade() returns int language sql security definer as $$ select 1 $$;
create function public.fn_sync_grade_csv_verificar(p boolean default true) returns int language sql as $$ select 1 $$;
create function public.guias_avulsas(a date, b date) returns int language sql security definer as $$ select 1 $$;
create function public.listar_central_pacientes(p_data date) returns int language sql as $$ select 1 $$;
create function public.email_por_username(p text) returns text language sql security definer as $$ select p $$;
create function public.robo_heartbeat(p text) returns int language sql security definer as $$ select 1 $$;`)
const mig = readFileSync(process.argv[2], 'utf8')
await db.exec(mig); await db.exec(mig)
const ex = async (r, fn) => (await db.query(`select has_function_privilege($1, $2, 'EXECUTE') a`, [r, fn])).rows[0].a
ok(!(await ex('anon', 'public.fn_sync_tita_grade()')) && !(await ex('authenticated', 'public.fn_sync_tita_grade()')), 'fn_sync_*: ninguém de fora dispara o sync')
ok(await ex('service_role', 'public.fn_sync_tita_grade()'), 'fn_sync_*: service_role continua')
ok(!(await ex('anon', 'public.fn_sync_grade_csv_verificar(boolean)')), 'fn_sync_* com argumento também')
ok(!(await ex('anon', 'public.guias_avulsas(date,date)')) && await ex('authenticated', 'public.guias_avulsas(date,date)'), 'guias_avulsas: só logado')
ok(!(await ex('anon', 'public.listar_central_pacientes(date)')) && await ex('authenticated', 'public.listar_central_pacientes(date)'), 'Central: só logado')
ok(await ex('anon', 'public.email_por_username(text)'), 'login continua chamando email_por_username')
ok(await ex('anon', 'public.robo_heartbeat(text)'), 'robô continua')
const inv = (await db.query(`select reloptions from pg_class where relname = 'vw_central_terapeutica'`)).rows[0].reloptions
ok(JSON.stringify(inv).includes('security_invoker=true'), 'view passa a respeitar a RLS de quem consulta')
ok(!(await db.query(`select has_table_privilege('anon','public.vw_profissionais_disponiveis','SELECT') a`)).rows[0].a, 'anon sem acesso à view de profissionais')
ok((await db.query(`select relrowsecurity r from pg_class where relname = 'usuarios'`)).rows[0].r, 'usuarios com RLS ligada')
process.exit(f ? 1 : 0)
