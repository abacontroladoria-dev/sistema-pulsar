// Teste de segurança/execução da migration 20261015160000 (prazos do Painel de
// Entrada) no PGlite (Postgres de verdade em Node, sem Docker).
//
// Prova: a migration roda e reroda sem duplicar o seed; anon e authenticated não
// leem as tabelas nem executam as RPCs; só service_role altera, e só em nome de
// admin/diretoria ativo; prazo fora de 0–60, motivo curto, etapa desconhecida e
// prazo igual são recusados sem gravar; o histórico guarda autor, meta, resumo,
// impacto e os prazos vigentes, e não aceita UPDATE nem DELETE.
//
// Rodar FORA do repo (o pacote não é dependência do projeto):
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   node <repo>/supabase/tests/painel_entrada_prazos.pglite.mjs <repo>/supabase/migrations/20261015160000_painel_entrada_prazos.sql
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

const ADMIN = '00000000-0000-0000-0000-0000000000a1'
const DIRETORIA = '00000000-0000-0000-0000-0000000000d1'
const RECEPCAO = '00000000-0000-0000-0000-0000000000e1' // tem a permissão do painel, mas não altera
const INATIVO = '00000000-0000-0000-0000-0000000000f1'  // admin desativado

await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '') $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create table public.usuarios(id uuid primary key, nome text, email text, role text, ativo boolean default true);
create table public.usuarios_permissoes(usuario_id uuid, permissao_codigo text, permitido boolean);
create or replace function public.usuario_tem_permissao(p_codigo text) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.ativo and u.role in ('admin','diretoria'))
  or exists (select 1 from public.usuarios_permissoes up join public.usuarios u on u.id = up.usuario_id
             where up.usuario_id = auth.uid() and up.permissao_codigo = p_codigo and up.permitido and u.ativo) $$;
revoke all on function public.usuario_tem_permissao(text) from public, anon;
grant execute on function public.usuario_tem_permissao(text) to authenticated;

insert into public.usuarios values
  ('${ADMIN}', 'Ana Admin', 'ana@exemplo.com', 'admin', true),
  ('${DIRETORIA}', 'Davi Diretor', 'davi@exemplo.com', 'diretoria', true),
  ('${RECEPCAO}', 'Rita Recepção', 'rita@exemplo.com', 'recepcao', true),
  ('${INATIVO}', 'Ivo Inativo', 'ivo@exemplo.com', 'admin', false);
insert into public.usuarios_permissoes values ('${RECEPCAO}', 'indicadores_entrada_convenio', true);
`)

console.log('1. migration executa (e reexecuta)')
await db.exec(mig)
ok(true, 'primeira execução')
await db.exec(mig)
ok(true, 'segunda execução (idempotente)')
const seed = await db.query(`select count(*)::int n, sum(prazo)::int meta from public.painel_entrada_convenio_prazos`)
ok(seed.rows[0].n === 8 && seed.rows[0].meta === 19, 'seed com as 8 etapas do calc v4 (meta 19), sem duplicar')

async function como(papel, uid = '', role = '') {
  await db.exec(`reset role; set request.jwt.claim.sub = '${uid}'; set request.jwt.claim.role = '${role}'; set role ${papel};`)
}
const alterar = (etapa, prazo, motivo, uid, impacto = '{}') =>
  db.query(`select public.painel_entrada_convenio_alterar_prazo($1, $2, $3, $4::uuid, $5::jsonb) r`, [etapa, prazo, motivo, uid, impacto])
const MOTIVO = 'Reunião de 15/10: operadora leva 2 dias para responder'

console.log('2. anon')
await como('anon')
for (const t of ['painel_entrada_convenio_prazos', 'painel_entrada_convenio_prazos_historico']) {
  ok(await erro(`select * from public.${t}`), `anon não lê ${t}`)
}
ok(await erro(`select public.painel_entrada_convenio_prazos()`), 'anon não lê os prazos pela RPC')
ok(await erro(`select public.painel_entrada_convenio_alterar_prazo('E1', 2, '${MOTIVO}', '${ADMIN}'::uuid, '{}'::jsonb)`), 'anon não altera')

console.log('3. authenticated (mesmo admin) não fura a rota')
await como('authenticated', ADMIN, 'authenticated')
ok(await erro(`select * from public.painel_entrada_convenio_prazos`), 'authenticated não lê a tabela de prazos')
ok(await erro(`select * from public.painel_entrada_convenio_prazos_historico`), 'authenticated não lê o histórico direto')
ok(await erro(`update public.painel_entrada_convenio_prazos set prazo = 9 where etapa = 'E1'`), 'authenticated não altera a tabela direto')
ok(await erro(`select public.painel_entrada_convenio_alterar_prazo('E1', 2, '${MOTIVO}', '${ADMIN}'::uuid, '{}'::jsonb)`),
  'authenticated não executa a RPC de alteração (só a rota, com service_role)')
ok(await erro(`select public.painel_entrada_convenio_prazos()`), 'authenticated não executa a RPC de leitura')

console.log('4. service_role: segunda tranca do papel')
await como('service_role', '', 'service_role')
let e = await erro(`select public.painel_entrada_convenio_alterar_prazo('E1', 2, '${MOTIVO}', '${RECEPCAO}'::uuid, '{}'::jsonb)`)
ok(e && /Direção e Admin/.test(e.message), 'recepção (com acesso ao painel) não altera')
e = await erro(`select public.painel_entrada_convenio_alterar_prazo('E1', 2, '${MOTIVO}', '${INATIVO}'::uuid, '{}'::jsonb)`)
ok(e && /Direção e Admin/.test(e.message), 'admin inativo não altera')
e = await erro(`select public.painel_entrada_convenio_alterar_prazo('E1', 2, '${MOTIVO}', null, '{}'::jsonb)`)
ok(e && /Direção e Admin/.test(e.message), 'sem usuário (localhost sem login) não altera')

console.log('5. validações')
ok(/0 e 60/.test((await erro(`select public.painel_entrada_convenio_alterar_prazo('E1', 61, '${MOTIVO}', '${ADMIN}'::uuid, '{}'::jsonb)`))?.message ?? ''), 'prazo acima de 60 recusado')
ok(/0 e 60/.test((await erro(`select public.painel_entrada_convenio_alterar_prazo('E1', -1, '${MOTIVO}', '${ADMIN}'::uuid, '{}'::jsonb)`))?.message ?? ''), 'prazo negativo recusado')
ok(/motivo/.test((await erro(`select public.painel_entrada_convenio_alterar_prazo('E1', 2, '  curto  ', '${ADMIN}'::uuid, '{}'::jsonb)`))?.message ?? ''), 'motivo curto recusado')
ok(/desconhecida/.test((await erro(`select public.painel_entrada_convenio_alterar_prazo('E9', 2, '${MOTIVO}', '${ADMIN}'::uuid, '{}'::jsonb)`))?.message ?? ''), 'etapa desconhecida recusada')
ok(/já é/.test((await erro(`select public.painel_entrada_convenio_alterar_prazo('E1', 1, '${MOTIVO}', '${ADMIN}'::uuid, '{}'::jsonb)`))?.message ?? ''), 'prazo igual ao vigente recusado')
let n = (await db.query(`select count(*)::int n from public.painel_entrada_convenio_prazos_historico`)).rows[0].n
ok(n === 0, 'nenhuma recusa gravou histórico')
ok((await db.query(`select prazo from public.painel_entrada_convenio_prazos where etapa = 'E1'`)).rows[0].prazo === 1, 'nenhuma recusa mudou o prazo')

console.log('6. alteração válida')
const impacto = JSON.stringify({ snapshot_gerado_em: '2026-10-09', agora_antes: { atrasados: 12 }, agora_depois: { atrasados: 9 } })
let r = (await alterar('E1', 2, `  ${MOTIVO}  `, DIRETORIA, impacto)).rows[0].r
ok(r.meta === 20 && /Elegibilidade \(Etapa 1\): 1 → 2 dias úteis · meta 19 → 20 dias úteis/.test(r.resumo), 'devolve meta nova e resumo legível')
ok((await db.query(`select prazo, atualizado_por from public.painel_entrada_convenio_prazos where etapa = 'E1'`)).rows[0].prazo === 2, 'prazo vigente atualizado')
let h = (await db.query(`select * from public.painel_entrada_convenio_prazos_historico order by id desc limit 1`)).rows[0]
ok(h.prazo_anterior === 1 && h.prazo_novo === 2 && h.prazo_padrao === 1, 'histórico: antes, depois e padrão')
ok(h.meta_anterior === 19 && h.meta_nova === 20, 'histórico: meta antes e depois')
ok(h.usuario_nome === 'Davi Diretor' && h.usuario_email === 'davi@exemplo.com' && h.usuario_role === 'diretoria', 'histórico: autor lido do banco')
ok(h.motivo === MOTIVO, 'histórico: motivo sem espaços nas pontas')
ok(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/.test(h.alterado_em_brasilia), 'histórico: data e hora de Brasília legíveis')
ok(h.impacto?.agora_depois?.atrasados === 9, 'histórico: impacto guardado')
ok(h.prazos_vigentes?.E1 === 2 && h.prazos_vigentes?.E3 === 5 && Object.keys(h.prazos_vigentes).length === 8, 'histórico: os 8 prazos vigentes')

r = (await alterar('E1', 1, 'Voltando ao padrão do fluxo v4 após teste', ADMIN, '"texto"')).rows[0].r
ok(r.meta === 19, 'voltar ao padrão também é uma alteração registrada')
h = (await db.query(`select * from public.painel_entrada_convenio_prazos_historico order by id desc limit 1`)).rows[0]
ok(h.usuario_role === 'admin' && JSON.stringify(h.impacto) === '{}', 'impacto que não é objeto vira {}')

console.log('7. histórico imutável')
ok(await erro(`update public.painel_entrada_convenio_prazos_historico set motivo = 'apagando rastro' where id = 1`), 'service_role não edita o histórico')
ok(await erro(`delete from public.painel_entrada_convenio_prazos_historico`), 'service_role não apaga o histórico')
await db.exec('reset role')
ok(await erro(`update public.painel_entrada_convenio_prazos_historico set motivo = 'apagando rastro' where id = 1`), 'nem o dono edita (trigger)')
ok(await erro(`delete from public.painel_entrada_convenio_prazos_historico where id = 1`), 'nem o dono apaga (trigger)')

console.log('8. leitura (service_role)')
await como('service_role', '', 'service_role')
const leitura = (await db.query(`select public.painel_entrada_convenio_prazos() p`)).rows[0].p
ok(leitura.vigentes.length === 8 && leitura.vigentes[0].etapa === 'E0', 'vigentes em ordem de etapa')
ok(leitura.historico.length === 2 && leitura.historico[0].prazo_novo === 1, 'histórico completo, mais recente primeiro')

await db.exec('reset role')
await db.close()
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo ok')
process.exit(falhas ? 1 : 0)
