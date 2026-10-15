// Teste de segurança/execução da migration 20261015170000 no PGlite (Postgres
// de verdade em Node, sem Docker). Ocupação Clínica — feriados da semana.
//
// Prova: a migration roda e reroda; anon não executa; login sem a permissão
// recebe 42501; quem tem a permissão (por papel ou por override) recebe só as
// colunas do cálculo e só o período pedido; período absurdo é recusado.
//
// Rodar FORA do repo (o pacote não é dependência do projeto):
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   node <repo>/supabase/tests/ocupacao_clinica_feriados.pglite.mjs \
//     <repo>/supabase/migrations/20261015170000_ocupacao_clinica_feriados.sql
// (com NODE_PATH apontando para o node_modules de /tmp/pg, ou copiando o .mjs para lá)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'

const [, , migPath] = process.argv
const mig = readFileSync(migPath, 'utf8')

let falhas = 0
const ok = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { falhas++; console.log('  FALHA', msg) } }

const db = new PGlite()
async function execErro(sql) {
  try { await db.exec(sql); return null } catch (e) { return e }
}
async function erro(sql, params = []) {
  try { await db.query(sql, params); return null } catch (e) { return e }
}

const ADMIN = '00000000-0000-0000-0000-00000000000a' // papel admin
const OVERRIDE = '00000000-0000-0000-0000-00000000000b' // papel rp com override explícito
const SEM = '00000000-0000-0000-0000-00000000000c' // nenhuma permissão

await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create table public.usuarios(id uuid primary key, nome text, role text, ativo boolean default true);
create table public.usuarios_permissoes(usuario_id uuid, permissao_codigo text, permitido boolean);
grant select on public.usuarios to authenticated; -- a policy de feriados consulta usuarios
create or replace function public.usuario_tem_permissao(p_codigo text) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.ativo and u.role in ('admin','diretoria'))
  or exists (select 1 from public.usuarios_permissoes up join public.usuarios u on u.id = up.usuario_id
             where up.usuario_id = auth.uid() and up.permissao_codigo = p_codigo and up.permitido and u.ativo) $$;
revoke all on function public.usuario_tem_permissao(text) from public, anon;
grant execute on function public.usuario_tem_permissao(text) to authenticated;

-- Shape real (20260723160000) com a RLS real: só rp/admin/diretoria/terapeutico leem.
create table public.feriados (
  id uuid primary key default gen_random_uuid(), data date not null unique, nome text not null,
  tipo text not null, horario_inicio text not null, horario_fim text not null,
  created_at timestamptz default now(), updated_at timestamptz default now(), updated_by uuid);
alter table public.feriados enable row level security;
grant select on public.feriados to authenticated;
create policy feriados_select on public.feriados for select to authenticated
  using (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.role in ('rp','admin','diretoria','terapeutico')));

insert into public.usuarios values ('${ADMIN}', 'Admin', 'admin', true), ('${OVERRIDE}', 'Gestora', 'comercial', true), ('${SEM}', 'Atendente', 'atendente', true);
insert into public.usuarios_permissoes values ('${OVERRIDE}', 'indicadores_ocupacao_unidades', true);
insert into public.feriados (data, nome, tipo, horario_inicio, horario_fim) values
  ('2026-11-02', 'Finados', 'integral', '08:00', '17:40'),
  ('2026-11-20', 'Consciência Negra', 'integral', '08:00', '17:40');
`)

console.log('migration')
ok(!(await execErro(mig)), 'roda')
ok(!(await execErro(mig)), 'reroda (idempotente)')

async function como(papel, uid, sql) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${papel};`)
  try { return { rows: (await db.query(sql)).rows } } catch (e) { return { erro: e } } finally { await db.exec('reset role') }
}
const SEMANA = `select * from public.ocupacao_clinica_feriados('2026-11-02', '2026-11-07')`

console.log('acesso')
const anon = await como('anon', null, SEMANA)
ok(anon.erro && /permission denied/i.test(anon.erro.message), 'anon não executa a função')
const sem = await como('authenticated', SEM, SEMANA)
ok(sem.erro && sem.erro.code === '42501', 'login sem a permissão recebe 42501')
const adm = await como('authenticated', ADMIN, SEMANA)
ok(adm.rows?.length === 1 && adm.rows[0].nome === 'Finados', 'admin recebe o feriado da semana (e só ele)')
const ovr = await como('authenticated', OVERRIDE, SEMANA)
ok(ovr.rows?.length === 1, 'quem tem a aba por override recebe o mesmo feriado')
const direto = await como('authenticated', OVERRIDE, `select * from public.feriados`)
ok(direto.rows?.length === 0, 'o override continua sem ler a tabela por fora (RLS intacta)')
ok(ovr.rows && Object.keys(ovr.rows[0]).sort().join() === 'data,horario_fim,horario_inicio,nome,tipo', 'só as colunas do cálculo (sem updated_by)')

console.log('validação')
const inv = await como('authenticated', ADMIN, `select * from public.ocupacao_clinica_feriados('2026-11-07', '2026-11-02')`)
ok(inv.erro && inv.erro.code === '22023', 'fim antes do início é recusado')
const longo = await como('authenticated', ADMIN, `select * from public.ocupacao_clinica_feriados('2026-01-01', '2026-12-31')`)
ok(longo.erro && longo.erro.code === '22023', 'período de mais de 31 dias é recusado')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK')
process.exit(falhas ? 1 : 0)
