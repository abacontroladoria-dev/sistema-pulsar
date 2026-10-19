// Teste da migration 20261019190000 (texto da evolução) no PGlite.
// Prova: trava; sem a 20261019140000 para; login deixa de ler
// descricao_evolucao e o resto da linha continua; vw_grade_base segue
// respondendo; função security definer (como grade_detalhe_evolucao) e
// service_role continuam lendo o texto; guarda para diante de view que lê a
// coluna; reroda.
//
//   node supabase/tests/seguranca_evolucao_coluna.pglite.mjs \
//     supabase/migrations/20261019140000_seguranca_correcoes_diretas.sql \
//     supabase/migrations/20261019190000_seguranca_evolucao_coluna.sql
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'

let f = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FALHA', m); if (!c) f++ }
const destravar = sql => sql.replace('frontend_desta_branch_publicado boolean := false', 'frontend_desta_branch_publicado boolean := true')
const mig140 = destravar(readFileSync(process.argv[2], 'utf8'))
const mig150Original = readFileSync(process.argv[3], 'utf8')
const mig150 = destravar(mig150Original)

async function novoBanco(extra = '') {
  const db = new PGlite()
  await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema central;
-- Mínimo da cópia da grade do TiTa para a 20261019140000 rodar.
create table public.grade_profissionais_tita (id bigint, grade_terapeuta_id bigint, grade_clinica_id bigint,
  profissional_id bigint, nome_profissional text, cpf_profissional text, id_unidade bigint, nome_unidade text,
  dia_semana text, data date, hora_inicial time, hora_final time, status_agendamento text, terapia_id bigint,
  nome_terapia text, terapia_exibicao_id bigint, terapia_exibicao text, id_sala bigint, sala text,
  created_at timestamptz, updated_at timestamptz);
create view public.vw_profissionais_disponiveis with (security_invoker = true) as
  select id, cpf_profissional from public.grade_profissionais_tita where status_agendamento = 'Livre' and id_unidade = 280;
create table public.csv_grades_profissionais (
  id uuid primary key default gen_random_uuid(), data date, paciente_nome text, profissional_nome text,
  profissional_cpf text, sala_observacoes text, status_agendamento text, unidade_id bigint, ativo boolean default true,
  descricao_evolucao text, status_execucao text);
alter table public.csv_grades_profissionais enable row level security;
create policy "Allow select for authenticated" on public.csv_grades_profissionais for select to authenticated using (true);
grant all on public.csv_grades_profissionais to authenticated, service_role;
insert into public.csv_grades_profissionais (data, paciente_nome, profissional_nome, status_agendamento, unidade_id, descricao_evolucao, status_execucao)
  values (current_date, 'Paciente', 'Ana', 'Agendado', 280, 'texto clínico', 'Realizado');
create view public.vw_grade_base with (security_invoker = true) as
  select id, data, paciente_nome, profissional_nome, status_agendamento, unidade_id, status_execucao
  from public.csv_grades_profissionais where ativo;
grant select on public.vw_grade_base to authenticated;
-- Molde de grade_detalhe_evolucao: security definer, decide quem vê o texto.
create function public.detalhe_evolucao(p uuid) returns text language sql security definer set search_path = '' as
  $$ select descricao_evolucao from public.csv_grades_profissionais where id = p $$;
grant execute on function public.detalhe_evolucao(uuid) to authenticated;
${extra}`)
  return db
}

const comoLogin = async (db, sql) => {
  try {
    await db.exec(`set role authenticated`)
    const r = await db.query(sql)
    return { ok: true, rows: r.rows }
  } catch (e) {
    return { ok: false, erro: e.message }
  } finally {
    await db.exec(`reset role`)
  }
}

const tentar = async (db, sql) => { try { await db.exec(sql); return '' } catch (e) { return e.message } }

{
  const db = await novoBanco()
  ok(/publique o frontend/.test(await tentar(db, mig150Original)), 'trava: sem trocar false → true a migration para')
  ok(/20261019140000/.test(await tentar(db, mig150)), 'sem a 20261019140000 aplicada, para e pede a ordem certa')
  ok((await comoLogin(db, `select descricao_evolucao from public.csv_grades_profissionais`)).ok, 'e nada foi alterado')
}

{
  const db = await novoBanco()
  await db.exec(mig140)
  await db.exec(mig150)
  await db.exec(mig150)
  ok(true, 'aplica depois da 20261019140000 e reroda')

  const texto = await comoLogin(db, `select descricao_evolucao from public.csv_grades_profissionais`)
  ok(!texto.ok && /permission denied/.test(texto.erro), 'login não lê o texto da evolução')
  const filtro = await comoLogin(db, `select id from public.csv_grades_profissionais where descricao_evolucao is not null`)
  ok(!filtro.ok, 'nem filtra por ele (o filtro também exige a coluna)')
  const resto = await comoLogin(db, `select id, paciente_nome, status_execucao, sala_observacoes is null as x from public.csv_grades_profissionais`)
  ok(!resto.ok, 'sala_observacoes segue fechada (20261019140000)')
  const linha = await comoLogin(db, `select id, paciente_nome, status_execucao from public.csv_grades_profissionais`)
  ok(linha.ok && linha.rows.length === 1, 'o resto da linha continua legível')
  const base = await comoLogin(db, `select * from public.vw_grade_base`)
  ok(base.ok && base.rows.length === 1, 'vw_grade_base continua respondendo')

  const id = (await db.query(`select id from public.csv_grades_profissionais`)).rows[0].id
  const definer = await comoLogin(db, `select public.detalhe_evolucao('${id}') t`)
  ok(definer.ok && definer.rows[0].t === 'texto clínico', 'função security definer (molde de grade_detalhe_evolucao) continua lendo')

  await db.exec(`set role service_role`)
  const srv = await db.query(`select descricao_evolucao from public.csv_grades_profissionais`).then(r => r.rows[0]?.descricao_evolucao, () => null)
  await db.exec(`reset role`)
  ok(srv === 'texto clínico', 'service_role (rota da Auditoria, sync) continua lendo')
}

{
  const db = await novoBanco(`create view public.vw_le_evolucao with (security_invoker = true) as select id, descricao_evolucao from public.csv_grades_profissionais;`)
  // A 20261019140000 não olha descricao_evolucao: passa. A 20261019190000 para.
  await db.exec(mig140)
  const erro = await tentar(db, mig150)
  ok(/vw_le_evolucao/.test(erro), 'guarda: view que lê descricao_evolucao para a migration e é nomeada')
}

process.exit(f ? 1 : 0)
