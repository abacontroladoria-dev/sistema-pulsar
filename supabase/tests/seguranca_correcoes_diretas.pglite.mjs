// Teste da migration 20261019140000 (correções diretas) no PGlite.
// Prova: a trava segura a migration; login comum não lê worker_tick_config, não
// insere em controle_terapeutico sem o papel, não lê CPF/telefone/registro nas
// cópias do TiTa (nem por `*`); vw_profissionais_disponiveis, vw_grade_base e
// vw_grade_atendimentos continuam respondendo para o login; service_role lê
// tudo; a guarda para a migration diante de view que lê coluna revogada ou de
// definição inesperada da view de cobertura; a migration reroda.
//
//   npm i @electric-sql/pglite   (num diretório acima do repo, ex. C:\Users\<você>)
//   node supabase/tests/seguranca_correcoes_diretas.pglite.mjs supabase/migrations/20261019140000_seguranca_correcoes_diretas.sql
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'

let f = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FALHA', m); if (!c) f++ }
const migOriginal = readFileSync(process.argv[2], 'utf8')
const destravada = migOriginal.replace('frontend_desta_branch_publicado boolean := false', 'frontend_desta_branch_publicado boolean := true')
ok(destravada !== migOriginal, 'a trava existe no texto da migration (false → true)')

const COLS_GRADE_TITA = `id bigint, grade_terapeuta_id bigint, grade_clinica_id bigint, profissional_id bigint,
  nome_profissional text, cpf_profissional text, numero_telefone text, cbo_profissional text,
  registro_profissional text, tipo_registro_profissional text, uf_registro_profissional text,
  id_unidade bigint, nome_unidade text, dia_semana text, data date, hora_inicial time, hora_final time,
  status_agendamento text, terapia_id bigint, nome_terapia text, terapia_exibicao_id bigint,
  terapia_exibicao text, id_sala bigint, sala text, observacoes_sala text, raw_json jsonb,
  created_at timestamptz, updated_at timestamptz, paciente_nome text, convenio_nome text`

const COLS_CSV = `id uuid primary key default gen_random_uuid(), tita_agendamento_id bigint, paciente_id bigint,
  paciente_nome text, data date, dia_semana text, hora_inicial time, hora_final time, profissional_id bigint,
  profissional_nome text, profissional_cpf text, terapia_id bigint, terapia_nome text, terapia_exibicao_id bigint,
  terapia_exibicao_nome text, sala_id bigint, sala_nome text, sala_observacoes text, unidade_id bigint,
  unidade_nome text, convenio_nome text, status_agendamento text, updated_at timestamptz, ativo boolean default true,
  origem text, status_execucao text, justificativa text, possui_tratativa boolean, tratativa_profissional_id bigint,
  tratativa_profissional_nome text, tratativa_criada_em timestamptz, tratativa_origem text, evolucao_vinculo text,
  criado_em_tita timestamptz, excluido_em_tita timestamptz, descricao_evolucao text, tratativas jsonb,
  tratativas_distintas int, inativado_em timestamptz, motivo_inativacao text, visto_em timestamptz,
  ausencia_confirmada_em timestamptz`

// Definição de produção (20260518131652_remote_schema.sql:1859).
const VIEW_COBERTURA_PROD = `create view public.vw_profissionais_disponiveis with (security_invoker = true) as
  select id, grade_terapeuta_id, grade_clinica_id, profissional_id, nome_profissional, cpf_profissional,
    numero_telefone, cbo_profissional, registro_profissional, tipo_registro_profissional, uf_registro_profissional,
    id_unidade, nome_unidade, dia_semana, data, hora_inicial, hora_final, status_agendamento, terapia_id,
    nome_terapia, terapia_exibicao_id, terapia_exibicao, id_sala, sala, observacoes_sala, raw_json, created_at, updated_at
  from public.grade_profissionais_tita where status_agendamento = 'Livre' and id_unidade = 280;`

// vw_grade_base como em 20260807120100 (resumida nas colunas derivadas) e a cadeia vw_grade_atendimentos.
const VIEWS_GRADE = `create view public.vw_grade_base with (security_invoker = true) as
  select id, data, dia_semana, hora_inicial, hora_final, paciente_id, paciente_nome, profissional_id, profissional_nome,
    terapia_id, terapia_nome, terapia_exibicao_id, terapia_exibicao_nome, sala_nome, unidade_id, unidade_nome,
    convenio_nome, status_agendamento, tita_agendamento_id, origem, status_execucao, justificativa, possui_tratativa,
    tratativa_profissional_id, tratativa_profissional_nome, tratativa_criada_em, tratativa_origem, evolucao_vinculo,
    criado_em_tita, excluido_em_tita, extract(year from data)::int as ano, tratativas, tratativas_distintas
  from public.csv_grades_profissionais where ativo;
create view public.vw_grade_atendimentos with (security_invoker = true) as
  select * from public.vw_grade_base where status_agendamento = 'Agendado' and unidade_id = 280;
grant select on public.vw_grade_base, public.vw_grade_atendimentos to authenticated;`

async function novoBanco({ viewCobertura = VIEW_COBERTURA_PROD, extra = '' } = {}) {
  const db = new PGlite()
  await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

create table public.usuarios (id uuid primary key, role text, ativo boolean default true);
grant select on public.usuarios to authenticated;
insert into public.usuarios values
  ('00000000-0000-0000-0000-000000000001', 'recepcao', true),
  ('00000000-0000-0000-0000-000000000002', 'terapeutico', true);

-- schema central como em 20260701000000: permissão total para qualquer login.
create schema central;
grant usage on schema central to authenticated, service_role;
alter default privileges in schema central grant select, insert, update, delete on tables to authenticated, service_role;
create table central.worker_tick_config (id boolean primary key default true check (id), url text not null, ativo boolean not null default true);
insert into central.worker_tick_config (url) values ('https://exemplo/api/central/workers/tick/');

create table public.controle_terapeutico (id serial primary key, tita_agendamento_id bigint unique, status text);
alter table public.controle_terapeutico enable row level security;
grant select, insert, update, delete on public.controle_terapeutico to authenticated;
grant usage on sequence public.controle_terapeutico_id_seq to authenticated;
create policy controle_terapeutico_insert_authenticated on public.controle_terapeutico for insert to authenticated with check (true);
create policy controle_terapeutico_therapeutic_insert on public.controle_terapeutico for insert to authenticated
  with check (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.role in ('terapeutico', 'terapeuta', 'admin') and u.ativo));

create table public.grade_profissionais_tita (${COLS_GRADE_TITA});
alter table public.grade_profissionais_tita enable row level security;
create policy "Allow select for authenticated" on public.grade_profissionais_tita for select to authenticated using (true);
grant all on public.grade_profissionais_tita to authenticated, service_role;
insert into public.grade_profissionais_tita (id, nome_profissional, cpf_profissional, numero_telefone, status_agendamento, id_unidade, data)
  values (1, 'Ana', '123.456.789-00', '21999990000', 'Livre', 280, current_date);

create table public.csv_grades_profissionais (${COLS_CSV});
alter table public.csv_grades_profissionais enable row level security;
create policy "Allow select for authenticated" on public.csv_grades_profissionais for select to authenticated using (true);
grant all on public.csv_grades_profissionais to authenticated, service_role;
insert into public.csv_grades_profissionais (paciente_nome, data, profissional_nome, profissional_cpf, sala_observacoes, status_agendamento, unidade_id, descricao_evolucao)
  values ('Paciente', current_date, 'Ana', '123.456.789-00', 'obs', 'Agendado', 280, 'texto clínico');

${viewCobertura}
grant select on public.vw_profissionais_disponiveis to authenticated;
${VIEWS_GRADE}
${extra}`)
  return db
}

const comoLogin = async (db, uid, sql) => {
  try {
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${uid}';`)
    const r = await db.query(sql)
    return { ok: true, rows: r.rows, campos: r.fields.map(x => x.name) }
  } catch (e) {
    return { ok: false, erro: e.message }
  } finally {
    await db.exec(`reset role; reset request.jwt.claim.sub;`)
  }
}
const RECEPCAO = '00000000-0000-0000-0000-000000000001'
const TERAPEUTICO = '00000000-0000-0000-0000-000000000002'

// ── 1. Trava ────────────────────────────────────────────────────────────────
{
  const db = await novoBanco()
  let erro = ''
  try { await db.exec(migOriginal) } catch (e) { erro = e.message }
  ok(/publique o frontend/.test(erro), 'sem trocar false → true a migration para')
  const ainda = await comoLogin(db, RECEPCAO, `select cpf_profissional from public.grade_profissionais_tita`)
  ok(ainda.ok, 'e nada foi alterado (o login ainda lê o CPF, como hoje)')
}

// ── 2. Migration aplicada (duas vezes) ──────────────────────────────────────
{
  const db = await novoBanco()
  await db.exec(destravada)
  await db.exec(destravada)
  ok(true, 'migration aplica e reroda')

  const tick = await comoLogin(db, RECEPCAO, `select url from central.worker_tick_config`)
  ok(!tick.ok, 'login não lê a URL do disparo do worker da Central')
  const tickUpd = await comoLogin(db, RECEPCAO, `update central.worker_tick_config set url = 'https://atacante/'`)
  ok(!tickUpd.ok, 'login não troca a URL do disparo')
  ok((await db.query(`select relrowsecurity r from pg_class where oid = 'central.worker_tick_config'::regclass`)).rows[0].r, 'worker_tick_config com RLS')

  const insRecepcao = await comoLogin(db, RECEPCAO, `insert into public.controle_terapeutico (tita_agendamento_id, status) values (1, 'presente')`)
  ok(!insRecepcao.ok, 'controle_terapeutico: login sem o papel não insere mais')
  const insTerap = await comoLogin(db, TERAPEUTICO, `insert into public.controle_terapeutico (tita_agendamento_id, status) values (2, 'presente')`)
  ok(insTerap.ok, 'controle_terapeutico: papel terapêutico continua inserindo')

  for (const c of ['cpf_profissional', 'numero_telefone', 'cbo_profissional', 'registro_profissional',
    'tipo_registro_profissional', 'uf_registro_profissional', 'raw_json', 'observacoes_sala']) {
    const r = await comoLogin(db, RECEPCAO, `select ${c} from public.grade_profissionais_tita`)
    ok(!r.ok && /permission denied/.test(r.erro), `grade_profissionais_tita.${c}: login não lê`)
  }
  const gradeOk = await comoLogin(db, RECEPCAO, `select id, nome_profissional, id_sala, terapia_exibicao_id, grade_terapeuta_id, paciente_nome from public.grade_profissionais_tita`)
  ok(gradeOk.ok && gradeOk.rows.length === 1, 'grade_profissionais_tita: colunas operacionais continuam legíveis')
  const gradeEstrela = await comoLogin(db, RECEPCAO, `select * from public.grade_profissionais_tita`)
  ok(!gradeEstrela.ok, 'grade_profissionais_tita: `*` recusado (por isso o frontend usa lista explícita)')

  for (const c of ['profissional_cpf', 'sala_observacoes']) {
    const r = await comoLogin(db, RECEPCAO, `select ${c} from public.csv_grades_profissionais`)
    ok(!r.ok && /permission denied/.test(r.erro), `csv_grades_profissionais.${c}: login não lê`)
  }
  const csvOk = await comoLogin(db, RECEPCAO, `select id, paciente_nome, sala_id, unidade_id, status_agendamento, descricao_evolucao from public.csv_grades_profissionais`)
  ok(csvOk.ok && csvOk.rows.length === 1, 'csv_grades_profissionais: colunas da tela continuam (evolução sai só na Fase 4)')

  const cob = await comoLogin(db, RECEPCAO, `select * from public.vw_profissionais_disponiveis`)
  ok(cob.ok && cob.rows.length === 1, 'vw_profissionais_disponiveis responde ao login')
  ok(cob.ok && !cob.campos.some(c => /cpf|telefone|registro|cbo|raw_json|observacoes/.test(c)), 'vw_profissionais_disponiveis sem colunas sensíveis')
  const inv = (await db.query(`select reloptions from pg_class where oid = 'public.vw_profissionais_disponiveis'::regclass`)).rows[0].reloptions
  ok(JSON.stringify(inv).includes('security_invoker=true'), 'vw_profissionais_disponiveis segue security_invoker')
  ok(!(await db.query(`select has_table_privilege('anon', 'public.vw_profissionais_disponiveis', 'SELECT') a`)).rows[0].a, 'anon sem acesso à view de cobertura')

  const base = await comoLogin(db, RECEPCAO, `select * from public.vw_grade_base`)
  ok(base.ok && base.rows.length === 1, 'vw_grade_base continua respondendo ao login')
  const atend = await comoLogin(db, RECEPCAO, `select * from public.vw_grade_atendimentos`)
  ok(atend.ok && atend.rows.length === 1, 'vw_grade_atendimentos (cadeia sobre vw_grade_base) continua respondendo')

  await db.exec(`set role service_role`)
  const srv = await db.query(`select cpf_profissional from public.grade_profissionais_tita`).then(r => r.rows.length, () => -1)
  const srv2 = await db.query(`select * from public.csv_grades_profissionais`).then(r => r.rows.length, () => -1)
  await db.exec(`reset role`)
  ok(srv === 1 && srv2 === 1, 'service_role (sync, Edge Functions) continua lendo tudo')
}

// ── 3. Guarda: view que lê coluna revogada ──────────────────────────────────
{
  const db = await novoBanco({
    extra: `create view public.vw_le_cpf with (security_invoker = true) as select id, profissional_cpf from public.csv_grades_profissionais;`,
  })
  let erro = ''
  try { await db.exec(destravada) } catch (e) { erro = e.message }
  ok(/vw_le_cpf/.test(erro) && /profissional_cpf/.test(erro), 'guarda para a migration e nomeia a view que lê coluna revogada')
  const ainda = await comoLogin(db, RECEPCAO, `select profissional_cpf from public.csv_grades_profissionais`)
  ok(ainda.ok, 'e nada foi alterado')
}

// ── 4. Guarda: definição inesperada da view de cobertura ────────────────────
{
  const db = await novoBanco({
    viewCobertura: VIEW_COBERTURA_PROD.replace(`and id_unidade = 280`, ``),
  })
  let erro = ''
  try { await db.exec(destravada) } catch (e) { erro = e.message }
  ok(/filtro esperado/.test(erro), 'definição da view de cobertura diferente da esperada: para e mostra a atual')
  // A parada vem antes da primeira mudança no texto da migration (não depende
  // de o SQL Editor rodar tudo numa transação só).
  ok(destravada.indexOf('filtro esperado') < destravada.indexOf('alter table central.worker_tick_config'),
     'as duas guardas vêm antes de qualquer alteração')
}

process.exit(f ? 1 : 0)
