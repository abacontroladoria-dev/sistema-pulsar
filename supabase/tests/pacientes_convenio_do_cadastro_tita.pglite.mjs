// Teste da migration 20261016140000 (convênio do paciente = cadastro do TiTa)
// no PGlite. Roda a importação de pacientes de verdade (20261009100000) e a
// correção por cima.
//
// Prova: o convênio vem da cópia do CADASTRO do TiTa (e prevalece), nunca do
// último agendamento; cópia velha, convênio vazio ou "Ainda não selecionado"
// não tocam no convênio do Pulsar; paciente novo nasce com o convênio do
// cadastro; nome fora do catálogo entra sem vínculo; o preenchimento inicial
// liga ao catálogo quem já tinha o nome; o log registra a troca; a migration
// reroda; anon não lê a cópia.
//
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   cp <repo>/supabase/tests/pacientes_convenio_do_cadastro_tita.pglite.mjs /tmp/pg/
//   node /tmp/pg/pacientes_convenio_do_cadastro_tita.pglite.mjs <repo>
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'fs'

const [, , repo] = process.argv
const migDir = `${repo}/supabase/migrations`
const arquivo = prefixo => readFileSync(`${migDir}/${readdirSync(migDir).find(f => f.startsWith(prefixo))}`, 'utf8')

let falhas = 0
const ok = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { falhas++; console.log('  FALHA', msg) } }
const db = new PGlite()
const um = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const conv = async tita => (await um(`select convenio_nome, convenio_catalogo_id, convenio_id from public.pacientes where tita_paciente_id = $1`, [tita]))

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
// Pulsar antes da correção: Ana editada para Particular; Beto e Caio com LEVE;
// Dani com o nome em caixa diferente do catálogo.
await db.exec(`
insert into public.pacientes (tita_paciente_id, nome, convenio_nome, convenio_id) values
  (1, 'Ana', 'Particular', 300), (2, 'Beto', 'LEVE SAUDE', 200), (3, 'Caio', 'LEVE SAUDE', 200), (4, 'Dani', 'leve saude', 200),
  (6, 'Eva', 'Particular', 300);
-- TiTa: o último AGENDAMENTO de cada um diz LEVE (o nome da grade pode vir errado).
insert into public.agenda_tita (paciente_id, paciente_nome, data_atendimento, convenio_id, convenio_nome) values
  (1, 'Ana', current_date, 200, 'LEVE SAUDE'), (2, 'Beto', current_date, 300, 'Particular'),
  (3, 'Caio', current_date, 300, 'Particular'), (4, 'Dani', current_date, 200, 'LEVE SAUDE'),
  (5, 'Fabi', current_date, 200, 'LEVE SAUDE'), (6, 'Eva', current_date, 300, 'Particular'),
  (9, 'Gil', current_date - 3, 100, 'ASSIM Saúde');
`)
const mig = arquivo('20261016140000')
await db.exec(mig)
await db.exec(mig)
ok(true, 'roda e reroda')
ok(Number((await conv(4)).convenio_catalogo_id) === 2, 'preenchimento inicial: "leve saude" ligado a LEVE SAUDE do catálogo')
ok(Number((await conv(1)).convenio_catalogo_id) === 3, 'preenchimento inicial: Ana ligada a Particular')

// Cópia do CADASTRO do TiTa: Ana mudou para ASSIM; Beto com cópia velha; Caio
// "Ainda não selecionado"; Fabi nova; Eva com operadora fora do catálogo.
await db.exec(`
insert into public.tita_favorecidos_cadastro (tita_favorecido_id, nome, situacao, plano_saude, sincronizado_em) values
  (1, 'Ana', 'Ativo', 'ASSIM Saude', now()),
  (2, 'Beto', 'Ativo', 'Particular', now() - interval '3 days'),
  (3, 'Caio', 'Ativo', 'Ainda não selecionado', now()),
  (4, 'Dani', 'Ativo', 'LEVE SAUDE', now()),
  (5, 'Fabi', 'Ativo', 'LEVE SAUDE', now()),
  (6, 'Eva', 'Ativo', 'Nova Operadora', now());
`)

console.log('2. importação')
const r = (await um(`select public.pacientes_importar_tita('cron') r`)).r
ok(r.sucesso === true, `importação roda (${r.erro ?? 'ok'})`)
let c = await conv(1)
ok(c.convenio_nome === 'ASSIM Saúde' && Number(c.convenio_catalogo_id) === 1 && Number(c.convenio_id) === 100,
  `Ana: convênio do CADASTRO do TiTa prevalece (ASSIM, nome do catálogo, id do TiTa coerente) — ${JSON.stringify(c)}`)
c = await conv(2)
ok(c.convenio_nome === 'LEVE SAUDE', 'Beto: cópia do cadastro velha → convênio do Pulsar intocado (e não vem do agendamento)')
c = await conv(3)
ok(c.convenio_nome === 'LEVE SAUDE', 'Caio: "Ainda não selecionado" → convênio do Pulsar intocado')
c = await conv(5)
ok(c && c.convenio_nome === 'LEVE SAUDE' && Number(c.convenio_catalogo_id) === 2, 'Fabi (nova): nasce com o convênio do cadastro')
c = await conv(6)
ok(c.convenio_nome === 'Nova Operadora' && c.convenio_catalogo_id === null, 'Eva: operadora fora do catálogo entra pelo nome, sem vínculo')
c = await conv(9)
ok(c && c.convenio_nome === null, 'Gil (sem cadastro no TiTa): não ganha convênio do agendamento')
const det = (await um(`select detalhes from public.pacientes_importacoes_log where id = $1`, [r.log_id])).detalhes
const ana = det.atualizados.find(a => a.nome === 'Ana')
ok(ana?.mudancas.some(m => m.campo === 'Convênio' && m.de === 'Particular' && m.para === 'ASSIM Saúde'), 'log: Ana Particular → ASSIM Saúde')

console.log('3. segurança')
await db.exec(`set role anon`)
let e = null; try { await db.query(`select * from public.tita_favorecidos_cadastro`) } catch (x) { e = x }
ok(e, 'anon não lê a cópia do cadastro')
await db.exec(`reset role`)

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.')
process.exit(falhas ? 1 : 0)
