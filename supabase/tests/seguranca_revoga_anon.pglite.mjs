// Teste da migration 20261016120000 (anon sem permissão em tabelas/views) no
// PGlite. Prova: tabela, view e schema central perdem o GRANT do anon,
// authenticated mantém o seu, a migration reroda e tabela nova não nasce aberta.
//
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   cp <repo>/supabase/tests/seguranca_revoga_anon.pglite.mjs /tmp/pg/
//   node /tmp/pg/seguranca_revoga_anon.pglite.mjs <repo>/supabase/migrations/20261016120000_seguranca_revoga_anon_tabelas.sql
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'
const db = new PGlite()
let f = 0; const ok = (c, m) => { console.log(c ? '  ok  ' : '  FALHA', m); if (!c) f++ }
await db.exec(`create role anon; create role authenticated; create schema central;
grant usage on schema public, central to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
create table public.agenda_tita (id serial primary key, nome text);
create table central.fila (id int);
grant all on central.fila to anon;
create view public.v as select * from public.agenda_tita;
insert into public.agenda_tita (nome) values ('x');`)
ok((await db.query(`select has_table_privilege('anon','public.agenda_tita','SELECT') a`)).rows[0].a, 'antes: anon tem SELECT (como em produção)')
const mig = readFileSync(process.argv[2], 'utf8')
await db.exec(mig); await db.exec(mig)
const q = async (o, p) => (await db.query(`select has_table_privilege($1, $2, $3) a`, ['anon', o, p])).rows[0].a
ok(!(await q('public.agenda_tita', 'SELECT')) && !(await q('public.agenda_tita', 'INSERT')), 'tabela: anon sem nada')
ok(!(await q('public.v', 'SELECT')), 'view: anon sem nada')
ok(!(await q('central.fila', 'SELECT')), 'schema central: anon sem nada')
ok((await db.query(`select has_table_privilege('authenticated','public.agenda_tita','SELECT') a`)).rows[0].a, 'authenticated mantém o que tinha')
await db.exec(`create table public.nova (id int)`)
ok(!(await q('public.nova', 'SELECT')), 'tabela nova não nasce aberta ao anon')
process.exit(f ? 1 : 0)
