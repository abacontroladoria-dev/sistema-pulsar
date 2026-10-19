// Teste da migration 20261019170000 (Fase 0 do app de evoluções) no PGlite.
// Prova: cadastro não escolhe o próprio papel; conta só de telefone não quebra
// nem entra em usuarios; central_role só vale para ativo (token e fallback);
// profissional_id travado para o próprio usuário; migration reroda.
//
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   cp <repo>/supabase/tests/seguranca_cadastro_token_profissional.pglite.mjs /tmp/pg/
//   node /tmp/pg/seguranca_cadastro_token_profissional.pglite.mjs <repo>/supabase/migrations/20261019170000_seguranca_cadastro_token_profissional.sql
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'
const db = new PGlite()
let f = 0; const ok = (c, m) => { console.log(c ? '  ok  ' : '  FALHA', m); if (!c) f++ }

const ADMIN = '00000000-0000-0000-0000-00000000000a'
const COMUM = '00000000-0000-0000-0000-00000000000b'
const INATIVO = '00000000-0000-0000-0000-00000000000c'

await db.exec(`
create schema auth; create schema central;
create role anon; create role authenticated; create role service_role bypassrls;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create table public.usuarios (
  id uuid primary key, nome text, email text not null unique, role text default 'recepcao',
  ativo boolean default true, primeiro_acesso boolean, central_role text,
  organization_id uuid default 'a0000000-0000-0000-0000-000000000001', unidade text, unidades text[],
  created_at timestamptz default now(), pode_editar_prompt_maia boolean default false,
  profissional_id bigint, username text);
create function public.is_admin() returns boolean language sql stable security definer as $$
  select exists (select 1 from public.usuarios where id = auth.uid() and role = 'admin' and ativo) $$;
create function public.is_diretoria() returns boolean language sql stable security definer as $$
  select exists (select 1 from public.usuarios where id = auth.uid() and role = 'diretoria' and ativo) $$;
-- Mesmo gatilho de produção (20260810130050): admin do Pulsar = admin da Central.
create function public.sync_central_role_admin() returns trigger language plpgsql as $$
begin if new.role = 'admin' then new.central_role := 'admin'; end if; return new; end $$;
create trigger trg_sync_central_role_admin before insert or update on public.usuarios
  for each row execute function public.sync_central_role_admin();
`)
const mig = readFileSync(process.argv[2], 'utf8')
await db.exec(mig); await db.exec(mig)
await db.exec(`
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
create trigger trg_usuarios_trava_colunas_de_acesso before update on public.usuarios
  for each row execute function public.usuarios_trava_colunas_de_acesso();
insert into public.usuarios (id, nome, email, role, ativo) values
  ('${ADMIN}', 'Admin', 'admin@x', 'admin', true),
  ('${COMUM}', 'Comum', 'comum@x', 'recepcao', true),
  ('${INATIVO}', 'Inativo', 'inativo@x', 'admin', false);
`)

// ── 1. handle_new_user ──
await db.exec(`insert into auth.users (id, email, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000001', 'golpe@x', '{"nome":"Golpe","role":"admin"}')`)
const golpe = (await db.query(`select role, ativo, central_role from public.usuarios where email = 'golpe@x'`)).rows[0]
ok(golpe && golpe.role === 'recepcao' && golpe.ativo === false && golpe.central_role === null,
  'cadastro com role=admin no metadata vira recepcao inativo, sem central_role')

let erroTelefone = null
try {
  await db.exec(`insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000002', null)`)
} catch (e) { erroTelefone = e }
ok(!erroTelefone, 'conta só de telefone (sem e-mail) é criada sem erro')
ok((await db.query(`select count(*)::int n from public.usuarios where id = '00000000-0000-0000-0000-000000000002'`)).rows[0].n === 0,
  'conta só de telefone não ganha linha em usuarios')

// ── 2. central_role só com ativo ──
const hook = async (id) => (await db.query(
  `select public.custom_access_token_hook(jsonb_build_object('user_id', $1::text, 'claims', '{}'::jsonb)) -> 'claims' c`, [id])).rows[0].c
ok((await hook(ADMIN)).central_role === 'admin', 'token do admin ativo leva central_role')
ok((await hook(INATIVO)).central_role === undefined, 'token do inativo NÃO leva central_role')
ok((await hook(INATIVO)).organization_id !== undefined, 'organization_id continua no token')

const comoUsuario = async (id, sql, claims = '{}') => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${id}', false),
                        set_config('request.jwt.claim.role', 'authenticated', false),
                        set_config('request.jwt.claims', '${claims}', false)`)
  try { return await db.query(sql) } finally {
    await db.exec(`select set_config('request.jwt.claim.sub', '', false),
                          set_config('request.jwt.claim.role', '', false),
                          set_config('request.jwt.claims', '', false)`)
  }
}
ok((await comoUsuario(ADMIN, `select central.ca_current_role() r`)).rows[0].r === 'admin', 'fallback do banco: admin ativo é admin')
ok((await comoUsuario(INATIVO, `select central.ca_current_role() r`)).rows[0].r === null, 'fallback do banco: inativo sem papel na Central')

// ── 3. profissional_id travado ──
let erroTrava = null
try {
  await comoUsuario(COMUM, `update public.usuarios set profissional_id = 42 where id = '${COMUM}'`)
} catch (e) { erroTrava = e }
ok(erroTrava && erroTrava.code === '42501', 'usuário comum NÃO se liga a um profissional')

let erroNome = null
try {
  await comoUsuario(COMUM, `update public.usuarios set nome = 'Comum Silva' where id = '${COMUM}'`)
} catch (e) { erroNome = e }
ok(!erroNome, 'usuário comum continua editando o próprio nome')

await comoUsuario(ADMIN, `update public.usuarios set profissional_id = 7 where id = '${COMUM}'`)
ok((await db.query(`select profissional_id p from public.usuarios where id = '${COMUM}'`)).rows[0].p == 7,
  'admin liga usuário a profissional')

await db.exec(`update public.usuarios set profissional_id = 8 where id = '${COMUM}'`)
ok((await db.query(`select profissional_id p from public.usuarios where id = '${COMUM}'`)).rows[0].p == 8,
  'servidor/SQL Editor (sem JWT) liga usuário a profissional')

process.exit(f ? 1 : 0)
