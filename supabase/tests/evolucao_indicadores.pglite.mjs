// Teste das migrations 20261021160000 (ocupacao_clinica_historico_resumo) e
// 20261021160100 (pacientes_historico_resumo) no PGlite. Prova, para as duas:
// anon não lê nem grava; login sem a permissão da aba lê 0 linhas; login com a
// permissão lê; login (mesmo com permissão) não grava; service_role grava;
// a migration reroda.
//
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   cp <repo>/supabase/tests/evolucao_indicadores.pglite.mjs /tmp/pg/
//   node /tmp/pg/evolucao_indicadores.pglite.mjs <repo>/supabase/migrations/20261021160000_ocupacao_clinica_historico_resumo.sql <repo>/supabase/migrations/20261021160100_pacientes_historico_resumo.sql
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'
const db = new PGlite()
let f = 0; const ok = (c, m) => { console.log(c ? '  ok  ' : '  FALHA', m); if (!c) f++ }

await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated;
create function public.usuario_tem_permissao(p text) returns boolean language sql stable as
  $$ select p = any(string_to_array(coalesce(current_setting('teste.perms', true), ''), ',')) $$;
grant execute on function public.usuario_tem_permissao(text) to authenticated;`)

for (const arq of process.argv.slice(2)) { const sql = readFileSync(arq, 'utf8'); await db.exec(sql); await db.exec(sql) }

await db.exec(`insert into public.ocupacao_clinica_historico_resumo (competencia, unidade, total, paciente, status, snapshot_data)
  values ('2026-09', '__rede__', 100, 60, 'aproximado', '2026-10-21');
insert into public.pacientes_historico_resumo (competencia, segmento, unidade, pacientes, sessoes, horas, status, snapshot_data)
  values ('2026-08', 'multidisciplinar', '__total__', 500, 10939, 7292.67, 'fechado', '2026-10-21');`)

const como = async (papel, perms, sql) => {
  await db.exec(`set teste.perms = '${perms}'; set role ${papel};`)
  try { return { rows: (await db.query(sql)).rows } } catch (e) { return { erro: e.message } } finally { await db.exec('reset role') }
}
const casos = [
  ['ocupacao_clinica_historico_resumo', 'indicadores_ocupacao_unidades',
    `insert into public.ocupacao_clinica_historico_resumo (competencia, unidade, status, snapshot_data) values ('2026-10','Realengo','parcial','2026-10-21')`],
  ['pacientes_historico_resumo', 'indicadores_pacientes',
    `insert into public.pacientes_historico_resumo (competencia, segmento, unidade, status, snapshot_data) values ('2026-10','diagnostico','Realengo','parcial','2026-10-21')`],
]
for (const [t, perm, ins] of casos) {
  ok(!!(await como('anon', '', `select * from public.${t}`)).erro, `${t}: anon não lê`)
  ok(!!(await como('anon', '', ins)).erro, `${t}: anon não grava`)
  ok((await como('authenticated', '', `select * from public.${t}`)).rows?.length === 0, `${t}: login sem a permissão lê 0 linhas`)
  ok((await como('authenticated', 'outra_tela', `select * from public.${t}`)).rows?.length === 0, `${t}: permissão de outra tela lê 0 linhas`)
  ok((await como('authenticated', perm, `select * from public.${t}`)).rows?.length === 1, `${t}: com a permissão da aba lê`)
  ok(!!(await como('authenticated', perm, ins)).erro, `${t}: login com permissão NÃO grava`)
  ok(!(await como('service_role', '', ins)).erro, `${t}: service_role grava`)
}
const st = await como('service_role', '', `insert into public.pacientes_historico_resumo (competencia, segmento, unidade, status, snapshot_data) values ('2026-10','multidisciplinar','X','aproximado','2026-10-21')`)
ok(!!st.erro, 'pacientes: status "aproximado" é recusado (só a Ocupação usa)')
const comp = await como('service_role', '', `insert into public.ocupacao_clinica_historico_resumo (competencia, unidade, status, snapshot_data) values ('2026-13','X','parcial','2026-10-21')`)
ok(!!comp.erro, 'competência inválida é recusada')
process.exit(f ? 1 : 0)
