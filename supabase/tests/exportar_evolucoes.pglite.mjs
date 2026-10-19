// Teste da migration 20261019200000 (Exportar Evoluções) no PGlite.
// Prova: só service_role executa as funções (anon e login recebem
// "permission denied"); registro só admin lê; TiTa + Pulsar unidos sem
// repetição; tita_importacao, falta e cancelamento ficam fora; terapia de
// exibição; profissional = executor (nunca o admin que digitou); linhas
// idênticas do TiTa viram uma; limite de 12 meses e de 500 chaves; leitura de
// texto gravada no registro; reroda.
//
//   node supabase/tests/exportar_evolucoes.pglite.mjs \
//     supabase/migrations/20261019200000_exportar_evolucoes.sql //     supabase/migrations/20261019200200_exportar_evolucoes_id_agendamento.sql //     supabase/migrations/20261019200300_grade_evolucoes_historico_tita.sql //     supabase/migrations/20261019200400_exportar_evolucoes_le_grade_evolucoes.sql
//
// Desde a 200400 a fonte do TiTa é o arquivo na grade_evolucoes (carregado da
// cópia pela 200300 e, daí em diante, pelo gatilho), não mais a cópia.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'

let f = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FALHA', m); if (!c) f++ }
const mig = readFileSync(process.argv[2], 'utf8')
const migId = readFileSync(process.argv[3], 'utf8')
const migHist = readFileSync(process.argv[4], 'utf8')
const migLe = readFileSync(process.argv[5], 'utf8')

{
  const vazio = new PGlite()
  let erro = ''
  try { await vazio.exec(migId) } catch (e) { erro = e.message }
  ok(/20261019200000/.test(erro), 'a 200200 sozinha para e pede a 200000 antes')
}

const db = new PGlite()
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create table auth.jwt_uid (uid uuid);
create function auth.uid() returns uuid language sql stable as $$ select uid from auth.jwt_uid limit 1 $$;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.jwt_uid to anon, authenticated, service_role;
create table public.usuarios (id uuid primary key, nome text, role text, ativo boolean default true);
create function public.is_admin() returns boolean language sql stable security definer set search_path = '' as
  $$ select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.role = 'admin') $$;
grant execute on function public.is_admin() to authenticated;
insert into public.usuarios values ('00000000-0000-0000-0000-00000000000a', 'Admin', 'admin', true),
                                   ('00000000-0000-0000-0000-00000000000b', 'Recepção', 'recepcao', true);

create table public.pacientes (id_paciente bigint primary key, nome text, cpf text, data_nascimento date,
  tita_paciente_id bigint unique, convenio_nome text);
create table public.profissionais (id bigint primary key, nome text, tita_profissional_id bigint unique,
  tipo_registro text, uf_registro text, codigo_registro text, assinatura_path text);
create table public.cadastro_terapias (id bigint primary key, nome text);
create table public.csv_grades_profissionais (
  id uuid primary key default gen_random_uuid(), tita_agendamento_id bigint, paciente_id bigint, paciente_nome text,
  data date, hora_inicial time, hora_final time, profissional_id bigint, profissional_nome text,
  terapia_nome text, terapia_exibicao_nome text, unidade_id bigint, convenio_nome text, updated_at timestamptz default now(),
  ativo boolean default true, status_execucao text, possui_tratativa boolean, tratativa_profissional_id bigint,
  tratativa_profissional_nome text, descricao_evolucao text, tratativa_criada_em timestamptz, tratativa_origem text,
  evolucao_vinculo text);
create table public.grade_agendamentos (id uuid primary key default gen_random_uuid(), data date, hora_inicio time,
  hora_fim time, paciente_id bigint, paciente_nome text, profissional_id bigint, profissional_nome text,
  terapia_nome text, terapia_exibicao_id bigint, terapia_exibicao_nome text, tita_agendamento_id bigint);
create table public.grade_evolucoes (agendamento_id uuid primary key references public.grade_agendamentos(id),
  tita_agendamento_id bigint, status_execucao text, descricao_evolucao text, tratativa_profissional_id bigint,
  tratativa_profissional_nome text, origem text, registrado_por_nome text,
  possui_tratativa boolean not null default false, tratativa_criada_em timestamptz, tratativa_origem text not null default 'Prontuario',
  evolucao_vinculo text not null default 'Agendamento ativo', tratativas smallint not null default 0,
  tratativas_distintas smallint not null default 0);

insert into public.pacientes values
  (1, 'Maria Souza', '12345678900', '2021-05-03', 9001, 'Unimed'),
  (2, 'João Lima',   '98765432100', '2019-01-10', 9002, 'Bradesco');
insert into public.profissionais values
  (10, 'Sara Sousa', 501, 'CRP', 'SP', '06/12345', 'profissionais/10/assinatura-1.png'),
  (11, 'Pedro Alves', 502, 'CRFa', 'SP', '2-999', null),
  (12, 'Ana Costa',   503, null, null, null, null);
insert into public.cadastro_terapias values (100, 'Psicologia ABA'), (101, 'Fonoaudiologia');

-- TiTa
insert into public.csv_grades_profissionais (tita_agendamento_id, paciente_id, paciente_nome, data, hora_inicial, hora_final,
  profissional_id, profissional_nome, terapia_nome, terapia_exibicao_nome, unidade_id, convenio_nome, status_execucao,
  possui_tratativa, tratativa_profissional_id, tratativa_profissional_nome, descricao_evolucao, ativo) values
  -- T1: normal, terapia de exibição
  (1001, 9001, 'MARIA S', '2026-08-05', '07:30', '08:00', 501, 'Sara', 'AE', 'Psicologia ABA', 280, 'Unimed', 'Realizado', true, 501, 'Sara', 'texto T1', true),
  -- T2: substituição no TiTa (executor 502)
  (1002, 9001, 'MARIA S', '2026-08-06', '08:00', '08:40', 501, 'Sara', 'FONO', null, 280, 'Unimed', 'Em Conflito', true, 502, 'Pedro', 'texto T2', true),
  -- T3: falta
  (1003, 9001, 'MARIA S', '2026-08-07', '08:00', '08:40', 501, 'Sara', 'AE', 'Psicologia ABA', 280, 'Unimed', 'Cancelado', false, null, null, null, true),
  -- T4: realizado sem texto
  (1004, 9001, 'MARIA S', '2026-08-08', '08:00', '08:40', 501, 'Sara', 'AE', 'Psicologia ABA', 280, 'Unimed', 'Realizado', true, 501, 'Sara', '   ', true),
  -- T5: inativa
  (1005, 9001, 'MARIA S', '2026-08-09', '08:00', '08:40', 501, 'Sara', 'AE', 'Psicologia ABA', 280, 'Unimed', 'Realizado', true, 501, 'Sara', 'texto T5', false),
  -- T6: repetida 3x (vira uma)
  (1006, 9002, 'JOAO L', '2026-08-10', '09:00', '09:40', 503, 'Ana', 'AE', 'Psicologia ABA', 280, 'Bradesco', 'Realizado', true, 503, 'Ana', 'texto T6', true),
  (1006, 9002, 'JOAO L', '2026-08-10', '09:00', '09:40', 503, 'Ana', 'AE', 'Psicologia ABA', 280, 'Bradesco', 'Realizado', true, 503, 'Ana', 'texto T6', true),
  (1006, 9002, 'JOAO L', '2026-08-10', '09:00', '09:40', 503, 'Ana', 'AE', 'Psicologia ABA', 280, 'Bradesco', 'Realizado', true, 503, 'Ana', 'texto T6', true),
  -- T7: tem evolução do Pulsar (P1) para o mesmo atendimento → sai
  (1007, 9002, 'JOAO L', '2026-08-11', '09:00', '09:40', 503, 'Ana', 'AE', 'Psicologia ABA', 280, 'Bradesco', 'Realizado', true, 503, 'Ana', 'texto TiTa T7', true),
  -- T8: "Sem agendamento" (sem id, status vazio) — duas linhas distintas, ficam as duas
  (null, 9002, 'JOAO L', '2026-08-12', '10:00', '10:40', 503, 'Ana', 'AE', 'Psicologia ABA', 280, 'Bradesco', null, true, 503, 'Ana', 'texto T8a', true),
  (null, 9002, 'JOAO L', '2026-08-13', '10:00', '10:40', 503, 'Ana', 'AE', 'Psicologia ABA', 280, 'Bradesco', null, true, 503, 'Ana', 'texto T8b', true),
  -- T9: outra unidade
  (1009, 9002, 'JOAO L', '2026-08-14', '10:00', '10:40', 503, 'Ana', 'AE', 'Psicologia ABA', 999, 'Bradesco', 'Realizado', true, 503, 'Ana', 'texto T9', true),
  -- T10: rótulo novo de não realização com texto (não entra)
  (1010, 9002, 'JOAO L', '2026-08-15', '10:00', '10:40', 503, 'Ana', 'AE', 'Psicologia ABA', 280, 'Bradesco', 'Não realizado — paciente', true, 503, 'Ana', 'texto T10', true),
  -- T11: espelhada como tita_importacao em G2 (entra pelo TiTa, uma vez só)
  (1011, 9002, 'JOAO L', '2026-08-16', '10:00', '10:40', 503, 'Ana', 'AE', 'Psicologia ABA', 280, 'Bradesco', 'Realizado', true, 503, 'Ana', 'texto T11', true);

-- Pulsar
insert into public.grade_agendamentos (id, data, hora_inicio, hora_fim, paciente_id, paciente_nome, profissional_id, profissional_nome,
  terapia_nome, terapia_exibicao_id, terapia_exibicao_nome, tita_agendamento_id) values
  ('11111111-1111-1111-1111-111111111111', '2026-08-11', '09:00', '09:40', 2, 'JOAO L', 12, 'Ana', 'AE', 100, 'Psico ABA velho', 1007),
  ('22222222-2222-2222-2222-222222222222', '2026-08-16', '10:00', '10:40', 2, 'JOAO L', 12, 'Ana', 'AE', 100, null, 1011),
  ('33333333-3333-3333-3333-333333333333', '2026-08-20', '11:00', '11:40', 1, 'MARIA S', 10, 'Sara', 'FONO', 101, null, null),
  ('44444444-4444-4444-4444-444444444444', '2026-08-21', '11:00', '11:40', 1, 'MARIA S', 10, 'Sara', 'FONO', 101, null, null),
  ('55555555-5555-5555-5555-555555555555', '2026-08-22', '11:00', '11:40', 1, 'MARIA S', 10, 'Sara', 'FONO', 101, null, null);
insert into public.grade_evolucoes values
  -- P1: admin evoluiu sem substituição: tratativa_profissional_nome = nome do admin
  ('11111111-1111-1111-1111-111111111111', 1007, 'Realizado', 'texto Pulsar P1', 12, 'Admin Fulano', 'pulsar', 'Admin Fulano'),
  -- G2: espelho do TiTa
  ('22222222-2222-2222-2222-222222222222', 1011, 'Realizado', 'texto T11', 12, 'Ana', 'tita_importacao', null),
  -- P3: substituição no Pulsar (executor 11)
  ('33333333-3333-3333-3333-333333333333', null, 'Realizado', 'texto Pulsar P3', 11, 'Admin Fulano', 'pulsar', 'Admin Fulano'),
  -- P4: falta registrada no Pulsar
  ('44444444-4444-4444-4444-444444444444', null, 'Cancelado', null, null, null, 'pulsar', 'Admin Fulano'),
  -- P5: espelho de falta do TiTa
  ('55555555-5555-5555-5555-555555555555', null, 'Cancelado', null, null, null, 'tita_importacao', null);
`)

const tentar = async (sql) => { try { await db.exec(sql); return '' } catch (e) { return e.message } }

await db.exec(mig)
await db.exec(mig)
await db.exec(migId)
await db.exec(migId)
{
  const vazio = new PGlite()
  await vazio.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create function public.exportar_evolucoes_listar(date, date, bigint[], text[]) returns jsonb language sql as $$ select '[]'::jsonb $$;`)
  let erro = ''
  try { await vazio.exec(migLe) } catch (e) { erro = e.message }
  ok(/20261019200300/.test(erro), 'a 200400 sem a 200300 para e pede a ordem certa')
}
await db.exec(migHist)
await db.exec(migLe)
await db.exec(migHist)
await db.exec(migLe)
ok(true, 'aplica as quatro e reroda')
ok((await db.query(`select count(*)::int n from public.grade_evolucoes where agendamento_id is null`)).rows[0].n === 7,
   'carga inicial: 7 evoluções do TiTa no arquivo (as 6 da lista + T7, que perde para o Pulsar só na leitura)')

const comoPapel = async (papel, sql, uid = null) => {
  try {
    await db.exec(`delete from auth.jwt_uid; ${uid ? `insert into auth.jwt_uid values ('${uid}');` : ''} set role ${papel}`)
    return { ok: true, rows: (await db.query(sql)).rows }
  } catch (e) {
    return { ok: false, erro: e.message }
  } finally {
    await db.exec(`reset role; delete from auth.jwt_uid`)
  }
}

const LISTAR = `select public.exportar_evolucoes_listar('2026-08-01', '2026-08-31') v`
const CONTEUDO = (chaves, fin = 'pdf') =>
  `select public.exportar_evolucoes_conteudo(array[${chaves.map(c => `'${c}'`).join(',') || ''}]::text[], '00000000-0000-0000-0000-00000000000b', 'Recepção', '${fin}') v`

// ── Privilégios ───────────────────────────────────────────────────────────────
for (const papel of ['anon', 'authenticated']) {
  const l = await comoPapel(papel, LISTAR, '00000000-0000-0000-0000-00000000000a')
  ok(!l.ok && /permission denied/.test(l.erro), `${papel} não executa exportar_evolucoes_listar (nem admin logado)`)
  const c = await comoPapel(papel, CONTEUDO(['tita:00000000-0000-0000-0000-000000000000']))
  ok(!c.ok && /permission denied/.test(c.erro), `${papel} não executa exportar_evolucoes_conteudo`)
  const fo = await comoPapel(papel, `select * from public.sp_exportar_evolucoes_fonte(null, null)`)
  ok(!fo.ok && /permission denied/.test(fo.erro), `${papel} não executa a fonte interna`)
}
const foSrv = await comoPapel('service_role', `select * from public.sp_exportar_evolucoes_fonte(null, null)`)
ok(!foSrv.ok && /permission denied/.test(foSrv.erro), 'nem service_role chama a fonte interna direto')

const lista = await comoPapel('service_role', LISTAR)
ok(lista.ok, 'service_role executa a listagem')
const itens = lista.rows?.[0]?.v ?? []
const porTexto = {}

// ── Regras da listagem ────────────────────────────────────────────────────────
ok(itens.every(i => !('descricao' in i)), 'listagem não traz o texto')
const chaves = itens.map(i => i.chave)
const tita = itens.filter(i => i.origem === 'tita')
const pulsar = itens.filter(i => i.origem === 'pulsar')
ok(tita.length === 6, `TiTa: T1, T2, T6 (uma vez), T8a, T8b, T11 → ${tita.length}`)
ok(pulsar.length === 2, `Pulsar: P1 e P3 → ${pulsar.length}`)
ok(!itens.some(i => i.data === '2026-08-11' && i.origem === 'tita'), 'linha do TiTa repetida some quando existe a do Pulsar')
ok(itens.filter(i => i.data === '2026-08-16').length === 1, 'tita_importacao não entra (atendimento T11 aparece uma vez, pelo TiTa)')
ok(!itens.some(i => ['2026-08-07', '2026-08-15', '2026-08-21', '2026-08-22'].includes(i.data)), 'falta, cancelamento e "Não realizado" não entram')
ok(!itens.some(i => ['2026-08-08', '2026-08-09', '2026-08-14'].includes(i.data)), 'sem texto, inativa e outra unidade não entram')
ok(itens.filter(i => i.data === '2026-08-10').length === 1, 'linhas idênticas do TiTa viram uma')
ok(itens.some(i => i.data === '2026-08-06'), '"Em Conflito" com evolução entra')

const t1 = itens.find(i => i.data === '2026-08-05')
ok(t1.terapia === 'Psicologia ABA' && t1.paciente_nome === 'Maria Souza' && t1.paciente_id === 1, 'TiTa: terapia de exibição e paciente do cadastro')
ok(t1.convenio === 'Unimed' && t1.tem_assinatura === true && t1.hora_inicio === '07:30', 'card traz convênio, assinatura e horário HH:MI')
const t2 = itens.find(i => i.data === '2026-08-06')
ok(t2.terapia === 'FONO', 'exibição vazia → terapia agendada como reserva')
ok(t2.profissional_nome === 'Pedro Alves' && t2.substituicao === true, 'TiTa: executor é o substituto')
const p1 = itens.find(i => i.data === '2026-08-11')
ok(p1.origem === 'pulsar' && p1.profissional_nome === 'Ana Costa' && p1.substituicao === false, 'Pulsar: profissional é o do cadastro, não o admin que digitou')
ok(p1.terapia === 'Psicologia ABA', 'Pulsar: terapia de exibição pelo cadastro_terapias')
ok(t1.agendamento_id === '1001', 'ID do agendamento: o do TiTa')
ok(itens.filter(i => i.data === '2026-08-12' || i.data === '2026-08-13').every(i => i.agendamento_id === null), '"Sem agendamento" sai sem ID')
ok(p1.agendamento_id === '1007', 'Pulsar com par no TiTa: o ID do TiTa')
const p3 = itens.find(i => i.data === '2026-08-20')
ok(p3.agendamento_id === '33333333-3333-3333-3333-333333333333', 'Pulsar sem par no TiTa: o id da Grade')
ok(p3.profissional_nome === 'Pedro Alves' && p3.substituicao === true, 'Pulsar: substituto quando houve troca')
ok(itens[0].paciente_nome === 'João Lima' && itens.at(-1).paciente_nome === 'Maria Souza', 'ordem por paciente')

// ── Filtros e limites ─────────────────────────────────────────────────────────
const soMaria = await comoPapel('service_role', `select public.exportar_evolucoes_listar('2026-08-01', '2026-08-31', array[1]::bigint[]) v`)
ok(soMaria.rows[0].v.every(i => i.paciente_id === 1) && soMaria.rows[0].v.length === 3, 'filtro de paciente')
const soFono = await comoPapel('service_role', `select public.exportar_evolucoes_listar('2026-08-01', '2026-08-31', null, array['Fonoaudiologia']) v`)
ok(soFono.rows[0].v.length === 1 && soFono.rows[0].v[0].data === '2026-08-20', 'filtro de terapia (de exibição)')
const vazio = await comoPapel('service_role', `select public.exportar_evolucoes_listar('2026-08-01', '2026-08-31', '{}'::bigint[], '{}'::text[]) v`)
ok(vazio.rows[0].v.length === itens.length, 'filtro vazio = todos')
const doze = await comoPapel('service_role', `select public.exportar_evolucoes_listar('2026-01-01', '2026-12-31') v`)
ok(doze.ok, '12 meses exatos passam')
const treze = await comoPapel('service_role', `select public.exportar_evolucoes_listar('2026-01-01', '2027-01-01') v`)
ok(!treze.ok && /12 meses/.test(treze.erro), 'mais de 12 meses recusa com mensagem clara')
const inv = await comoPapel('service_role', `select public.exportar_evolucoes_listar('2026-08-31', '2026-08-01') v`)
ok(!inv.ok && /anterior/.test(inv.erro), 'período invertido recusa')

// ── Conteúdo + registro ───────────────────────────────────────────────────────
const conteudo = await comoPapel('service_role', CONTEUDO([...chaves, 'tita:lixo', 'tita:------------------------------------', 'pulsar:44444444-4444-4444-4444-444444444444', 'pulsar:22222222-2222-2222-2222-222222222222', 'drop table x']))
ok(conteudo.ok, 'service_role lê o conteúdo')
const cont = conteudo.rows[0].v
ok(cont.length === chaves.length, `chave inválida, falta e tita_importacao são ignoradas sem erro (${cont.length}/${chaves.length})`)
const c1 = cont.find(i => i.data === '2026-08-05')
ok(c1.agendamento_id === '1001', 'conteúdo traz o ID do agendamento')
ok(c1.descricao === 'texto T1' && c1.paciente_cpf === '12345678900' && c1.paciente_nascimento === '2021-05-03', 'conteúdo traz texto, CPF e nascimento')
ok(c1.tipo_registro === 'CRP' && c1.codigo_registro === '06/12345' && c1.uf_registro === 'SP', 'conteúdo traz o registro do executor')
const cp1 = cont.find(i => i.data === '2026-08-11')
ok(cp1.descricao === 'texto Pulsar P1' && cp1.registrado_por_nome === 'Admin Fulano', 'Pulsar: texto do Pulsar, "registrado por" só como informação interna')

const reg = (await db.query(`select * from public.exportar_evolucoes_registro order by id`)).rows
ok(reg.length === 1 && reg[0].finalidade === 'pdf' && reg[0].quantidade === chaves.length && reg[0].usuario_nome === 'Recepção', 'leitura gravada no registro')
ok(String(reg[0].periodo_de?.toISOString?.() ?? reg[0].periodo_de).startsWith('2026-08-05') && reg[0].paciente_ids.length === 2 && reg[0].chaves.length === chaves.length, 'registro com período, pacientes e chaves')

const nada = await comoPapel('service_role', CONTEUDO(['tita:lixo']))
ok(nada.ok && nada.rows[0].v.length === 0, 'só chave inválida → lista vazia')
ok((await db.query(`select count(*)::int n from public.exportar_evolucoes_registro`)).rows[0].n === 1, 'pedido sem nada lido não grava registro')
const muitas = await comoPapel('service_role', CONTEUDO(Array.from({ length: 501 }, (_, i) => `tita:${String(i).padStart(8, '0')}-0000-0000-0000-000000000000`)))
ok(!muitas.ok && /500/.test(muitas.erro), 'mais de 500 chaves recusa')
const fin = await comoPapel('service_role', CONTEUDO([chaves[0]], 'outra'))
ok(!fin.ok && /Finalidade/.test(fin.erro), 'finalidade inválida recusa')

// ── A fonte é o arquivo, não a cópia ─────────────────────────────────────────
await db.exec(`select public.sp_grade_evolucoes_arquivar_tita(jsonb_build_array(jsonb_build_object(
  'tita_agendamento_id', 555, 'paciente_id', 9001, 'paciente_nome', 'MARIA S', 'data', '2026-01-14', 'hora_inicial', '08:00',
  'hora_final', '08:40', 'profissional_id', 501, 'profissional_nome', 'Sara', 'terapia_nome', 'AE', 'terapia_exibicao_nome', 'Psicologia ABA',
  'unidade_id', 280, 'convenio_nome', 'Unimed', 'status_execucao', 'Realizado', 'possui_tratativa', true, 'tratativa_profissional_id', 501,
  'descricao_evolucao', 'Evolução de janeiro, só no arquivo')))`)
const jan = (await comoPapel('service_role', `select public.exportar_evolucoes_listar('2026-01-01', '2026-01-31') v`)).rows[0].v
ok(jan.length === 1 && jan[0].agendamento_id === '555' && jan[0].paciente_nome === 'Maria Souza' && jan[0].terapia === 'Psicologia ABA',
   'evolução de janeiro que só existe no arquivo aparece na lista')
await db.exec(`delete from public.csv_grades_profissionais where tita_agendamento_id = 1001`)
const semCopia = (await comoPapel('service_role', LISTAR)).rows[0].v
ok(semCopia.some(i => i.agendamento_id === '1001'), 'apagar a linha da cópia não tira a evolução da lista (fica guardada)')
ok(chaves.every(c => /^(tita:[0-9]+|pulsar:[0-9a-f-]{36})$/.test(c)), 'chave do TiTa agora é o id da grade_evolucoes')

// ── Registro: só admin lê; ninguém escreve pelo REST ─────────────────────────
const regAdmin = await comoPapel('authenticated', `select count(*)::int n from public.exportar_evolucoes_registro`, '00000000-0000-0000-0000-00000000000a')
ok(regAdmin.ok && regAdmin.rows[0].n === 1, 'admin lê o registro')
const regRec = await comoPapel('authenticated', `select count(*)::int n from public.exportar_evolucoes_registro`, '00000000-0000-0000-0000-00000000000b')
ok(regRec.ok && regRec.rows[0].n === 0, 'login comum não vê o registro')
const regAnon = await comoPapel('anon', `select count(*) from public.exportar_evolucoes_registro`)
ok(!regAnon.ok && /permission denied/.test(regAnon.erro), 'anon não lê o registro')
const regIns = await comoPapel('authenticated', `insert into public.exportar_evolucoes_registro (usuario_nome, finalidade, quantidade) values ('x', 'pdf', 1)`, '00000000-0000-0000-0000-00000000000a')
ok(!regIns.ok && /permission denied/.test(regIns.erro), 'nem admin grava no registro pelo REST')
const regDel = await comoPapel('authenticated', `delete from public.exportar_evolucoes_registro`, '00000000-0000-0000-0000-00000000000a')
ok(!regDel.ok && /permission denied/.test(regDel.erro), 'nem admin apaga o registro pelo REST')

process.exit(f ? 1 : 0)
