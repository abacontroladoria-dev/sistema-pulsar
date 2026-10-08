// Teste da migration 20261008170000 (grade_pacientes_com_terapia_real) no
// PGlite. Decisão do usuário (08/10/2026): "Sem contrato" não cobra de quem só
// teve Triagem na grade.
//
// Prova: terapia_nome nulo não conta como "real" (seria assumir tratamento sem
// provas); comparação de Triagem ignora caixa e espaço; fora da unidade 280
// não entra; authenticated e anon não executam a função.
//
// Rodar FORA do repo (o pacote não é dependência do projeto):
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   cp <repo>/supabase/tests/grade_pacientes_com_terapia_real.pglite.mjs .
//   node grade_pacientes_com_terapia_real.pglite.mjs \
//     <repo>/supabase/migrations/20261008170000_grade_pacientes_com_terapia_real.sql

import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'

const [, , migPath] = process.argv
const mig = readFileSync(migPath, 'utf8')
const db = new PGlite()
let falhas = 0
const ok = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { falhas++; console.log('  FALHA', msg) } }

await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create table public.vw_grade_atendimentos_src (paciente_id bigint, terapia_nome text, unidade_id int);
create view public.vw_grade_atendimentos as select * from public.vw_grade_atendimentos_src;
insert into public.vw_grade_atendimentos_src values
  (1, 'Triagem', 280),
  (2, 'Fonoaudiologia', 280),
  (3, 'triagem', 280), (3, '  TRIAGEM  ', 280),
  (4, 'Fonoaudiologia', 999),
  (5, null, 280);
`)
await db.exec(mig)
await db.exec(mig) // idempotente

const r = await db.query('select paciente_id from public.grade_pacientes_com_terapia_real() order by paciente_id')
const ids = r.rows.map((x) => Number(x.paciente_id))
ok(
  JSON.stringify(ids) === JSON.stringify([2]),
  'só paciente 2 (terapia real); 1/3 só Triagem, 4 fora da unidade, 5 sem terapia_nome: ' + JSON.stringify(ids),
)

await db.exec('reset role; set role authenticated;')
try {
  await db.query('select * from public.grade_pacientes_com_terapia_real()')
  falhas++
  console.log('  FALHA authenticated executou')
} catch (e) {
  ok(/permission denied/.test(e.message), 'authenticated não executa')
}

await db.exec('reset role; set role anon;')
try {
  await db.query('select * from public.grade_pacientes_com_terapia_real()')
  falhas++
  console.log('  FALHA anon executou')
} catch (e) {
  ok(/permission denied/.test(e.message), 'anon não executa')
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK')
process.exitCode = falhas ? 1 : 0
