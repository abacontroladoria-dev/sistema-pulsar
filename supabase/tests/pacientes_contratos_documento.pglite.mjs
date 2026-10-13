// Teste da migration 20261009160000 (número, valores, Termo de imagem) no
// PGlite, por cima da 20261008160000.
//
// Prova: os contratos que já existiam ganham número em ordem; contrato novo é
// numerado; o Termo exige contrato de Terapias do MESMO paciente e herda o
// vencimento dele; autorizações guardam só as 5 chaves; valores fora da faixa
// são recusados; a tela antiga (5 parâmetros) continua funcionando; anon não
// executa as RPCs novas.
//
// Rodar FORA do repo (o pacote não é dependência do projeto):
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   cp <repo>/supabase/tests/pacientes_contratos_documento.pglite.mjs .
//   node pacientes_contratos_documento.pglite.mjs \
//     <repo>/supabase/migrations/20261008160000_pacientes_contratos.sql \
//     <repo>/supabase/migrations/20261009160000_pacientes_contratos_documento.sql
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'

const [, , migBase, migDoc] = process.argv
const base = readFileSync(migBase, 'utf8')
const doc = readFileSync(migDoc, 'utf8')

let falhas = 0
const ok = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { falhas++; console.log('  FALHA', msg) } }

const db = new PGlite()
async function erro(sql, params = []) {
  try { await db.query(sql, params); return null } catch (e) { return e }
}
async function como(papel, uid) {
  await db.exec(`reset role; set request.jwt.claim.sub = '${uid ?? ''}'; set role ${papel};`)
}

const A = '00000000-0000-0000-0000-00000000000a' // cadastros_pacientes

await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id bigint generated always as identity primary key, bucket_id text);
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create table public.usuarios(id uuid primary key, nome text, role text, ativo boolean default true);
create table public.usuarios_permissoes(usuario_id uuid, permissao_codigo text, permitido boolean);
create table public.pacientes(id_paciente bigint primary key, nome text);
create table public.responsaveis(id bigint primary key, nome text);
create function public.set_atualizado_em() returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end $$;
create or replace function public.sp_pac_disp_imutavel() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception '% é histórico imutável: % não é permitido', tg_table_name, tg_op using errcode = '42501';
end $$;
create or replace function public.usuario_tem_permissao(p_codigo text) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.usuarios_permissoes up join public.usuarios u on u.id = up.usuario_id
                 where up.usuario_id = auth.uid() and up.permissao_codigo = p_codigo and up.permitido and u.ativo) $$;
revoke all on function public.usuario_tem_permissao(text) from public, anon;
grant execute on function public.usuario_tem_permissao(text) to authenticated;

insert into public.usuarios values ('${A}', 'Ana Cadastro', 'recepcao', true);
insert into public.usuarios_permissoes values ('${A}', 'cadastros_pacientes', true);
insert into public.pacientes values (1, 'Paciente Um'), (2, 'Paciente Dois');
`)

console.log('1. base + contratos antigos + migration nova')
await db.exec(base)
await db.exec(`
insert into public.pacientes_contratos (paciente_id, tipo, data_inicio, data_vencimento) values
  (1, 'terapias', '2026-01-01', '2026-12-31'),
  (2, 'terapias', '2026-02-01', '2027-01-31'),
  (1, 'avaliacao_neuropsicologica', '2026-03-01', '2026-06-01');
`)
await db.exec(doc)
ok(true, 'executa')
await db.exec(doc)
ok(true, 'reexecuta (idempotente)')
const antigos = await db.query(`select id, numero from public.pacientes_contratos order by id`)
ok(antigos.rows.map((r) => r.numero).join(',') === 'ABA-TMP-03-00001,ABA-TMP-03-00002,ABA-TMP-03-00003',
  'antigos numerados em ordem de criação: ' + antigos.rows.map((r) => r.numero).join(','))
const sobrecargas = await db.query(`select count(*)::int n from pg_proc where proname in ('contratos_criar', 'contratos_editar_rascunho')`)
ok(sobrecargas.rows[0].n === 2, 'uma versão só de cada RPC (sem sobrecarga velha)')

console.log('2. criar e editar com os campos novos (A)')
await como('authenticated', A)
const neuro = await db.query(`select * from public.contratos_criar(1, 'avaliacao_neuropsicologica', '2026-10-09', '2027-01-09', null,
  1755, 10, 200, null, '{"site": true, "redes": "true", "lixo": 1, "primeiro_nome": true}')`)
const n = neuro.rows[0]
ok(n.numero === 'ABA-TMP-03-00004', 'contrato novo numerado: ' + n.numero)
ok(Number(n.valor_total) === 1755 && n.sessoes_max === 10 && Number(n.valor_sessao_avulsa) === 200, 'valores gravados')
ok(JSON.stringify(n.autorizacoes_imagem) === JSON.stringify({ site: true, redes: true, ensino: false, impressos: false, primeiro_nome: false }),
  'autorizações: só as 5 chaves; primeiro_nome só no Termo: ' + JSON.stringify(n.autorizacoes_imagem))
ok(n.contrato_vinculado_id === null, 'neuro sem vínculo')

const velha = await db.query(`select * from public.contratos_criar(p_paciente_id => 1, p_tipo => 'terapias',
  p_data_inicio => '2026-10-09', p_data_vencimento => '2027-10-08', p_observacao => null)`)
ok(velha.rows[0].numero === 'ABA-TMP-03-00005' && velha.rows[0].autorizacoes_imagem === null,
  'chamada da tela antiga (5 parâmetros nomeados) ainda funciona; Terapias sem autorizações')
const terapias1 = velha.rows[0].id

let e = await erro(`select public.contratos_criar(1, 'avaliacao_neuropsicologica', '2026-10-09', '2027-01-09', null, 0)`)
ok(e && /pac_contratos_valores_check/.test(e.message), 'valor zero recusado')
e = await erro(`select public.contratos_criar(1, 'avaliacao_neuropsicologica', '2026-10-09', '2027-01-09', null, 100, 500)`)
ok(e && /pac_contratos_valores_check/.test(e.message), 'sessões fora de 1..100 recusado')

console.log('3. Termo de uso de imagem')
e = await erro(`select public.contratos_criar(1, 'termo_uso_imagem', '2026-10-09', '2027-10-08', null)`)
ok(e && /Escolha o contrato de Terapias/.test(e.message), 'Termo sem vínculo recusado')
e = await erro(`select public.contratos_criar(1, 'termo_uso_imagem', '2026-10-09', '2027-10-08', null, null, null, null, $1)`, [n.id])
ok(e && /só se vincula a um contrato de Terapias/.test(e.message), 'Termo vinculado a Neuro recusado')
e = await erro(`select public.contratos_criar(1, 'termo_uso_imagem', '2026-10-09', '2027-10-08', null, null, null, null, 2)`)
ok(e && /só se vincula a um contrato de Terapias/.test(e.message), 'Termo vinculado a Terapias de OUTRO paciente recusado')
const termo = await db.query(`select * from public.contratos_criar(1, 'termo_uso_imagem', '2026-10-09', '2099-01-01', null,
  null, null, null, $1, '{"ensino": true, "primeiro_nome": true}')`, [terapias1])
const t = termo.rows[0]
ok(t.contrato_vinculado_id === terapias1, 'Termo vinculado ao Terapias do paciente')
ok(new Date(t.data_vencimento).toISOString().slice(0, 10) === '2027-10-08', 'vencimento do Termo = o do Terapias (ignora o enviado)')
ok(t.autorizacoes_imagem.primeiro_nome === true && t.autorizacoes_imagem.ensino === true, 'Termo guarda primeiro_nome')

const ed = await db.query(`select * from public.contratos_editar_rascunho($1, 'avaliacao_neuropsicologica', '2026-10-09', '2027-01-09', null,
  1800, 8, 250, $2, null)`, [n.id, terapias1])
ok(Number(ed.rows[0].valor_total) === 1800 && ed.rows[0].contrato_vinculado_id === null && ed.rows[0].numero === n.numero,
  'edição: valores mudam, vínculo ignorado fora do Termo, número fica')
ok(JSON.stringify(ed.rows[0].autorizacoes_imagem) === JSON.stringify({ site: false, redes: false, ensino: false, impressos: false, primeiro_nome: false }),
  'edição sem autorizações = todas NÃO AUTORIZO')
e = await erro(`select public.contratos_editar_rascunho($1, 'termo_uso_imagem', '2026-10-09', '2027-10-08', null, null, null, null, $1)`, [t.id])
ok(e && /si mesmo/.test(e.message), 'Termo não se vincula a si mesmo')
const ev = await db.query(`select detalhe from public.pacientes_contratos_eventos where contrato_id = $1 and tipo = 'criado'`, [n.id])
ok(ev.rows[0].detalhe.numero === n.numero && Number(ev.rows[0].detalhe.valor_total) === 1755, 'evento "criado" registra número e valor')

console.log('4. acesso')
await como('anon', null)
e = await erro(`select public.contratos_criar(1, 'terapias', '2026-10-09', '2027-10-08')`)
ok(e && /permission denied/.test(e.message), 'anon não executa contratos_criar')
e = await erro(`select public.sp_contratos_formatar_numero(1)`)
ok(e && /permission denied/.test(e.message), 'anon não executa sp_contratos_formatar_numero')
await como('service_role', null)
const sr = await db.query(`insert into public.pacientes_contratos (paciente_id, tipo, data_inicio, data_vencimento)
  values (2, 'terapias', '2026-10-09', '2027-10-08') returning numero`)
ok(/^ABA-TMP-03-\d{5}$/.test(sr.rows[0].numero), 'service_role insere e o default numera: ' + sr.rows[0].numero)
await db.exec('reset role')
e = await erro(`delete from public.pacientes where id_paciente = 1`)
ok(!e, 'paciente apagado leva Terapias e o Termo vinculado juntos: ' + (e?.message ?? ''))

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK')
process.exitCode = falhas ? 1 : 0
