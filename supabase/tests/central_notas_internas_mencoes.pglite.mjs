// Teste de segurança/execução da migration 20261015120000 no PGlite (Postgres
// de verdade em Node, sem Docker). Fase de segurança das notas internas e
// menções do inbox do Connect.
//
// Prova: a migration roda e reroda; anon não lê nada; authenticated não grava
// nada direto (nem nota, nem menção, nem marcar como lida); a nota só aparece
// para admin/director da organização ou membro da caixa da conversa; a menção
// só aparece para a própria pessoa mencionada, e some quando ela perde acesso à
// caixa; outra organização não vê nada; as constraints recusam nota vazia e
// delegação a quem não foi mencionado, e aceitam menção a si mesmo (lembrete).
//
// Rodar FORA do repo (o pacote não é dependência do projeto):
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   node <repo>/supabase/tests/central_notas_internas_mencoes.pglite.mjs \
//     <repo>/supabase/migrations/20261015120000_central_notas_internas_mencoes.sql
// (com NODE_PATH apontando para o node_modules de /tmp/pg, ou copiando o .mjs para lá)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'

const [, , migPath] = process.argv
const mig = readFileSync(migPath, 'utf8')

let falhas = 0
const ok = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { falhas++; console.log('  FALHA', msg) } }

const db = new PGlite()
async function erro(sql, params = []) {
  try { await db.query(sql, params); return null } catch (e) { return e }
}

const ORG   = 'a0000000-0000-0000-0000-000000000001'
const OUTRA = 'a0000000-0000-0000-0000-000000000002'
const CAIXA_A = 'b0000000-0000-0000-0000-00000000000a'
const CAIXA_B = 'b0000000-0000-0000-0000-00000000000b'
const CONV_A  = 'c0000000-0000-0000-0000-00000000000a' // na caixa A
const CONV_B  = 'c0000000-0000-0000-0000-00000000000b' // na caixa B

const JEN   = '00000000-0000-0000-0000-0000000000a1' // operator, caixa A
const DANI  = '00000000-0000-0000-0000-0000000000a2' // operator, caixa A
const BETO  = '00000000-0000-0000-0000-0000000000b1' // operator, só caixa B
const DIR   = '00000000-0000-0000-0000-0000000000d1' // director, nenhuma caixa
const FORA  = '00000000-0000-0000-0000-0000000000f1' // director de OUTRA organização
const SEMCA = '00000000-0000-0000-0000-0000000000e1' // sem central_role

await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$
  select '{}'::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create schema central;
grant usage on schema central to anon, authenticated, service_role;
-- O que 20260701000000 faz no banco real: CRUD para authenticated em toda
-- tabela nova de central. É isso que a migration precisa fechar.
alter default privileges in schema central grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema central grant all on tables to anon, service_role;

create table public.usuarios(id uuid primary key, nome text, ativo boolean default true,
  organization_id uuid, central_role text);

create table central.organizations(id uuid primary key);
create table central.inboxes(id uuid primary key, organization_id uuid);
create table central.inbox_members(id uuid primary key default gen_random_uuid(),
  organization_id uuid, inbox_id uuid, user_id uuid);
create table central.conversations(id uuid primary key, organization_id uuid, inbox_id uuid);

-- As funções reais (20260701000700, 20260924180200), sem o atalho do JWT.
create function central.current_organization_id() returns uuid language sql stable security definer
  set search_path = public, central as $$
  select organization_id from public.usuarios where id = auth.uid() limit 1 $$;
create function central.ca_current_role() returns text language sql stable security definer
  set search_path = public, central as $$
  select central_role from public.usuarios where id = auth.uid() limit 1 $$;
create function central.ca_minhas_inboxes() returns setof uuid language sql stable security definer
  set search_path = central, public as $$
  select im.inbox_id from central.inbox_members im
  where im.user_id = auth.uid() and im.organization_id = central.current_organization_id() $$;
grant execute on function central.current_organization_id() to authenticated;
grant execute on function central.ca_current_role() to authenticated;
grant execute on function central.ca_minhas_inboxes() to authenticated;

-- RLS das conversas como no banco real (base + membro), para o exists() das
-- policies novas enxergar o mesmo que a tela enxerga.
alter table central.conversations enable row level security;
grant select on central.conversations to authenticated;
create policy conversations_select on central.conversations for select to authenticated
  using (organization_id = central.current_organization_id() and central.ca_current_role() in ('admin','director'));
create policy conversations_select_membro on central.conversations for select to authenticated
  using (inbox_id in (select central.ca_minhas_inboxes()));

insert into central.organizations values ('${ORG}'), ('${OUTRA}');
insert into central.inboxes values ('${CAIXA_A}', '${ORG}'), ('${CAIXA_B}', '${ORG}');
insert into central.conversations values ('${CONV_A}', '${ORG}', '${CAIXA_A}'), ('${CONV_B}', '${ORG}', '${CAIXA_B}');
insert into public.usuarios values
  ('${JEN}',   'Jeniffer',          true, '${ORG}',   'operator'),
  ('${DANI}',  'Danielle Menezes',  true, '${ORG}',   'operator'),
  ('${BETO}',  'Beto',              true, '${ORG}',   'operator'),
  ('${DIR}',   'Diretora',          true, '${ORG}',   'director'),
  ('${FORA}',  'Outra Clínica',     true, '${OUTRA}', 'director'),
  ('${SEMCA}', 'Sem Central',       true, '${ORG}',   null);
insert into central.inbox_members(organization_id, inbox_id, user_id) values
  ('${ORG}', '${CAIXA_A}', '${JEN}'), ('${ORG}', '${CAIXA_A}', '${DANI}'), ('${ORG}', '${CAIXA_B}', '${BETO}');
`)

console.log('1. migration executa (e reexecuta)')
await db.exec(mig)
ok(true, 'primeira execução')
await db.exec(mig)
ok(true, 'segunda execução (idempotente)')

async function como(papel, uid = '') {
  await db.exec(`reset role; set request.jwt.claim.sub = '${uid}'; set role ${papel};`)
}

console.log('2. service_role grava (é o caminho da API)')
await como('service_role')
const nota = (await db.query(`
  insert into central.conversation_notes(organization_id, conversation_id, author_user_id, body, mentioned_user_ids, delegated_to_user_id)
  values ($1, $2, $3, '@Danielle Menezes pode assumir?', array[$4]::uuid[], $4) returning id`,
  [ORG, CONV_A, JEN, DANI])).rows[0].id
await db.query(`insert into central.conversation_mentions(organization_id, note_id, conversation_id, mentioned_user_id, author_user_id)
  values ($1, $2, $3, $4, $5)`, [ORG, nota, CONV_A, DANI, JEN])
// Menção a Beto numa conversa que ele NÃO vê (caixa A) — a API recusaria;
// gravada aqui à força para provar que a RLS não a mostraria mesmo assim.
await db.query(`insert into central.conversation_mentions(organization_id, note_id, conversation_id, mentioned_user_id, author_user_id)
  values ($1, $2, $3, $4, $5)`, [ORG, nota, CONV_A, BETO, JEN])
ok(true, 'nota e menções gravadas')

console.log('3. constraints')
ok(await erro(`insert into central.conversation_notes(organization_id, conversation_id, author_user_id, body) values ($1,$2,$3,'   ')`,
  [ORG, CONV_A, JEN]), 'nota em branco é recusada')
ok(await erro(`insert into central.conversation_notes(organization_id, conversation_id, author_user_id, body) values ($1,$2,$3,repeat('x', 4001))`,
  [ORG, CONV_A, JEN]), 'nota acima de 4000 caracteres é recusada')
ok(await erro(`insert into central.conversation_notes(organization_id, conversation_id, author_user_id, body, mentioned_user_ids, delegated_to_user_id)
  values ($1,$2,$3,'x', '{}', $4)`, [ORG, CONV_A, JEN, DANI]), 'delegar a quem não foi mencionado é recusado')
ok(!(await erro(`insert into central.conversation_mentions(organization_id, note_id, conversation_id, mentioned_user_id, author_user_id)
  values ($1,$2,$3,$4,$4)`, [ORG, nota, CONV_A, JEN])), 'mencionar a si mesmo é aceito (lembrete)')
// Sai de novo para não mexer nas contagens dos blocos seguintes.
await db.query(`delete from central.conversation_mentions where mentioned_user_id = $1`, [JEN])
ok(await erro(`insert into central.conversation_mentions(organization_id, note_id, conversation_id, mentioned_user_id, author_user_id)
  values ($1,$2,$3,$4,$5)`, [ORG, nota, CONV_A, DANI, JEN]), 'a mesma pessoa duas vezes na mesma nota é recusada')

console.log('4. anon')
await como('anon')
ok(await erro(`select * from central.conversation_notes`), 'anon não lê notas')
ok(await erro(`select * from central.conversation_mentions`), 'anon não lê menções')

console.log('5. authenticated não grava nada direto')
await como('authenticated', JEN)
ok(await erro(`insert into central.conversation_notes(organization_id, conversation_id, author_user_id, body) values ($1,$2,$3,'direto')`,
  [ORG, CONV_A, JEN]), 'não insere nota')
ok(await erro(`insert into central.conversation_mentions(organization_id, note_id, conversation_id, mentioned_user_id, author_user_id)
  values ($1,$2,$3,$4,$5)`, [ORG, nota, CONV_A, DIR, JEN]), 'não insere menção')
ok(await erro(`delete from central.conversation_notes`), 'não apaga nota')
await como('authenticated', DANI)
ok(await erro(`update central.conversation_mentions set lida_em = now()`), 'nem a mencionada marca como lida direto (só pela API)')
ok(await erro(`update central.conversation_notes set body = 'trocado'`), 'não edita nota')

console.log('6. quem lê a nota')
const notas = async uid => { await como('authenticated', uid); return (await db.query(`select count(*)::int n from central.conversation_notes`)).rows[0].n }
ok(await notas(JEN) === 1,   'autora (membro da caixa A) lê')
ok(await notas(DANI) === 1,  'colega da caixa A lê')
ok(await notas(DIR) === 1,   'director da organização lê sem ser membro')
ok(await notas(BETO) === 0,  'operator de OUTRA caixa não lê')
ok(await notas(FORA) === 0,  'director de outra organização não lê')
ok(await notas(SEMCA) === 0, 'usuário sem papel na Central não lê')

console.log('7. quem lê a menção')
const mencoes = async uid => { await como('authenticated', uid); return (await db.query(`select mentioned_user_id from central.conversation_mentions`)).rows }
let m = await mencoes(DANI)
ok(m.length === 1 && m[0].mentioned_user_id === DANI, 'Danielle vê só a menção a ela')
ok((await mencoes(JEN)).length === 0,  'a autora não vê as menções aos outros')
ok((await mencoes(DIR)).length === 0,  'director não vê menção de ninguém')
ok((await mencoes(BETO)).length === 0, 'menção a quem não vê a conversa fica invisível')
ok((await mencoes(FORA)).length === 0, 'outra organização não vê')

console.log('8. perder a caixa apaga o aviso')
await como('service_role')
await db.query(`delete from central.inbox_members where user_id = $1`, [DANI])
ok((await mencoes(DANI)).length === 0, 'sem a caixa, Danielle não vê mais a menção')
ok(await notas(DANI) === 0, 'nem a nota')
await como('service_role')
await db.query(`insert into central.inbox_members(organization_id, inbox_id, user_id) values ($1,$2,$3)`, [ORG, CAIXA_A, DANI])
ok((await mencoes(DANI)).length === 1, 'devolvida a caixa, a menção volta')

console.log('9. índice de não lidas e marcação pela API (service_role)')
await como('service_role')
await db.query(`update central.conversation_mentions set lida_em = now() where mentioned_user_id = $1 and conversation_id = $2`, [DANI, CONV_A])
await como('authenticated', DANI)
const naoLidas = (await db.query(`select count(*)::int n from central.conversation_mentions where lida_em is null`)).rows[0].n
ok(naoLidas === 0, 'marcada como lida pela API, sai das não lidas')

console.log('10. apagar a conversa leva notas e menções')
await como('service_role')
await db.query(`delete from central.conversations where id = $1`, [CONV_A])
const sobra = (await db.query(`select (select count(*) from central.conversation_notes)::int n, (select count(*) from central.conversation_mentions)::int m`)).rows[0]
ok(sobra.n === 0 && sobra.m === 0, 'cascade limpa as duas tabelas')

await db.exec('reset role')
await db.close()
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo ok')
process.exit(falhas ? 1 : 0)
