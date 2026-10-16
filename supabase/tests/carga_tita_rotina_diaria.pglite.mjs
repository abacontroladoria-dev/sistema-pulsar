// Teste da migration 20261016170000 (rotina diária das 04:00: as funções das
// etapas aceitam a chamada interna da service_role) no PGlite, sobre a cadeia
// real (terapias → profissionais → disponibilidade → Grade → logs do TiTa).
//
// Prova: sem usuário (rotina), importar profissionais, gravar a prévia e
// aplicar a disponibilidade, e a prévia/aplicação da Grade rodam, com origem
// 'cron' e autor "Rotina do TiTa (04:00)"; logado SEM permissão continua
// barrado; anon não executa; tita_cargas só a service_role grava e só quem tem
// carregar_tita lê.
//
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   cp <repo>/supabase/tests/carga_tita_rotina_diaria.pglite.mjs /tmp/pg/
//   node /tmp/pg/carga_tita_rotina_diaria.pglite.mjs <repo>
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'fs'

const [, , repo] = process.argv
const migDir = `${repo}/supabase/migrations`
const arquivo = prefixo => readFileSync(`${migDir}/${readdirSync(migDir).find(f => f.startsWith(prefixo))}`, 'utf8')

let falhas = 0
const ok = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { falhas++; console.log('  FALHA', msg) } }
const db = new PGlite()
async function erro(sql, params = []) {
  try { await db.query(sql, params); return null } catch (e) { return e }
}
const um = async (sql, params = []) => (await db.query(sql, params)).rows[0]

const EDITOR = '00000000-0000-0000-0000-0000000000b1'  // tem cronograma_grade
const OUTRO = '00000000-0000-0000-0000-0000000000c1'   // logado, sem a permissão

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
create or replace function public.remuneracao_has_role(p text[]) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.ativo and u.role = any(p)) $$;
create or replace function public.hoje_brasilia() returns date language sql stable as $$ select current_date $$;
create or replace function public.normalizar_nome_paciente(p text) returns text language sql immutable as $$
  select lower(btrim(regexp_replace(translate(coalesce(p, ''), 'áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ', 'aaaaeeiooooucAAAAEEIOOOUC'), '\\s+', ' ', 'g'))) $$;

create table public.cadastros_auditoria (
  id uuid primary key default gen_random_uuid(), tabela text not null, registro_id text not null, acao text not null,
  paciente_id bigint, paciente_nome text, convenio_nome text, alvo_nome text, antes jsonb, depois jsonb,
  resumo text, motivo text, usuario_id uuid, usuario_nome text,
  criado_em timestamptz not null default now(), criado_em_brasilia text);
create table public.pacientes (
  id_paciente bigint generated always as identity primary key, tita_paciente_id bigint unique,
  nome text not null, ficticio boolean default false, ativo boolean default true, falecido boolean default false);
create table public.feriados (data date, nome text, tipo text, horario_inicio text, horario_fim text);
create table public.cadastros_pacientes_alta_clinica (id_paciente_pulsar bigint, ativo boolean, data_alta_clinica date);
create table public.cronograma_capacidade_profissional_dia (profissional_nome text, dow int, capacidade int);
create table public.pacientes_disponibilidade_versoes (paciente_id bigint, numero_versao int, criado_em timestamptz);
create table public.csv_grades_profissionais (
  id uuid primary key default gen_random_uuid(), tita_agendamento_id bigint, data date,
  hora_inicial time, hora_final time, paciente_id bigint, paciente_nome text,
  profissional_id bigint, profissional_nome text, profissional_cpf text,
  terapia_id bigint, terapia_nome text, terapia_exibicao_id bigint, terapia_exibicao_nome text,
  sala_nome text, unidade_id integer default 280, status_agendamento text default 'Agendado',
  ativo boolean default true, updated_at timestamptz default now());
create table public.grade_profissionais_tita (
  profissional_id bigint, data date, numero_telefone text, cbo_profissional text, registro_profissional text,
  tipo_registro_profissional text, uf_registro_profissional text);
create table public.cronograma_salas (
  id uuid primary key default gen_random_uuid(), nome_exibicao text, unidade_nome text, numero_sala text,
  capacidade text default 'unico', status text default 'ativa', sala_nome_referencia text);
create table public.cronograma_salas_terapias_exclusivas (sala_id uuid, terapia_id bigint, terapia_nome text, modo text);

insert into public.usuarios values
  ('${EDITOR}', 'Edu Editor', 'edu@exemplo.com', 'cronograma', true),
  ('${OUTRO}', 'Olga Outra', 'olga@exemplo.com', 'recepcao', true);
insert into public.usuarios_permissoes values ('${EDITOR}', 'cronograma_grade', true),
                                              ('${OUTRO}', 'cadastros_pacientes', true);
`)


await db.exec(`
create table public.pacientes_importacoes_log (id uuid primary key default gen_random_uuid(), origem text, status text, detalhes jsonb);
create table public.alertas_regras (codigo text primary key, modulo text, nome text, setor_destino text, prioridade text, tolerancia_minutos int);
`)
for (const p of ['20261006120000', '20261006120100', '20261006130000', '20261006140000', '20261006170000',
                 '20261005170000', '20261008100000', '20261008100100', '20261008100200', '20261008100300',
                 '20261015190000', '20261016100000']) {
  await db.exec(arquivo(p))
}
const mig = arquivo('20261016170000')
await db.exec(mig)
await db.exec(mig)
console.log('1. migration roda e reroda')
ok(true, 'ok')

await db.exec(`
insert into public.profissionais (nome, tita_profissional_id, origem) values ('Pedro Prof', 501, 'tita');
insert into public.cadastro_terapias (nome) values ('ABA') on conflict on constraint cadastro_terapias_nome_unico do nothing;
insert into public.cronograma_salas (id, nome_exibicao, unidade_nome, numero_sala) values ('11111111-1111-1111-1111-111111111111', 'Sala 1', 'Centro', '1');
insert into public.csv_grades_profissionais (tita_agendamento_id, data, hora_inicial, hora_final, paciente_id, paciente_nome,
  profissional_id, profissional_nome, terapia_id, terapia_nome, sala_nome) values
  (2001, current_date + 7, '08:00', '08:40', 9001, 'Ana', 501, 'Pedro Prof', 77, 'ABA', 'Unid. Centro - Sala 1'),
  (2002, current_date + 8, '09:00', '09:40', 9002, 'Nina Nova', 777, 'Nova Profissional', 77, 'ABA', 'Unid. Centro - Sala 1');
insert into public.pacientes (tita_paciente_id, nome) values (9001, 'Ana');
insert into public.grade_sync_dia (data, modo, unidade_id, sincronizado_em)
  select d::date, 'grade', 280, now() from generate_series(current_date, current_date + 30, interval '1 day') d;
`)
const PROF = (await um(`select id from public.profissionais where tita_profissional_id = 501`)).id
const ABA = (await um(`select id from public.cadastro_terapias where nome = 'ABA'`)).id
const S1 = '11111111-1111-1111-1111-111111111111'

async function como(papel, uid = '') { await db.exec(`reset role; set request.jwt.claim.sub = '${uid}'; set role ${papel};`) }

console.log('2. anon não executa')
await como('anon')
for (const f of ['public.profissionais_importar_tita()', 'public.profissionais_locais()',
                 'public.grade_importar_tita_previa(current_date, current_date + 30)',
                 'public.tita_importacao_concluir(gen_random_uuid())']) {
  ok(await erro(`select ${f}`), `anon não executa ${f.split('(')[0]}`)
}

console.log('3. logado sem permissão continua barrado')
await como('authenticated', OUTRO)
ok(/Sem permissão/.test((await erro(`select public.profissionais_importar_tita()`))?.message ?? ''), 'profissionais')
ok(/Sem permissão/.test((await erro(`select public.grade_importar_tita_previa(current_date, current_date + 30)`))?.message ?? ''), 'grade')
ok(/Sem permissão/.test((await erro(`select * from public.profissionais_locais()`))?.message ?? ''), 'locais')

console.log('4. a rotina (service_role, sem usuário) roda as etapas')
await como('service_role')
const rp = (await um(`select public.profissionais_importar_tita() r`)).r
ok(rp.importacao_id && rp.novos === 1, `profissionais: 1 novo (${JSON.stringify(rp)})`)
const log = await um(`select origem, usuario_nome from public.tita_importacoes where id = $1`, [rp.importacao_id])
ok(log.origem === 'cron' && log.usuario_nome === 'Rotina do TiTa (04:00)', 'log com origem cron e autor da rotina')
ok(Number((await um(`select count(*) n from public.profissionais_locais()`)).n) === 1, 'locais legíveis pela rotina')
const faixa = { dia_semana: 1, hora_inicio: '08:00', hora_fim: '12:00', duracao_min: 40, capacidade: 1, intervalo_ativo: false,
  intervalo_inicio: null, intervalo_fim: null, local_id: S1, terapias: [ABA], ordem: 0 }
const pv = (await um(`select public.tita_importacao_disponibilidade_previa(current_date, current_date + 7, current_date + 19, 1, $1::jsonb) id`,
  [JSON.stringify([{ tipo: 'novo', profissional_id: PROF, payload: { dias: [1], faixas: [faixa], habilitar: [ABA] } }])])).id
const ap = (await um(`select public.tita_importacao_disponibilidade_aplicar($1, $2) r`, [pv, [PROF]])).r
ok(ap.aplicados === 1, `disponibilidade gravada pela rotina (${JSON.stringify(ap)})`)
ok((await um(`select criado_por_nome from public.profissionais_disponibilidade_versoes where profissional_id = ${PROF}`)).criado_por_nome === 'Rotina do TiTa (04:00)', 'versão com autor da rotina')
ok((await um(`select public.tita_importacao_concluir($1) r`, [pv])).r.situacao === 'sucesso', 'disponibilidade concluída')
const gp = (await um(`select public.grade_importar_tita_previa(current_date, current_date + 30) r`)).r
ok(gp.contadores.novos === 1 && gp.contadores.pendencias === 1, `grade: prévia pela rotina (${JSON.stringify(gp.contadores)})`)
const ga = (await um(`select public.grade_importar_tita_aplicar($1::uuid, true, null) r`, [gp.importacao_id])).r
ok(ga.aplicado.sessoes_novas === 1, 'grade: aplicada pela rotina')
await um(`select public.grade_importar_tita_concluir($1::uuid)`, [gp.importacao_id])
const gi = await um(`select origem, criado_por_nome, situacao from public.grade_importacoes where id = $1`, [gp.importacao_id])
ok(gi.origem === 'cron' && gi.criado_por_nome === 'Rotina do TiTa (04:00)' && gi.situacao === 'aplicada', 'grade: log com origem cron e autor da rotina')

console.log('5. tita_cargas')
await db.exec(`insert into public.tita_cargas (origem) values ('cron')`)
await como('authenticated', OUTRO)
ok(Number((await um(`select count(*) n from public.tita_cargas`)).n) === 0, 'sem carregar_tita: não vê as cargas')
ok(await erro(`insert into public.tita_cargas (origem) values ('manual')`), 'logado não grava carga')
await como('anon')
ok(await erro(`select * from public.tita_cargas`), 'anon não lê')
await db.exec(`reset role`)

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.')
process.exit(falhas ? 1 : 0)
