// Teste da migration 20261016110000 (CPF e carteirinha mascarados no log da
// importação de pacientes) no PGlite.
//
// Prova: o histórico já gravado é mascarado (CPF do paciente, do responsável e
// carteirinha), os outros campos ficam intactos, a migration reroda sem
// mascarar de novo, e o gatilho mascara o que entra depois.
//
// Rodar FORA do repo:
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   cp <repo>/supabase/tests/seguranca_log_pacientes_mascarado.pglite.mjs /tmp/pg/
//   node /tmp/pg/seguranca_log_pacientes_mascarado.pglite.mjs <repo>/supabase/migrations/20261016110000_seguranca_log_pacientes_mascarado.sql
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'
const db = new PGlite()
let f = 0; const ok = (c, m) => { console.log(c ? '  ok  ' : '  FALHA', m); if (!c) f++ }
await db.exec(`create role anon; create role authenticated;
create function public.usuario_tem_permissao(p text) returns boolean language sql as $$ select false $$;
create table public.pacientes_importacoes_log (id uuid primary key default gen_random_uuid(), detalhes jsonb);
insert into public.pacientes_importacoes_log (detalhes) values
 ('{"novos":[{"id":1,"nome":"Ana","cpf":"12345678901"},{"id":2,"nome":"Bia","cpf":null}],
   "atualizados":[{"id":3,"nome":"Caio","campos":["CPF"],"mudancas":[{"campo":"CPF","de":null,"para":"98765432100"},
     {"campo":"CPF do responsável","de":"111.222.333-44","para":"55566677788"},{"campo":"Carteirinha","de":"0012 3456 7890","para":"99998888"},
     {"campo":"Nome","de":"Caio","para":"Caio S"}]}]}');`)
const mig = readFileSync(process.argv[2], 'utf8')
await db.exec(mig); await db.exec(mig)
const d = (await db.query(`select detalhes from public.pacientes_importacoes_log`)).rows[0].detalhes
ok(d.novos[0].cpf === '***.456.789-**' && d.novos[1].cpf === null, `novos: ${JSON.stringify(d.novos.map(n => n.cpf))}`)
const m = d.atualizados[0].mudancas
ok(m[0].para === '***.654.321-**' && m[0].de === null, 'CPF de→para')
ok(m[1].de === '***.222.333-**' && m[1].para === '***.666.777-**', 'CPF do responsável')
ok(m[2].de === '••••7890' && m[2].para === '••••8888', 'carteirinha')
ok(m[3].para === 'Caio S', 'outros campos intactos')
ok(!/12345678901|98765432100|55566677788/.test(JSON.stringify(d)), 'nenhum CPF inteiro sobrou')
await db.exec(`insert into public.pacientes_importacoes_log (detalhes) values ('{"novos":[{"cpf":"10020030040"}]}')`)
const n = (await db.query(`select detalhes from public.pacientes_importacoes_log`)).rows
ok(JSON.stringify(n).includes('***.200.300-**') && !JSON.stringify(n).includes('10020030040'), 'gatilho mascara o que entra')
process.exit(f ? 1 : 0)
