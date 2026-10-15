// Teste da migration 20261015190000 (Sincronização do TiTa sob demanda:
// log comum + disponibilidade em massa + log da importação de profissionais)
// no PGlite (Postgres de verdade em Node, sem Docker).
//
// Roda a cadeia REAL de migrations de que ela depende (terapias, profissionais,
// disponibilidade) com o mínimo de stubs para o que vem de antes.
//
// Prova: a migration roda e reroda; anon não lê nem executa nada; logado sem a
// permissão não lê o log (RLS) nem executa as RPCs; ninguém grava no log direto;
// a importação de profissionais grava novos e alterados com de→para e CPF só
// mascarado; a prévia ignora o nome mandado pela tela, descarta a anterior e
// recusa data no passado; aplicar cria a versão 'preenchido_tita', encerra a
// versão manual na véspera, habilita a terapia que o TiTa mostra e anota o erro
// de um profissional sem derrubar o lote; concluir fecha como 'parcial'; prévia
// concluída ou com mais de 6 horas não aplica.
//
// Rodar FORA do repo (o pacote não é dependência do projeto):
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   cp <repo>/supabase/tests/tita_importacoes_disponibilidade.pglite.mjs /tmp/pg/
//   node /tmp/pg/tita_importacoes_disponibilidade.pglite.mjs <repo>
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

const ADMIN = '00000000-0000-0000-0000-0000000000a1'
const EDITOR = '00000000-0000-0000-0000-0000000000b1'   // tem cadastros_profissionais
const OUTRO = '00000000-0000-0000-0000-0000000000c1'    // logado, sem a permissão
const INATIVO = '00000000-0000-0000-0000-0000000000f1'  // admin desativado

await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '') $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- Como no Supabase: tudo nasce com grant amplo; a migration é quem fecha.
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

create table public.cadastros_auditoria (
  id uuid primary key default gen_random_uuid(), tabela text not null, registro_id text not null, acao text not null,
  paciente_id bigint, paciente_nome text, convenio_nome text, alvo_nome text, antes jsonb, depois jsonb,
  resumo text, motivo text, usuario_id uuid, usuario_nome text,
  criado_em timestamptz not null default now(), criado_em_brasilia text);
create table public.csv_grades_profissionais (
  id uuid primary key default gen_random_uuid(), profissional_id bigint, profissional_nome text,
  profissional_cpf text, data date, terapia_nome text, ativo boolean default true);
create table public.grade_profissionais_tita (
  profissional_id bigint, data date, numero_telefone text, cbo_profissional text, registro_profissional text,
  tipo_registro_profissional text, uf_registro_profissional text);
create table public.cronograma_salas (
  id uuid primary key default gen_random_uuid(), nome_exibicao text, unidade_nome text, numero_sala text,
  capacidade text default 'unico', status text default 'ativa', sala_nome_referencia text);
create table public.cronograma_salas_terapias_exclusivas (sala_id uuid, terapia_id bigint, terapia_nome text, modo text);

insert into public.usuarios values
  ('${ADMIN}', 'Ana Admin', 'ana@exemplo.com', 'admin', true),
  ('${EDITOR}', 'Edu Editor', 'edu@exemplo.com', 'cronograma', true),
  ('${OUTRO}', 'Olga Outra', 'olga@exemplo.com', 'recepcao', true),
  ('${INATIVO}', 'Ivo Inativo', 'ivo@exemplo.com', 'admin', false);
insert into public.usuarios_permissoes values ('${EDITOR}', 'cadastros_profissionais', true),
                                              ('${OUTRO}', 'cadastros_pacientes', true);
`)

console.log('1. cadeia de migrations + a nova (duas vezes)')
for (const p of ['20261006120000', '20261006120100', '20261006130000', '20261006140000', '20261006170000']) {
  await db.exec(arquivo(p))
}
// De 20261008100100 só a capacidade da faixa e a versão atual da gravação de
// faixas (o resto do arquivo é da Grade).
const m100 = arquivo('20261008100100')
const ini = m100.indexOf('create or replace function public.sp_prof_disp_gravar_faixas')
await db.exec(`alter table public.profissionais_disponibilidade_faixas add column if not exists capacidade smallint not null default 1;
${m100.slice(ini, m100.indexOf('end $$;', ini) + 'end $$;'.length)}`)
const mig = arquivo('20261015190000')
await db.exec(mig)
ok(true, 'primeira execução')
await db.exec(mig)
ok(true, 'segunda execução (idempotente)')

// Massa: 2 terapias, 2 salas, 3 profissionais no TiTa (101 e 102 já no Pulsar).
await db.exec(`
insert into public.cadastro_terapias (nome) values ('ABA'), ('Fonoaudiologia') on conflict on constraint cadastro_terapias_nome_unico do nothing;
insert into public.cronograma_salas (id, nome_exibicao, unidade_nome, numero_sala) values
  ('11111111-1111-1111-1111-111111111111', 'Sala 1', 'Unid. Centro', '1'),
  ('22222222-2222-2222-2222-222222222222', 'Sala 2', 'Unid. Centro', '2');
insert into public.profissionais (nome, tita_profissional_id, origem, cpf) values
  ('Paula Primeira', 101, 'tita', '11122233344'),
  ('Pedro Segundo', 102, 'tita', null);
insert into public.csv_grades_profissionais (profissional_id, profissional_nome, profissional_cpf, data, terapia_nome) values
  (101, 'Paula Primeira', '111.222.333-44', current_date, 'ABA'),
  (102, 'Pedro Segundo', '555.666.777-88', current_date, 'ABA'),
  (103, 'Nina Nova', '999.888.777-66', current_date, 'Fonoaudiologia');
insert into public.grade_profissionais_tita (profissional_id, data, numero_telefone) values
  (101, current_date, '(11) 98888-7777');
`)
const id = async nome => (await um(`select id from public.profissionais where nome = $1`, [nome])).id
const P1 = await id('Paula Primeira'), P2 = await id('Pedro Segundo')
const ABA = (await um(`select id from public.cadastro_terapias where nome = 'ABA'`)).id
const FONO = (await um(`select id from public.cadastro_terapias where nome = 'Fonoaudiologia'`)).id

async function como(papel, uid = '') {
  await db.exec(`reset role; set request.jwt.claim.sub = '${uid}'; set role ${papel};`)
}
const superuser = () => db.exec(`reset role; set request.jwt.claim.sub = '';`)

console.log('2. anon')
await como('anon')
for (const t of ['tita_importacoes', 'tita_importacoes_itens']) ok(await erro(`select * from public.${t}`), `anon não lê ${t}`)
ok(await erro(`select public.profissionais_importar_tita()`), 'anon não importa profissionais')
ok(await erro(`select public.tita_importacao_disponibilidade_previa(current_date, current_date, current_date, 0, '[]')`), 'anon não grava prévia')
ok(await erro(`select public.tita_importacao_disponibilidade_aplicar(gen_random_uuid(), '{}')`), 'anon não aplica')
ok(await erro(`select public.tita_importacao_concluir(gen_random_uuid())`), 'anon não conclui')
ok(await erro(`select public.sp_mascarar_cpf('11122233344')`), 'anon não executa a máscara (função interna)')

console.log('3. importação de profissionais com log')
await como('authenticated', OUTRO)
let e = await erro(`select public.profissionais_importar_tita()`)
ok(e && /Sem permissão/.test(e.message), 'logado sem a permissão não importa')
await como('authenticated', EDITOR)
let r = (await um(`select public.profissionais_importar_tita() r`)).r
ok(r.importacao_id && r.novos === 1 && r.vistos_na_tita === 3, `devolve o id do log, 1 novo e 3 vistos (${JSON.stringify(r)})`)
let log = await um(`select * from public.tita_importacoes where id = $1`, [r.importacao_id])
ok(log.alvo === 'profissionais' && log.situacao === 'sucesso' && log.novos === 1 && log.usuario_nome === 'Edu Editor', 'log de sucesso com autor')
let novo = await um(`select * from public.tita_importacoes_itens where importacao_id = $1 and tipo = 'novo'`, [r.importacao_id])
ok(novo.nome === 'Nina Nova' && Number(novo.tita_id) === 103 && novo.resumo === 'CPF ***.888.777-**', `item novo com CPF mascarado (${novo.resumo})`)
let alt = (await db.query(`select * from public.tita_importacoes_itens where importacao_id = $1 and tipo = 'alterado' order by nome`, [r.importacao_id])).rows
const paula = alt.find(a => a.nome === 'Paula Primeira')
ok(paula && paula.mudancas.some(m => m.campo === 'Celular' && m.de === null && m.para === '11988887777'), 'Celular vazio preenchido aparece como de→para')
const pedro = alt.find(a => a.nome === 'Pedro Segundo')
ok(pedro && pedro.mudancas.some(m => m.campo === 'CPF' && m.para === '***.666.777-**'), 'CPF preenchido aparece mascarado')
const todoLog = JSON.stringify((await db.query(`select * from public.tita_importacoes_itens`)).rows)
ok(!/99988877766|55566677788|11122233344/.test(todoLog), 'nenhum CPF inteiro no log')
r = (await um(`select public.profissionais_importar_tita() r`)).r
ok(r.novos === 0 && r.atualizados === 0, 'reimportar sem mudança no TiTa: 0 novos, 0 alterados')
await superuser()
await db.exec(`update public.grade_profissionais_tita set cbo_profissional = '251510'`)
await db.exec(`update public.profissionais set cbo = '999999' where id = ${P1}`)
await como('authenticated', EDITOR)
r = (await um(`select public.profissionais_importar_tita() r`)).r
alt = (await db.query(`select mudancas from public.tita_importacoes_itens where importacao_id = $1 and tipo = 'alterado'`, [r.importacao_id])).rows
ok(alt.length === 1 && alt[0].mudancas.some(m => m.campo === 'CBO (no TiTa; o do Pulsar foi mantido)' && m.para === '251510'),
  'mudança no TiTa de campo editado no Pulsar: mostra, mas mantém o do Pulsar')
ok((await um(`select cbo from public.profissionais where id = ${P1}`)).cbo === '999999', 'o CBO editado no Pulsar continua')

console.log('4. RLS do log')
await como('authenticated', OUTRO)
ok(Number((await um(`select count(*) n from public.tita_importacoes`)).n) === 0, 'sem a permissão: não vê nenhuma execução')
ok(Number((await um(`select count(*) n from public.tita_importacoes_itens`)).n) === 0, 'sem a permissão: não vê nenhum item')
await como('authenticated', INATIVO)
ok(Number((await um(`select count(*) n from public.tita_importacoes`)).n) === 0, 'admin inativo não vê')
await como('authenticated', EDITOR)
ok(Number((await um(`select count(*) n from public.tita_importacoes`)).n) === 3, 'com a permissão: vê as 3 execuções')
ok(await erro(`insert into public.tita_importacoes (alvo) values ('profissionais')`), 'não insere no log direto')
ok(await erro(`update public.tita_importacoes set situacao = 'erro'`), 'não altera o log direto')
ok(await erro(`delete from public.tita_importacoes_itens`), 'não apaga item do log direto')

console.log('5. disponibilidade: versão manual de partida (Pedro)')
const faixa = (local, terapias, ini = '08:00', fim = '12:00') => ({
  dia_semana: 1, hora_inicio: ini, hora_fim: fim, duracao_min: 40, capacidade: 1,
  intervalo_ativo: false, intervalo_inicio: null, intervalo_fim: null, local_id: local, terapias, ordem: 0,
})
const S1 = '11111111-1111-1111-1111-111111111111', S2 = '22222222-2222-2222-2222-222222222222'
await superuser()
await db.exec(`insert into public.profissionais_terapias_habilitadas (profissional_id, terapia_id) values (${P2}, ${ABA}) on conflict do nothing`)
await como('authenticated', EDITOR)
await db.query(`select public.profissional_disponibilidade_criar_versao($1, current_date - 10, null, '{1}', $2::jsonb, 'à mão', 'manual', true, null)`,
  [P2, JSON.stringify([faixa(S1, [ABA])])])
ok(Number((await um(`select count(*) n from public.profissionais_disponibilidade_versoes where profissional_id = ${P2}`)).n) === 1, 'Pedro tem a versão manual')

console.log('6. prévia')
const itens = [
  { tipo: 'novo', profissional_id: P1, nome: 'NOME FALSO DA TELA', resumo: 'Seg · Manhã',
    payload: { dias: [1], faixas: [faixa(S1, [ABA])], habilitar: [ABA] }, etiquetas: ['Habilita ABA'] },
  { tipo: 'alterado', profissional_id: P2, resumo: 'Seg · Manhã',
    mudancas: [{ campo: 'Seg', de: '08:00–12:00 · Sala 1', para: '08:00–12:00 · Sala 2' }],
    payload: { dias: [1], faixas: [faixa(S2, [ABA])], habilitar: [] } },
]
const previa = (de, lista) => db.query(`select public.tita_importacao_disponibilidade_previa(${de}, current_date + 7, current_date + 19, 40, $1::jsonb) id`, [JSON.stringify(lista)])
await como('authenticated', OUTRO)
e = await erro(`select public.tita_importacao_disponibilidade_previa(current_date, current_date, current_date, 0, '[]')`)
ok(e && /Sem permissão/.test(e.message), 'sem a permissão não grava prévia')
await como('authenticated', EDITOR)
e = await erro(`select public.tita_importacao_disponibilidade_previa(current_date - 1, current_date, current_date, 0, '[]')`)
ok(e && /passado/.test(e.message), 'data de início no passado recusada')
e = await erro(`select public.tita_importacao_disponibilidade_previa(current_date, current_date, current_date, 0, $1::jsonb)`,
  [JSON.stringify([{ tipo: 'novo', profissional_id: P1, payload: { dias: [1], faixas: [] } }])])
ok(e && /Faixas/.test(e.message), 'novo sem faixas recusado')
const primeira = (await previa('current_date', itens)).rows[0].id
e = await erro(`select public.tita_importacao_disponibilidade_previa(current_date, current_date, current_date, 0, $1::jsonb)`,
  [JSON.stringify([...itens, { tipo: 'igual', profissional_id: P1 }])])
ok(e, 'profissional repetido na prévia é recusado')
const valida = (await previa('current_date', [...itens,
  { tipo: 'novo', profissional_id: await id('Nina Nova'), payload: { dias: [1], faixas: [faixa('33333333-3333-3333-3333-333333333333', [FONO])], habilitar: [FONO] } },
])).rows[0].id
ok((await um(`select situacao from public.tita_importacoes where id = $1`, [primeira])).situacao === 'descartada', 'a prévia anterior fica descartada')
log = await um(`select * from public.tita_importacoes where id = $1`, [valida])
ok(log.situacao === 'previa' && log.novos === 2 && log.alterados === 1 && log.vistos_na_tita === 40, 'contadores da prévia')
ok((await um(`select nome from public.tita_importacoes_itens where importacao_id = $1 and entidade_id = $2`, [valida, P1])).nome === 'Paula Primeira',
  'o nome vem do cadastro, não da tela')
ok(Number((await um(`select count(*) n from public.profissionais_disponibilidade_versoes where profissional_id = ${P1}`)).n) === 0, 'prévia não grava disponibilidade')

console.log('7. aplicar')
await como('authenticated', OUTRO)
e = await erro(`select public.tita_importacao_disponibilidade_aplicar($1, $2)`, [valida, [P1]])
ok(e && /Sem permissão/.test(e.message), 'sem a permissão não aplica')
await como('authenticated', EDITOR)
const nina = await id('Nina Nova')
r = (await um(`select public.tita_importacao_disponibilidade_aplicar($1, $2) r`, [valida, [P1, P2, nina]])).r
ok(r.aplicados === 2 && r.erros === 1, `2 aplicados, 1 erro anotado (${JSON.stringify(r)})`)
const v1 = await um(`select * from public.profissionais_disponibilidade_versoes where profissional_id = ${P1}`)
ok(v1.origem === 'preenchido_tita' && /Importação em massa do TiTa/.test(v1.motivo) && v1.vigente_ate === null, 'Paula: versão preenchido_tita sem fim')
ok((await um(`select origem from public.profissionais_terapias_habilitadas where profissional_id = ${P1} and terapia_id = ${ABA}`))?.origem === 'tita',
  'Paula: ABA habilitada pela importação (origem tita)')
const vs2 = (await db.query(`select origem, vigente_de, vigente_ate from public.profissionais_disponibilidade_versoes where profissional_id = ${P2} order by numero`)).rows
const hoje = (await um(`select current_date d`)).d
const ontem = new Date(hoje.getTime() - 86400000)
ok(vs2.length === 2 && vs2[0].origem === 'manual' && +vs2[0].vigente_ate === +ontem && vs2[1].origem === 'preenchido_tita',
  'Pedro: a manual termina ontem e fica no histórico; vale a do TiTa (TiTa prevalece)')
const itNina = await um(`select aplicado_em, erro from public.tita_importacoes_itens where importacao_id = $1 and entidade_id = $2`, [valida, nina])
ok(itNina.aplicado_em === null && /Local não encontrado/.test(itNina.erro ?? ''), 'Nina: erro anotado no item, sem versão')
ok(Number((await um(`select count(*) n from public.profissionais_terapias_habilitadas where profissional_id = ${nina} and terapia_id = ${FONO} and origem = 'tita'`)).n) <= 1,
  'Nina: habilitação desfeita junto com o erro (ou já existia pela importação de cadastro)')
r = (await um(`select public.tita_importacao_disponibilidade_aplicar($1, $2) r`, [valida, [P1, P2]])).r
ok(r.aplicados === 0 && r.erros === 0, 'reaplicar o mesmo lote não cria versão de novo')

console.log('8. concluir')
r = (await um(`select public.tita_importacao_concluir($1) r`, [valida])).r
ok(r.situacao === 'parcial' && r.aplicados === 2 && r.erros === 1, 'conclui como parcial (1 profissional falhou)')
e = await erro(`select public.tita_importacao_disponibilidade_aplicar($1, $2)`, [valida, [nina]])
ok(e && /concluída ou descartada/.test(e.message), 'importação concluída não aplica mais')

console.log('9. prévia velha não aplica')
const velha = (await previa('current_date', [itens[0]])).rows[0].id
await superuser()
await db.exec(`update public.tita_importacoes set iniciado_em = now() - interval '7 hours' where id = '${velha}'`)
await como('authenticated', EDITOR)
e = await erro(`select public.tita_importacao_disponibilidade_aplicar($1, $2)`, [velha, [P1]])
ok(e && /mais de 6 horas/.test(e.message), 'prévia com mais de 6 horas recusada')

console.log('10. histórico intacto')
ok(Number((await um(`select count(*) n from public.profissionais_disponibilidade_eventos where profissional_id = ${P2}`)).n) >= 3,
  'eventos de Pedro: criar (manual), encerrar, criar (TiTa)')

await superuser()
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.')
process.exit(falhas ? 1 : 0)
