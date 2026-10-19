// Teste da migration 20261019200000 (Fase 1 do app de evoluções) no PGlite.
// Prova: role 'terapeuta' cabe na constraint; grupo "Terapeuta (App)" dá o
// nível; setor do Pulsar vence o terapeuta; um login por profissional;
// app_meu_perfil() por papel; só logado executa; migration reroda.
//
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   cp <repo>/supabase/tests/papel_terapeuta_app.pglite.mjs /tmp/pg/
//   node /tmp/pg/papel_terapeuta_app.pglite.mjs <repo>/supabase/migrations/20261019200000_papel_terapeuta_app.sql
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'
const db = new PGlite()
let f = 0; const ok = (c, m) => { console.log(c ? '  ok  ' : '  FALHA', m); if (!c) f++ }

const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`

await db.exec(`
create schema auth;
create role anon; create role authenticated; create role service_role bypassrls;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table public.profissionais (id bigint primary key, nome text, ativo boolean default true);
create table public.usuarios (
  id uuid primary key, nome text, email text, role text default 'recepcao',
  ativo boolean default true, profissional_id bigint references public.profissionais(id),
  constraint usuarios_role_check check (role in ('admin','diretoria','recepcao','autorizacao','terapeutico',
    'faturamento','rp','cronograma','disponibilidade_terapeuta','marketing','comercial')));
create index idx_usuarios_profissional_id on public.usuarios (profissional_id) where profissional_id is not null;
create table public.grupos_permissoes (id uuid primary key default gen_random_uuid(), nome text unique, descricao text, nivel_tecnico text);
create table public.grupos_permissoes_membros (grupo_id uuid references public.grupos_permissoes(id), usuario_id uuid references public.usuarios(id), primary key (grupo_id, usuario_id));
create function public.is_admin() returns boolean language sql stable security definer as $$
  select exists (select 1 from public.usuarios where id = auth.uid() and role = 'admin' and ativo) $$;
insert into public.grupos_permissoes (nome, nivel_tecnico) values ('Recepção', 'recepcao'), ('Administrador', 'admin');
`)
const mig = readFileSync(process.argv[2], 'utf8')
await db.exec(mig); await db.exec(mig)
// Mesmo gatilho de 20260929130000: membro entra/sai → recalcula o nível.
await db.exec(`
create function public.trg_membro_sync() returns trigger language plpgsql as $$
begin perform public.sincronizar_nivel_pelos_grupos(coalesce(new.usuario_id, old.usuario_id)); return null; end $$;
create trigger trg_membro_sync after insert or delete on public.grupos_permissoes_membros
  for each row execute function public.trg_membro_sync();
insert into public.profissionais values (10, 'Ana Terapeuta', true), (11, 'Bia Desligada', false), (12, 'Caio Livre', true);
insert into public.usuarios (id, nome, role, ativo, profissional_id) values
  ('${U(1)}', 'Admin', 'admin', true, null),
  ('${U(2)}', 'Diretora', 'diretoria', true, null),
  ('${U(3)}', 'Recep', 'recepcao', true, null),
  ('${U(4)}', 'Ana (usuário)', 'recepcao', true, 10),
  ('${U(5)}', 'Sem profissional', 'recepcao', true, null),
  ('${U(6)}', 'Bia (usuário)', 'recepcao', true, 11),
  ('${U(7)}', 'Admin inativo', 'admin', false, null),
  ('${U(8)}', 'Recep e terapeuta', 'recepcao', true, 12);
`)

const grupo = async (nome) => (await db.query(`select id from public.grupos_permissoes where nome = $1`, [nome])).rows[0]?.id
const gTerapeuta = await grupo('Terapeuta (App)')
ok(!!gTerapeuta, 'grupo "Terapeuta (App)" criado')
ok((await db.query(`select nivel_tecnico n from public.grupos_permissoes where nome = 'Terapeuta (App)'`)).rows[0].n === 'terapeuta', 'grupo dá o nível terapeuta')

for (const id of [U(4), U(5), U(6)]) {
  await db.query(`insert into public.grupos_permissoes_membros values ($1, $2)`, [gTerapeuta, id])
}
const role = async (id) => (await db.query(`select role from public.usuarios where id = $1`, [id])).rows[0].role
ok(await role(U(4)) === 'terapeuta', 'entrar no grupo vira role terapeuta (constraint aceita)')

await db.query(`insert into public.grupos_permissoes_membros values ($1, $2)`, [await grupo('Recepção'), U(8)])
await db.query(`insert into public.grupos_permissoes_membros values ($1, $2)`, [gTerapeuta, U(8)])
ok(await role(U(8)) === 'recepcao', 'quem também está num setor fica com o setor')

let dup = null
try { await db.exec(`update public.usuarios set profissional_id = 10 where id = '${U(5)}'`) } catch (e) { dup = e }
ok(dup && dup.code === '23505', 'um login por profissional (unique)')
ok((await db.query(`select count(*)::int n from pg_indexes where indexname = 'idx_usuarios_profissional_id'`)).rows[0].n === 0, 'índice antigo substituído')

const perfil = async (id) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${id ?? ''}', false)`)
  const r = (await db.query(`select * from public.app_meu_perfil()`)).rows
  await db.exec(`select set_config('request.jwt.claim.sub', '', false)`)
  return r
}
const p4 = await perfil(U(4))
ok(p4.length === 1 && p4[0].tipo === 'terapeuta' && p4[0].nome === 'Ana Terapeuta' && p4[0].pode_evoluir === true,
  'terapeuta ligado a profissional ativo: tipo terapeuta, nome do profissional, evolui')
ok((await perfil(U(5))).length === 0, 'terapeuta sem profissional: sem acesso')
ok((await perfil(U(6))).length === 0, 'terapeuta com profissional inativo: sem acesso')
const p1 = await perfil(U(1))
ok(p1.length === 1 && p1[0].tipo === 'gestao' && p1[0].pode_evoluir === true, 'admin: gestão, evolui')
const p2 = await perfil(U(2))
ok(p2.length === 1 && p2[0].tipo === 'gestao' && p2[0].pode_evoluir === false, 'diretoria: gestão, só consulta')
ok((await perfil(U(3))).length === 0, 'recepção: sem acesso ao app')
ok((await perfil(U(7))).length === 0, 'admin inativo: sem acesso')
ok((await perfil(null)).length === 0, 'sem login: nenhuma linha')

const ex = async (r) => (await db.query(`select has_function_privilege($1, 'public.app_meu_perfil()', 'EXECUTE') a`, [r])).rows[0].a
ok(!(await ex('anon')) && await ex('authenticated'), 'app_meu_perfil: só logado executa')

process.exit(f ? 1 : 0)
