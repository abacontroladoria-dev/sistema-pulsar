// Teste da migration 20261016150000 (histórico pelo banco + vigência do
// convênio) no PGlite, por cima da importação de pacientes real (20261009100000)
// e da correção do convênio (20261016140000).
//
// Prova: a troca única vista na grade vira duas vigências (a antiga até a
// véspera da primeira sessão no convênio novo); troca de ida e volta e troca que
// não bate com o cadastro não são reconstruídas; convenio_do_paciente_em responde
// pela data; trocar o convênio fecha a vigência ontem e abre hoje, e corrigir no
// mesmo dia não cria outra; toda alteração de campo entra no histórico pelo
// banco (paciente e profissional), mudança só de situação não duplica, e a
// importação do TiTa registra autor e origem sem gravar uma segunda linha.
//
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   cp <repo>/supabase/tests/cadastro_historico_e_vigencia_convenio.pglite.mjs /tmp/pg/
//   node /tmp/pg/cadastro_historico_e_vigencia_convenio.pglite.mjs <repo>
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'fs'

const [, , repo] = process.argv
const migDir = `${repo}/supabase/migrations`
const arquivo = prefixo => readFileSync(`${migDir}/${readdirSync(migDir).find(f => f.startsWith(prefixo))}`, 'utf8')

let falhas = 0
const ok = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { falhas++; console.log('  FALHA', msg) } }
const db = new PGlite()
const um = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const todos = async (sql, p = []) => (await db.query(sql, p)).rows
const iso = d => (d instanceof Date ? d.toISOString().slice(0, 10) : d)

await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
create function public.hoje_brasilia() returns date language sql stable as $$ select current_date $$;
create table public.usuarios (id uuid primary key, nome text, role text, ativo boolean default true);
insert into public.usuarios values ('00000000-0000-0000-0000-0000000000e1', 'Rita Recepção', 'recepcao', true);
create function public.usuario_tem_permissao(p text) returns boolean language sql stable as $$ select false $$;
create function public.normalizar_nome_paciente(p text) returns text language sql immutable as $$ select lower(btrim(coalesce(p, ''))) $$;
create table public.alertas_regras (codigo text primary key, modulo text, nome text, setor_destino text, prioridade text, tolerancia_minutos int);
create table public.alertas (id uuid primary key default gen_random_uuid(), modulo text, regra_codigo text, origem text, entidade_tipo text,
  entidade_id text, entidade_ref jsonb, titulo text, descricao text, prioridade text, status text, setor_destino text, fingerprint text unique,
  atualizado_em timestamptz);
create table public.alertas_eventos (alerta_id uuid, entidade_tipo text, entidade_id text, tipo text, autor_tipo text, autor_nome text, descricao text);
create table public.cadastros_auditoria (id uuid primary key default gen_random_uuid(), tabela text, registro_id text, acao text,
  alvo_nome text, paciente_id bigint, paciente_nome text, convenio_nome text, resumo text, motivo text, usuario_id uuid, usuario_nome text,
  antes jsonb, depois jsonb, criado_em timestamptz default now());
create table public.convenios (id bigint generated always as identity primary key, nome text not null);
insert into public.convenios (nome) values ('Particular'), ('LEVE SAUDE'), ('ASSIM Saúde');
create table public.pacientes (
  id_paciente bigint generated always as identity primary key, tita_paciente_id bigint unique, nome text not null,
  cpf text, data_nascimento date, convenio_id bigint, convenio_nome text, numero_carteirinha text,
  responsavel_nome text, responsavel_cpf text, responsavel_email text, responsavel_telefone text,
  responsavel_parentesco text, responsavel_financeiro boolean, cep text, logradouro text, numero text,
  complemento text, bairro text, cidade text, uf text, ficticio boolean default false, ativo boolean default true,
  origem_cadastro text, sincronizado_em timestamptz, telefone text, id_usuario uuid, nome_usuario_responsavel text);
create table public.profissionais (id bigint generated always as identity primary key, nome text, celular text, ativo boolean default true,
  data_saida date, dados_tita jsonb, sincronizado_tita_em timestamptz);
create table public.agenda_tita (paciente_id bigint, paciente_nome text, cpf text, data_nascimento date, data_atendimento date,
  convenio_id bigint, convenio_nome text, numero_carteirinha text, responsavel_nome text, responsavel_email text,
  responsavel_telefone text, raw_json jsonb, ativo boolean default true);
create table public.csv_grades_profissionais (paciente_id bigint, paciente_nome text, convenio_nome text, data date,
  unidade_id int default 280, status_agendamento text default 'Agendado', ativo boolean default true);
`)

await db.exec(arquivo('20261009100000'))
await db.exec(`
insert into public.pacientes (tita_paciente_id, nome, convenio_nome) values
  (1, 'Xuxa Troca Única', 'LEVE SAUDE'), (2, 'Yara Vai e Volta', 'Particular'), (3, 'Zeca Grade Errada', 'ASSIM Saúde'),
  (4, 'Wil Sem Grade', 'Particular');
insert into public.profissionais (nome, celular) values ('Pedro Prof', '21999990000');
-- Grade: Xuxa Particular → LEVE (uma vez); Yara Particular → LEVE → Particular; Zeca Particular → LEVE (cadastro diz ASSIM).
insert into public.csv_grades_profissionais (paciente_id, paciente_nome, convenio_nome, data)
select 1, 'Xuxa', 'Particular', current_date - d from generate_series(30, 50, 7) d union all
select 1, 'Xuxa', 'LEVE SAUDE', current_date - d from generate_series(1, 20, 7) d union all
select 2, 'Yara', 'Particular', current_date - 40 union all select 2, 'Yara', 'LEVE SAUDE', current_date - 20 union all
select 2, 'Yara', 'Particular', current_date - 5 union all
select 3, 'Zeca', 'Particular', current_date - 40 union all select 3, 'Zeca', 'LEVE SAUDE', current_date - 10;
`)
await db.exec(arquivo('20261016140000'))
const mig = arquivo('20261016150000')
await db.exec(mig)
await db.exec(mig)
await db.exec(arquivo('20261016160000'))
ok(true, 'migrations rodam e reroda')

console.log('1. vigências da carga inicial')
const vig = async nome => todos(`select v.convenio_nome, v.vigente_de, v.vigente_ate, v.origem, v.convenio_nome_grade
  from public.pacientes_convenio_vigencias v join public.pacientes p on p.id_paciente = v.paciente_id where p.nome = $1
  order by v.vigente_de nulls first`, [nome])
const hoje = (await um(`select current_date d`)).d
const dia = n => iso(new Date(hoje.getTime() + n * 86400000))
let x = await vig('Xuxa Troca Única')
const primeiraLeve = (await um(`select min(data) d from public.csv_grades_profissionais where paciente_id = 1 and convenio_nome = 'LEVE SAUDE'`)).d
ok(x.length === 2 && x[0].convenio_nome === 'Particular' && x[0].vigente_de === null && iso(x[0].vigente_ate) === iso(new Date(primeiraLeve.getTime() - 86400000))
   && x[1].convenio_nome === 'LEVE SAUDE' && iso(x[1].vigente_de) === iso(primeiraLeve) && x[1].origem === 'reconstruido_da_grade',
  `Xuxa: Particular até a véspera da 1ª sessão LEVE, LEVE desde ela (${JSON.stringify(x.map(v => [v.convenio_nome, iso(v.vigente_de), iso(v.vigente_ate)]))})`)
let y = await vig('Yara Vai e Volta')
ok(y.length === 1 && y[0].origem === 'inicial', 'Yara (vai e volta): não reconstrói, fica com a vigência atual')
let z = await vig('Zeca Grade Errada')
ok(z.length === 1 && z[0].convenio_nome === 'ASSIM Saúde' && z[0].origem === 'inicial', 'Zeca (grade não bate com o cadastro): não reconstrói')
ok((await vig('Wil Sem Grade')).length === 1, 'Wil: vigência atual')

console.log('2. convênio numa data')
const xuxa = (await um(`select id_paciente from public.pacientes where nome = 'Xuxa Troca Única'`)).id_paciente
const em = async (id, d) => (await um(`select convenio_nome from public.convenio_do_paciente_em($1, $2::date)`, [id, d]))?.convenio_nome
ok(await em(xuxa, dia(-45)) === 'Particular', 'Xuxa há 45 dias: Particular')
ok(await em(xuxa, dia(0)) === 'LEVE SAUDE', 'Xuxa hoje: LEVE SAUDE')

console.log('3. troca pelo cadastro')
const wil = (await um(`select id_paciente from public.pacientes where nome = 'Wil Sem Grade'`)).id_paciente
await db.exec(`update public.pacientes set convenio_nome = 'LEVE SAUDE', convenio_catalogo_id = 2 where id_paciente = ${wil}`)
let w = await todos(`select convenio_nome, vigente_de, vigente_ate from public.pacientes_convenio_vigencias where paciente_id = ${wil} order by id`)
ok(w.length === 2 && iso(w[0].vigente_ate) === dia(-1) && iso(w[1].vigente_de) === dia(0) && w[1].convenio_nome === 'LEVE SAUDE', 'Wil: Particular até ontem, LEVE desde hoje')
await db.exec(`update public.pacientes set convenio_nome = 'ASSIM Saúde', convenio_catalogo_id = 3 where id_paciente = ${wil}`)
w = await todos(`select convenio_nome from public.pacientes_convenio_vigencias where paciente_id = ${wil} order by id`)
ok(w.length === 2 && w[1].convenio_nome === 'ASSIM Saúde', 'correção no mesmo dia ajusta a vigência de hoje (não cria outra)')
ok(await em(wil, dia(-10)) === 'Particular', 'Wil há 10 dias continua Particular')

console.log('4. histórico pelo banco')
const hist = async id => todos(`select acao, resumo, motivo, usuario_nome, antes, depois from public.cadastros_auditoria
  where tabela = 'paciente' and registro_id = $1 order by criado_em`, [String(id)])
let h = await hist(wil)
ok(h.length === 2 && h[0].antes.convenio_nome === 'Particular' && h[0].depois.convenio_nome === 'LEVE SAUDE' && /convenio_nome/.test(h[0].resumo),
  'troca de convênio entra no histórico com antes e depois')
await db.exec(`set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1'`)
await db.exec(`update public.pacientes set telefone = '2133334444' where id_paciente = ${wil}`)
await db.exec(`set request.jwt.claim.sub = ''`)
h = await hist(wil)
ok(h.length === 3 && h[2].usuario_nome === 'Rita Recepção' && /telefone/.test(h[2].resumo), 'edição de campo: autor é quem está logado')
await db.exec(`update public.pacientes set ativo = false where id_paciente = ${wil}`)
ok((await hist(wil)).length === 3, 'mudança só de situação não duplica (a tela registra com o motivo)')
await db.exec(`update public.pacientes set sincronizado_em = now() where id_paciente = ${wil}`)
ok((await hist(wil)).length === 3, 'coluna técnica não vira histórico')
await db.exec(`update public.profissionais set celular = '21988887777' where nome = 'Pedro Prof'`)
const hp = await todos(`select acao, depois from public.cadastros_auditoria where tabela = 'profissional'`)
ok(hp.length === 1 && hp[0].depois.celular === '21988887777', 'profissional: alteração entra no histórico')

console.log('5. importação do TiTa')
const zeca = (await um(`select id_paciente from public.pacientes where nome = 'Zeca Grade Errada'`)).id_paciente
await db.exec(`
insert into public.agenda_tita (paciente_id, paciente_nome, data_atendimento) values (3, 'Zeca Grade Errada', current_date);
insert into public.tita_favorecidos_cadastro (tita_favorecido_id, nome, situacao, plano_saude) values (3, 'Zeca Grade Errada', 'Ativo', 'Particular');
`)
const r = (await um(`select public.pacientes_importar_tita('cron') r`)).r
ok(r.sucesso, `importação roda (${r.erro ?? 'ok'})`)
h = await hist(zeca)
ok(h.length === 1 && h[0].motivo === 'Importação do TiTa' && h[0].usuario_nome === 'Sistema (rotina 04:00)' && h[0].depois.convenio_nome === 'Particular',
  `importação: UMA linha, com autor e origem (${JSON.stringify(h.map(x => [x.usuario_nome, x.motivo]))})`)
z = await vig('Zeca Grade Errada')
ok(z.length === 2 && z[1].convenio_nome === 'Particular' && iso(z[1].vigente_de) === dia(0), 'importação que troca o convênio abre vigência nova')

console.log('6. segurança')
await db.exec(`set role anon`)
let e = null; try { await db.query(`select * from public.pacientes_convenio_vigencias`) } catch (x2) { e = x2 }
ok(e, 'anon não lê as vigências')
e = null; try { await db.query(`select * from public.convenio_do_paciente_em(1, current_date)`) } catch (x2) { e = x2 }
ok(e, 'anon não consulta o convênio por data')
await db.exec(`reset role`)

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.')
process.exit(falhas ? 1 : 0)
