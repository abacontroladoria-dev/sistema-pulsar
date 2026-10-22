// Teste da migration 20261022130000 (busca_mestre) no PGlite. Prova: anon não
// executa; sem login, inativo ou sem código: 0 linhas; cada categoria só com o
// código do cadastro dela; diretoria SEM código não recebe nada (a regra é a do
// menu, não a de usuario_tem_permissao); admin recebe as quatro; termo curto,
// `%` e `_` não viram curinga; acento e matrícula; fictício fica fora; só as
// 5 colunas; a migration reroda.
//
//   node supabase/tests/busca_mestre.pglite.mjs supabase/migrations/20261022130000_busca_mestre.sql
//   (precisa de @electric-sql/pglite alcançável a partir da pasta do script)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'
const db = new PGlite()
let f = 0; const ok = (c, m) => { console.log(c ? '  ok  ' : '  FALHA', m); if (!c) f++ }

await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;
create schema auth; grant usage on schema auth to anon, authenticated;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('teste.uid', true), '')::uuid $$;

-- O PGlite não tem unaccent: mesma forma da função real, com translate.
create function public.normalizar_nome_paciente(p_nome text) returns text language sql stable as $$
  select nullif(regexp_replace(lower(translate(regexp_replace(coalesce(p_nome, ''), '[^[:alnum:][:space:]]', ' ', 'g'),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')), '\\s+', ' ', 'g'), '') $$;
create function public.matricula_formatada(p integer) returns text language sql immutable as
  $$ select case when p is null then null else lpad(p::text, 5, '0') end $$;

create table public.usuarios (id uuid primary key, role text, ativo boolean);
insert into public.usuarios values
  ('00000000-0000-0000-0000-000000000001', 'admin', true),
  ('00000000-0000-0000-0000-000000000002', 'recepcao', true),
  ('00000000-0000-0000-0000-000000000003', 'recepcao', false),
  ('00000000-0000-0000-0000-000000000004', 'diretoria', true);
-- permissoes_efetivas() do usuário logado vem de teste.perms
create function public.permissoes_efetivas(p uuid default null) returns text[] language sql stable as
  $$ select coalesce(string_to_array(nullif(current_setting('teste.perms', true), ''), ','), array[]::text[]) $$;

create table public.pacientes (id_paciente bigint primary key, nome text, nome_normalizado text, nome_civil text,
  matricula integer, convenio_nome text, ativo boolean not null default true, ficticio boolean not null default false, cpf text);
insert into public.pacientes (id_paciente, nome, nome_civil, matricula, convenio_nome, ativo, ficticio, cpf) values
  (1, 'Ana Laura Ribeiro', null, 115, 'Unimed', true, false, '11122233344'),
  (2, 'Láura Martins', null, 348, ' ', true, false, null),
  (3, 'Maria Laura Fontes', null, 467, 'Amil', false, false, null),
  (4, 'Laura Teste', null, 999, null, true, true, null),
  (5, 'João Pedro', 'Joana Laura Pedro', 12, null, true, false, null);
update public.pacientes set nome_normalizado = public.normalizar_nome_paciente(nome);

create table public.cadastro_terapias (id bigint primary key, nome text, tipo text, ativo boolean not null default true);
insert into public.cadastro_terapias values (1, 'Fonoaudiologia', 'terapia', true), (2, 'Avaliação Laura', 'procedimento', true);
create table public.profissionais (id bigint primary key, nome text, tipo_registro text, codigo_registro text,
  uf_registro text, terapia_focal_id bigint, ativo boolean not null default true, celular text);
insert into public.profissionais values (1, 'Laura Teixeira', 'CRFa', '12345', 'RJ', 1, true, '21999990000'),
  (2, 'Rafael Moura', 'CRP', 'LAU-778', null, null, false, null);
create table public.convenios (id bigint primary key, nome text, ativo boolean not null default true);
insert into public.convenios values (1, 'Unimed Laura Saúde', true);
create table public.planos_saude (id bigint primary key, convenio_id bigint, nome text, ativo boolean not null default true);
insert into public.planos_saude values (1, 1, 'A', true), (2, 1, 'B', true), (3, 1, 'C', false);
grant select on all tables in schema public to anon, authenticated;`)

for (const arq of process.argv.slice(2)) { const sql = readFileSync(arq, 'utf8'); await db.exec(sql); await db.exec(sql) }

const U = (n) => `00000000-0000-0000-0000-00000000000${n}`
const busca = async (papel, uid, perms, termo) => {
  await db.exec(`set teste.uid = '${uid}'; set teste.perms = '${perms}'; set role ${papel};`)
  try { return { rows: (await db.query('select * from public.busca_mestre($1)', [termo])).rows } }
  catch (e) { return { erro: e.message } } finally { await db.exec('reset role') }
}
const cats = (r) => [...new Set((r.rows ?? []).map((x) => x.categoria))].sort().join(',')
const todos = 'cadastros_pacientes,cadastros_profissionais,cadastros_convenios,cadastros_terapias'

ok(!!(await busca('anon', '', '', 'laura')).erro, 'anon não executa')
ok((await busca('authenticated', '', todos, 'laura')).rows?.length === 0, 'sem login (auth.uid nulo): 0 linhas')
ok((await busca('authenticated', U(3), todos, 'laura')).rows?.length === 0, 'usuário inativo: 0 linhas')
ok((await busca('authenticated', U(2), '', 'laura')).rows?.length === 0, 'sem nenhum código: 0 linhas')
ok((await busca('authenticated', U(2), 'atendimentos', 'laura')).rows?.length === 0, 'código de outra tela: 0 linhas')
ok(cats(await busca('authenticated', U(2), 'cadastros_profissionais', 'laura')) === 'profissional', 'só cadastros_profissionais: só profissionais')
ok(cats(await busca('authenticated', U(2), 'cadastros_pacientes', 'laura')) === 'paciente', 'só cadastros_pacientes: só pacientes')
ok((await busca('authenticated', U(4), '', 'laura')).rows?.length === 0, 'diretoria sem código: 0 linhas (regra do menu)')
ok(cats(await busca('authenticated', U(1), '', 'laura')) === 'convenio,paciente,profissional,terapia', 'admin: as quatro categorias')

const pac = (await busca('authenticated', U(2), 'cadastros_pacientes', 'LAURA')).rows ?? []
ok(pac.some((r) => r.titulo === 'Láura Martins'), 'ignora acento e maiúscula')
ok(!pac.some((r) => r.titulo === 'Laura Teste'), 'paciente fictício fica fora')
ok(pac.some((r) => r.titulo === 'João Pedro'), 'acha pelo nome civil')
ok(pac.at(-1)?.titulo === 'Maria Laura Fontes' && pac.at(-1)?.inativo === true, 'inativo vem marcado e por último')
ok(pac.find((r) => r.titulo === 'Ana Laura Ribeiro')?.subtitulo === 'Matr. 00115 · Unimed', 'subtítulo: matrícula formatada e convênio')
ok(pac.find((r) => r.titulo === 'Láura Martins')?.subtitulo === 'Matr. 00348', 'convênio em branco não vira " · "')
ok(Object.keys(pac[0] ?? {}).sort().join(',') === 'categoria,id,inativo,subtitulo,titulo', 'só as 5 colunas (sem CPF)')

ok((await busca('authenticated', U(2), 'cadastros_pacientes', '00115')).rows?.[0]?.id == 1, 'matrícula formatada')
ok((await busca('authenticated', U(2), 'cadastros_pacientes', '115')).rows?.[0]?.id == 1, 'matrícula sem zeros')
ok((await busca('authenticated', U(1), '', 'la')).rows?.length === 0, 'menos de 3 letras: 0 linhas')
ok((await busca('authenticated', U(1), '', '%%%')).rows?.length === 0, '"%%%" não vira curinga')
ok((await busca('authenticated', U(1), '', 'l_ura')).rows?.length === 0, '"_" não vira curinga')
ok((await busca('authenticated', U(1), '', 'la%ra')).rows?.length === 0, '"%" no meio não vira curinga')
ok((await busca('authenticated', U(1), '', '  laura  ')).rows?.length > 0, 'espaço nas pontas não atrapalha')

const prof = (await busca('authenticated', U(2), 'cadastros_profissionais', 'lau')).rows ?? []
ok(prof[0]?.subtitulo === 'Fonoaudiologia · CRFa 12345 · RJ', 'profissional: terapia focal e registro completo')
ok(prof.some((r) => r.titulo === 'Rafael Moura' && r.inativo), 'acha pelo número do registro, inativo marcado')
const conv = (await busca('authenticated', U(2), 'cadastros_convenios', 'laura saude')).rows ?? []
ok(conv[0]?.subtitulo === '2 planos de saúde', 'convênio: conta só planos ativos')
const ter = (await busca('authenticated', U(2), 'cadastros_terapias', 'avaliacao')).rows ?? []
ok(ter[0]?.subtitulo === 'Procedimento', 'terapia: tipo no subtítulo')
process.exit(f ? 1 : 0)
