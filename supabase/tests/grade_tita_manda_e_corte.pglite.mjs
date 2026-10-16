// Teste da migration 20261016100000 (Grade × TiTa: "o TiTa manda" + proteção
// do que é do Pulsar + trava do corte) no PGlite (Postgres de verdade em Node).
//
// Roda a cadeia REAL: terapias → profissionais → disponibilidade → Grade
// (100000–100300) → log do TiTa (20261015190000) → esta. Stubs só para o que
// vem de antes (pacientes, feriados, cópias do TiTa).
//
// O CICLO que o usuário exigiu:
//   rodada 1: importa sessões e um bloqueio do TiTa; sessão igual a uma criada
//             no Pulsar não é tocada; vínculo antigo em sessão do Pulsar é solto.
//   rodada 2: o TiTa muda a sala de uma sessão (alterada), apaga outra (sumida),
//             apaga o bloqueio, e uma sessão excluída no Pulsar continua no TiTa
//             (volta). As sessões CRIADAS NO PULSAR ficam intactas.
//   guarda:   nem a importação nem um bug conseguem excluir/alterar sessão do
//             Pulsar ou grudar id do TiTa nela.
//   frescor:  cópia velha (> 30 h) não aplica.
//   corte:    depois do corte nenhuma importação roda; a repetição automática
//             continua; nada novo nasce com id do TiTa.
//   segurança: anon e logado sem permissão não leem os itens nem a trava.
//
// Rodar FORA do repo:
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   cp <repo>/supabase/tests/grade_tita_manda_e_corte.pglite.mjs /tmp/pg/
//   node /tmp/pg/grade_tita_manda_e_corte.pglite.mjs <repo>
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
const todos = async (sql, params = []) => (await db.query(sql, params)).rows

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
create table public.pacientes_importacoes_log (id uuid primary key default gen_random_uuid(), origem text);
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

console.log('1. cadeia de migrations')
for (const p of ['20261006120000', '20261006120100', '20261006130000', '20261006140000', '20261006170000',
                 '20261005170000', '20261008100000', '20261008100100', '20261008100200', '20261008100300',
                 '20261015190000']) {
  await db.exec(arquivo(p))
}
ok(true, 'Grade e log do TiTa como estão em produção')

// Massa: profissional 501 (Pedro), pacientes Ana (9001) e Beto (9002), ABA.
const D = n => `current_date + ${n}` // n dias a partir de hoje
await db.exec(`
insert into public.profissionais (nome, tita_profissional_id, origem) values ('Pedro Prof', 501, 'tita');
insert into public.pacientes (tita_paciente_id, nome) values (9001, 'Ana Paciente'), (9002, 'Beto Paciente');
insert into public.cadastro_terapias (nome) values ('ABA') on conflict on constraint cadastro_terapias_nome_unico do nothing;
insert into public.grade_sync_dia (data, modo, unidade_id, sincronizado_em)
  select d::date, 'grade', 280, now() from generate_series(current_date, current_date + 40, interval '1 day') d;
`)
const PROF = (await um(`select id from public.profissionais where tita_profissional_id = 501`)).id
const ANA = (await um(`select id_paciente from public.pacientes where tita_paciente_id = 9001`)).id_paciente
const BETO = (await um(`select id_paciente from public.pacientes where tita_paciente_id = 9002`)).id_paciente
const ABA = (await um(`select id from public.cadastro_terapias where nome = 'ABA'`)).id

// Sessão "criada no Pulsar" (insere como dono, simulando a RPC da Grade).
async function sessaoPulsar(paciente, nome, dias, hora, titaId = null) {
  await db.query(`
    with s as (
      insert into public.grade_series (paciente_id, profissional_id, terapia_id, terapia_nome, dia_semana, hora_inicio, hora_fim,
                                       frequencia, intervalo_semanas, data_inicio, data_fim, materializada_ate, origem, criado_por_nome)
      values ($1, $2, $3, 'ABA', extract(dow from ${D(dias)})::smallint, $4::time, $4::time + interval '40 min',
              'unica', 1, ${D(dias)}, ${D(dias)}, ${D(dias)}, 'pulsar', 'Recepção')
      returning id)
    insert into public.grade_agendamentos (serie_id, data, hora_inicio, hora_fim, paciente_id, paciente_nome,
                                           profissional_id, profissional_nome, terapia_id, terapia_nome, origem, tita_agendamento_id, criado_por_nome)
    select s.id, ${D(dias)}, $4::time, $4::time + interval '40 min', $1, $5, $2, 'Pedro Prof', $3, 'ABA', 'pulsar', $6, 'Recepção' from s`,
    [paciente, PROF, ABA, hora, nome, titaId])
}
await sessaoPulsar(BETO, 'Beto Paciente', 9, '10:00')            // P1: horário só do Pulsar
await sessaoPulsar(BETO, 'Beto Paciente', 10, '08:00')           // P2: igual a uma do TiTa (1005)
await sessaoPulsar(ANA, 'Ana Paciente', 11, '11:00', 1006)       // P3: vínculo antigo (id do TiTa grudado)
const pulsarAntes = await todos(`select id, situacao, tita_agendamento_id from public.grade_agendamentos where origem = 'pulsar' order by data`)

console.log('2. migration nova (duas vezes)')
const mig = arquivo('20261016100000')
await db.exec(mig)
await db.exec(mig)
ok(true, 'roda e reroda')
const p3 = await um(`select tita_agendamento_id, tita_ref_historica from public.grade_agendamentos where origem = 'pulsar' and hora_inicio = '11:00'`)
ok(p3.tita_agendamento_id === null && Number(p3.tita_ref_historica) === 1006, 'vínculo antigo em sessão do Pulsar foi solto (id guardado só como referência)')

// TiTa: S1/S2 Ana seg 08:00 (duas semanas), S3 Beto 09:00, S5 igual à P2, bloqueio, S6 = slot da P3.
const sala1 = 'Unid. Centro - Sala 1'
await db.exec(`
insert into public.csv_grades_profissionais (tita_agendamento_id, data, hora_inicial, hora_final, paciente_id, paciente_nome,
  profissional_id, profissional_nome, terapia_id, terapia_nome, sala_nome) values
  (1001, ${D(7)},  '08:00', '08:40', 9001, 'Ana Paciente',  501, 'Pedro Prof', 77, 'ABA', '${sala1}'),
  (1002, ${D(14)}, '08:00', '08:40', 9001, 'Ana Paciente',  501, 'Pedro Prof', 77, 'ABA', '${sala1}'),
  (1008, ${D(28)}, '08:00', '08:40', 9001, 'Ana Paciente',  501, 'Pedro Prof', 77, 'ABA', '${sala1}'),
  (1003, ${D(7)},  '09:00', '09:40', 9002, 'Beto Paciente', 501, 'Pedro Prof', 77, 'ABA', '${sala1}'),
  (1005, ${D(10)}, '08:00', '08:40', 9002, 'Beto Paciente', 501, 'Pedro Prof', 77, 'ABA', '${sala1}'),
  (1004, ${D(7)},  '12:00', '13:00', 7777, 'Horário Bloqueado', 501, 'Pedro Prof', 77, 'ABA', '${sala1}'),
  (1006, ${D(11)}, '11:00', '11:40', 9001, 'Ana Paciente',  501, 'Pedro Prof', 77, 'ABA', '${sala1}');
`)

async function como(papel, uid = '') {
  await db.exec(`reset role; set request.jwt.claim.sub = '${uid}'; set role ${papel};`)
}
const dono = () => db.exec(`reset role; set request.jwt.claim.sub = '';`)
async function importar() {
  await como('authenticated', EDITOR)
  const pv = (await um(`select public.grade_importar_tita_previa(current_date, current_date + 30) r`)).r
  const ap = (await um(`select public.grade_importar_tita_aplicar($1::uuid, true, $2::bigint[]) r`, [pv.importacao_id, pv.profissionais])).r
  await um(`select public.grade_importar_tita_concluir($1::uuid)`, [pv.importacao_id])
  await dono()
  return { pv, ap: ap.aplicado, id: pv.importacao_id }
}
const pulsarIntacto = async () => {
  const agora = await todos(`select id, situacao, tita_agendamento_id from public.grade_agendamentos where origem = 'pulsar' order by data`)
  return agora.length === 3 && agora.every((a, i) => a.id === pulsarAntes[i].id && a.situacao === 'agendado' && a.tita_agendamento_id === null)
}

console.log('3. rodada 1')
let r = await importar()
ok(r.pv.contadores.novos === 4 && r.pv.contadores.ja_no_pulsar === 2 && r.pv.contadores.bloqueios_novos === 1,
  `prévia: 4 novas, 2 já do Pulsar, 1 bloqueio (${JSON.stringify(r.pv.contadores)})`)
ok(r.ap.sessoes_novas === 4 && r.ap.series_novas === 2 && r.ap.bloqueios === 1, 'aplicou 4 sessões em 2 séries e 1 bloqueio')
ok((await um(`select data_fim from public.grade_series where origem = 'tita_importacao' and hora_inicio = '08:00'`)).data_fim === null,
  'série que vai até o fim da janela fica contínua')
ok(await pulsarIntacto(), 'sessões criadas no Pulsar intactas e sem id do TiTa')
let itens = await todos(`select tipo, count(*)::int n from public.grade_importacoes_itens where importacao_id = $1 group by tipo`, [r.id])
ok(itens.find(i => i.tipo === 'novo')?.n === 4 && itens.find(i => i.tipo === 'bloqueio')?.n === 1, 'itens do relatório gravados')

console.log('4. rodada 2: o TiTa muda')
await db.exec(`
update public.csv_grades_profissionais set sala_nome = 'Unid. Centro - Sala 2' where tita_agendamento_id = 1001;
update public.csv_grades_profissionais set ativo = false where tita_agendamento_id in (1003, 1004);
insert into public.csv_grades_profissionais (tita_agendamento_id, data, hora_inicial, hora_final, paciente_id, paciente_nome,
  profissional_id, profissional_nome, terapia_id, terapia_nome, sala_nome) values
  (1007, ${D(9)}, '10:00', '10:40', 9002, 'Beto Paciente', 501, 'Pedro Prof', 77, 'ABA', '${sala1}');
-- Alguém exclui a 1002 no Pulsar (ela continua no TiTa).
update public.grade_agendamentos set situacao = 'excluido', excluido_em = now(), escopo_exclusao = 'somente_esta',
  motivo_exclusao = 'paciente pediu' where tita_agendamento_id = 1002;
`)
r = await importar()
const c = r.pv.contadores
ok(c.alterados === 1 && c.sumidos === 1 && c.restaurados === 1 && c.desfaz_pulsar === 1 && c.bloqueios_sumidos === 1 && c.ja_no_pulsar === 3,
  `prévia: 1 alterada, 1 sumida, 1 volta (desfaz exclusão do Pulsar), 1 bloqueio some, 3 do Pulsar (${JSON.stringify(c)})`)
ok(r.ap.alteradas === 1 && r.ap.restauradas === 1 && r.ap.sumidos_excluidos >= 1 && r.ap.bloqueios_excluidos === 1, `aplicou (${JSON.stringify(r.ap)})`)
const s1 = await todos(`select situacao, sala_nome, motivo_exclusao from public.grade_agendamentos where tita_agendamento_id = 1001 order by criado_em`)
ok(s1.length === 2 && s1[0].situacao === 'excluido' && /Alterado no TiTa/.test(s1[0].motivo_exclusao)
   && s1[1].situacao === 'agendado' && s1[1].sala_nome === 'Unid. Centro - Sala 2', 'alterada: a antiga sai com o motivo, a nova entra com a sala nova')
ok((await um(`select situacao from public.grade_agendamentos where tita_agendamento_id = 1003`)).situacao === 'excluido', 'sumida do TiTa saiu')
const s2 = await todos(`select situacao from public.grade_agendamentos where tita_agendamento_id = 1002 order by criado_em`)
ok(s2.length === 2 && s2[0].situacao === 'excluido' && s2[1].situacao === 'agendado', 'excluída no Pulsar e ainda no TiTa: voltou (a exclusão fica de rastro)')
ok((await um(`select situacao from public.grade_bloqueios where tita_chave = 'A:1004'`)).situacao === 'excluido', 'bloqueio sumido saiu')
ok(await pulsarIntacto(), 'sessões criadas no Pulsar continuam intactas (inclusive a do mesmo horário da 1007)')
itens = await todos(`select tipo, de from public.grade_importacoes_itens where importacao_id = $1`, [r.id])
ok(itens.some(i => i.tipo === 'alterado' && /Sala 1/.test(i.de ?? '')) && itens.some(i => i.tipo === 'sumido') && itens.some(i => i.tipo === 'restaurado'),
  'relatório: alterada com o "de", sumida e restaurada')
r = await importar()
ok(!r.pv.contadores.novos && !r.pv.contadores.alterados && !r.pv.contadores.sumidos && !r.pv.contadores.restaurados, 'rodada 3 sem mudança no TiTa: nada a fazer')

console.log('5. guarda')
const P1 = pulsarAntes[0].id
let e = null
try {
  await db.transaction(async tx => {
    await tx.query(`select set_config('pulsar.contexto', 'importacao_tita', true)`)
    await tx.query(`update public.grade_agendamentos set lote_id = gen_random_uuid() where id = '${P1}'`)
  })
} catch (x) { e = x }
ok(e && /Proteção/.test(e.message), 'durante a importação, nada do Pulsar pode ser tocado')
e = await erro(`update public.grade_agendamentos set situacao = 'excluido', excluido_em = now(), escopo_exclusao = 'importacao_tita'
  where id = '${P1}'`)
ok(e && /Proteção/.test(e.message), 'exclusão "pela importação" em sessão do Pulsar é recusada sempre')
e = await erro(`update public.grade_agendamentos set tita_agendamento_id = 4242 where id = '${P1}'`)
ok(e && /Proteção/.test(e.message), 'sessão do Pulsar não recebe id do TiTa')
ok(await pulsarIntacto(), 'nada mudou nas sessões do Pulsar')

console.log('6. frescor')
await db.exec(`update public.grade_sync_dia set sincronizado_em = now() - interval '31 hours' where data = current_date + 12`)
await como('authenticated', EDITOR)
const pv = (await um(`select public.grade_importar_tita_previa(current_date, current_date + 30) r`)).r
ok(pv.copia_velha === true, 'a prévia avisa que a cópia está velha')
e = await erro(`select public.grade_importar_tita_aplicar($1::uuid, true, null)`, [pv.importacao_id])
ok(e && /velha/.test(e.message), 'cópia com mais de 30 h não aplica')
await dono()
await db.exec(`update public.grade_sync_dia set sincronizado_em = now()`)

console.log('7. segurança')
await como('anon')
ok(await erro(`select * from public.grade_importacoes_itens`), 'anon não lê os itens')
ok(await erro(`select * from public.sistema_tita_corte`), 'anon não lê a trava')
ok(await erro(`select public.tita_cortado_em()`), 'anon não consulta o corte')
await como('authenticated', OUTRO)
ok(Number((await um(`select count(*) n from public.grade_importacoes_itens`)).n) === 0, 'sem cronograma_grade: não vê nenhum item')
ok(await erro(`select * from public.sistema_tita_corte`), 'logado não lê a tabela da trava')
ok((await um(`select public.tita_cortado_em() t`)).t === null, 'logado consulta se houve corte (ainda não)')
ok(await erro(`select public.grade_importar_tita_previa(current_date, current_date + 30)`), 'sem cronograma_grade não importa')
await dono()

console.log('8. corte')
await db.exec(`insert into public.sistema_tita_corte (cortado_por_nome) values ('Teste')`)
await como('authenticated', EDITOR)
e = await erro(`select public.grade_importar_tita_previa(current_date, current_date + 30)`)
ok(e && /desligado/.test(e.message), 'Grade: importação recusada depois do corte')
await dono()
ok(/desligado/.test((await erro(`insert into public.pacientes_importacoes_log (origem) values ('cron')`))?.message ?? ''), 'pacientes: log recusado (a importação não roda)')
ok(/desligado/.test((await erro(`insert into public.tita_importacoes (alvo) values ('profissionais')`))?.message ?? ''), 'profissionais/disponibilidade: log recusado')
ok(/desligado/.test((await erro(`insert into public.grade_agendamentos (data, hora_inicio, hora_fim, paciente_id, paciente_nome,
  profissional_id, profissional_nome, terapia_id, terapia_nome, origem, tita_agendamento_id)
  values (current_date + 20, '15:00', '15:40', ${ANA}, 'Ana', ${PROF}, 'Pedro', ${ABA}, 'ABA', 'tita_importacao', 9999)`))?.message ?? ''),
  'nenhuma sessão nova nasce com id do TiTa')
let ext = null
try { ext = (await um(`select public.grade_estender_series() r`)).r } catch (x) { console.log('   erro:', x.message) }
// Sem disponibilidade cadastrada as datas caem como "puladas"; o que importa é a
// série do TiTa continuar sendo considerada, sem erro e sem ler o TiTa.
ok(ext && ext.series >= 1, `a repetição automática continua e considera a série vinda do TiTa (${JSON.stringify(ext)})`)

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.')
process.exit(falhas ? 1 : 0)
