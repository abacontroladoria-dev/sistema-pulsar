// Teste da migration 20261023160000 (carteirinha do paciente = cadastro do TiTa)
// no PGlite, por cima da importação de pacientes real (20261009100000 →
// 20261016140000 → 20261016160000).
//
// Prova: paciente sem carteirinha no agendamento ganha a do cadastro; a do
// cadastro prevalece sobre a do agendamento; cadastro sem carteirinha ou cópia
// velha mantém a do agendamento; carteirinha chega mesmo com o convênio em
// conflito; o log registra; a migration reroda.
//
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   cp <repo>/supabase/tests/pacientes_carteirinha_do_cadastro_tita.pglite.mjs /tmp/pg/
//   node /tmp/pg/pacientes_carteirinha_do_cadastro_tita.pglite.mjs <repo>
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'fs'

const [, , repo] = process.argv
const migDir = `${repo}/supabase/migrations`
const arquivo = prefixo => readFileSync(`${migDir}/${readdirSync(migDir).find(f => f.startsWith(prefixo))}`, 'utf8')

let falhas = 0
const ok = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { falhas++; console.log('  FALHA', msg) } }
const db = new PGlite()
const um = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const cart = async tita => (await um(`select numero_carteirinha from public.pacientes where tita_paciente_id = $1`, [tita]))?.numero_carteirinha

await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
create table public.usuarios (id uuid primary key, nome text, role text, ativo boolean default true);
create function public.usuario_tem_permissao(p text) returns boolean language sql stable as $$ select false $$;
create function public.normalizar_nome_paciente(p text) returns text language sql immutable as $$ select lower(btrim(coalesce(p, ''))) $$;
create table public.alertas_regras (codigo text primary key, modulo text, nome text, setor_destino text, prioridade text, tolerancia_minutos int);
create table public.alertas (id uuid primary key default gen_random_uuid(), modulo text, regra_codigo text, origem text, entidade_tipo text,
  entidade_id text, entidade_ref jsonb, titulo text, descricao text, prioridade text, status text, setor_destino text, fingerprint text unique,
  atualizado_em timestamptz);
create table public.alertas_eventos (alerta_id uuid, entidade_tipo text, entidade_id text, tipo text, autor_tipo text, autor_nome text, descricao text);
create table public.cadastros_auditoria (id uuid primary key default gen_random_uuid(), tabela text, registro_id text, acao text,
  alvo_nome text, paciente_id bigint, paciente_nome text, resumo text, usuario_id uuid, usuario_nome text, antes jsonb, depois jsonb);
create table public.convenios (id bigint generated always as identity primary key, nome text not null);
insert into public.convenios (nome) values ('ASSIM Saúde'), ('LEVE SAUDE'), ('Particular');
create table public.pacientes (
  id_paciente bigint generated always as identity primary key, tita_paciente_id bigint unique, nome text not null,
  cpf text, data_nascimento date, convenio_id bigint, convenio_nome text, numero_carteirinha text,
  responsavel_nome text, responsavel_cpf text, responsavel_email text, responsavel_telefone text,
  responsavel_parentesco text, responsavel_financeiro boolean, cep text, logradouro text, numero text,
  complemento text, bairro text, cidade text, uf text, ficticio boolean default false, ativo boolean default true,
  origem_cadastro text, sincronizado_em timestamptz);
create table public.agenda_tita (paciente_id bigint, paciente_nome text, cpf text, data_nascimento date, data_atendimento date,
  convenio_id bigint, convenio_nome text, numero_carteirinha text, responsavel_nome text, responsavel_email text,
  responsavel_telefone text, raw_json jsonb, ativo boolean default true);
create table public.csv_grades_profissionais (paciente_id bigint, paciente_nome text, convenio_nome text, data date,
  unidade_id int default 280, ativo boolean default true);
`)

console.log('1. migrations')
await db.exec(arquivo('20261009100000'))
await db.exec(`
insert into public.pacientes (tita_paciente_id, nome, convenio_nome, numero_carteirinha) values
  (1, 'Ana', 'ASSIM Saúde', null), (2, 'Beto', 'ASSIM Saúde', '111'), (3, 'Caio', 'LEVE SAUDE', '333'),
  (4, 'Dani', 'LEVE SAUDE', '444'), (5, 'Eva', 'ASSIM Saúde', null);
-- Agendamento: Ana sem carteirinha; Beto com uma velha; Caio e Dani com a certa.
insert into public.agenda_tita (paciente_id, paciente_nome, data_atendimento, convenio_id, convenio_nome, numero_carteirinha) values
  (1, 'Ana', current_date, 100, 'ASSIM Saúde', null), (2, 'Beto', current_date, 100, 'ASSIM Saúde', '111'),
  (3, 'Caio', current_date, 200, 'LEVE SAUDE', '333'), (4, 'Dani', current_date, 200, 'LEVE SAUDE', '444'),
  (5, 'Eva', current_date, 100, 'ASSIM Saúde', null);
`)
await db.exec(arquivo('20261016140000'))
await db.exec(arquivo('20261016160000'))
const mig = arquivo('20261023160000')
await db.exec(mig)
await db.exec(mig)
ok(true, 'roda e reroda')

// Cadastro: Ana e Beto com carteirinha; Caio sem; Dani com cópia velha; Eva com
// plano em conflito (convênio não é tocado, a carteirinha chega igual).
await db.exec(`
insert into public.tita_favorecidos_cadastro (tita_favorecido_id, nome, situacao, plano_saude, plano_em_conflito, numero_carteirinha, sincronizado_em) values
  (1, 'Ana',  'Ativo', 'ASSIM Saude', false, ' 73723094402 ', now()),
  (2, 'Beto', 'Ativo', 'ASSIM Saude', false, '222', now()),
  (3, 'Caio', 'Ativo', 'LEVE SAUDE',  false, '', now()),
  (4, 'Dani', 'Ativo', 'LEVE SAUDE',  false, '999', now() - interval '3 days'),
  (5, 'Eva',  'Ativo', null,          true,  '555', now());
`)

console.log('2. importação')
const r = (await um(`select public.pacientes_importar_tita('cron') r`)).r
ok(r.sucesso === true, `importação roda (${r.erro ?? 'ok'})`)
ok(await cart(1) === '73723094402', 'Ana: sem carteirinha no agendamento → ganha a do cadastro (aparada)')
ok(await cart(2) === '222', 'Beto: a do cadastro prevalece sobre a do agendamento')
ok(await cart(3) === '333', 'Caio: cadastro vazio → fica a do agendamento')
ok(await cart(4) === '444', 'Dani: cópia velha → fica a do agendamento')
ok(await cart(5) === '555', 'Eva: plano em conflito não impede a carteirinha')
const det = (await um(`select detalhes from public.pacientes_importacoes_log where id = $1`, [r.log_id])).detalhes
const beto = det.atualizados.find(a => a.nome === 'Beto')
ok(beto?.mudancas.some(m => m.campo === 'Carteirinha' && m.de === '111' && m.para === '222'), 'log: Beto 111 → 222')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.')
process.exit(falhas ? 1 : 0)
