// Teste das regras do sistema no funil (20261022140000) no PGlite (Postgres de
// verdade em Node, sem Docker).
//
// Prova: a migration roda e reroda; a chave de telefone casa o WhatsApp com o
// cadastro do TiTa com e sem o 9; a 1ª presença depois de o card nascer dá o
// ganho (pelo telefone e pelo vínculo), e ganha mesmo de card calado há
// semanas; quem já era paciente não ganha e recebe UMA nota; "Nunca respondeu"
// só pega Prospecção sem resposta à 1ª mensagem da clínica há 7 dias, nunca quem a
// clínica não respondeu; o card volta a Prospecção quando o contato escreve,
// salvo se ele já tiver outro aberto; só service_role executa.
//
// Rodar FORA do repo (o pacote não é dependência do projeto):
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   cp <repo>/supabase/tests/crm_funil_regras.pglite.mjs . && node crm_funil_regras.pglite.mjs \
//     <repo>/supabase/migrations/20261022140000_crm_funil_leitura_e_regras.sql
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'

const [, , migPath] = process.argv
const mig = readFileSync(migPath, 'utf8')

let falhas = 0
const ok = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { falhas++; console.log('  FALHA', msg) } }
// jsonb devolve as chaves na ordem dele: compara com as chaves ordenadas.
const ordenar = (v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar(v[k])])) : v
const igual = (obtido, esperado, msg) => {
  const bate = JSON.stringify(ordenar(obtido)) === JSON.stringify(ordenar(esperado))
  ok(bate, bate ? msg : `${msg}: esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`)
}

const db = new PGlite()
const um = async (sql, params = []) => (await db.query(sql, params)).rows[0]
async function rodar(sql) {
  try { await db.exec(sql); return null } catch (e) { console.log('   ', e.message); return e }
}

const ORG = 'a0000000-0000-0000-0000-000000000001'

// O que existe no banco real e a migration usa, sem o resto. O pg_cron é um
// dublê que só guarda o agendamento.
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema crm; create schema central; create schema cron;

create table cron.job (jobname text primary key, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as
  $$ insert into cron.job values (n, s, c) on conflict (jobname) do update set schedule = s, command = c; select 1::bigint $$;
create function cron.unschedule(n text) returns boolean language plpgsql as
  $$ begin delete from cron.job where jobname = n; if not found then raise exception 'não existe'; end if; return true; end $$;

create table central.contacts (
  id uuid primary key default gen_random_uuid(), organization_id uuid, display_phone text
);
create table central.contact_patient_links (contact_id uuid, organization_id uuid, tita_paciente_id bigint);
create table central.conversations (
  id uuid primary key default gen_random_uuid(), organization_id uuid, contact_id uuid
);
create table central.messages (
  id uuid primary key default gen_random_uuid(), conversation_id uuid, direction text,
  message_type text default 'text', deleted_at timestamptz, created_at timestamptz
);

create table public.pacientes (tita_paciente_id bigint, telefone text, responsavel_telefone text);
create table public.fila_autorizacoes (paciente_id text, data_atendimento date, status text);

create table crm.pipeline_stages (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  slug text, title text, position int, is_active boolean default true
);
create table crm.deals (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  contact_id uuid, stage_id uuid not null references crm.pipeline_stages(id),
  status text not null default 'open' check (status in ('open', 'won', 'lost')),
  closed_at timestamptz, closed_reason text, motivo text,
  created_at timestamptz default now()
);
create unique index uq_open_deal_per_contact on crm.deals (organization_id, contact_id) where status = 'open';
create table crm.deal_activities (
  id uuid primary key default gen_random_uuid(), organization_id uuid, deal_id uuid,
  type text check (type in ('note','call','email','meeting','task','status_change','ai_analysis')),
  title text, description text, created_by_ai boolean
);
`)

const ETAPAS = ['prospeccao', 'qualificacao', 'apresentacao', 'negociacao', 'agendamento', 'atendimento',
  'perdido_objecao', 'perdido_nao_elegivel', 'nao_qualificado', 'sem_interesse', 'nunca_respondeu']
for (const [i, slug] of ETAPAS.entries()) {
  await db.query(`insert into crm.pipeline_stages (organization_id, slug, title, position) values ($1, $2, $2, $3)`,
    [ORG, slug, i + 1])
}

console.log('\nmigration')
ok(!(await rodar(mig)), 'roda')
ok(!(await rodar(mig)), 'reroda')
igual((await um(`select schedule from cron.job where jobname = 'crm-funil-regras'`))?.schedule, '*/15 * * * *', 'cron agendado a cada 15 min')
igual((await um(`select count(*)::int n from information_schema.columns
                  where table_schema = 'crm' and table_name = 'deals' and column_name like 'funil_ia_%'`)).n, 5,
  'cinco colunas funil_ia_*')

console.log('\nchave de telefone')
igual((await um(`select crm.chave_telefone('5521999998888') k`)).k, '2199998888', 'WhatsApp com o 9')
igual((await um(`select crm.chave_telefone('552199998888') k`)).k, '2199998888', 'WhatsApp sem o 9')
igual((await um(`select crm.chave_telefone('(21) 99999-8888') k`)).k, '2199998888', 'cadastro do TiTa')
igual((await um(`select crm.chave_telefone('99998888') k`)).k, null, 'sem DDD não tem chave')

// ---------------------------------------------------------------------------
// Cenário
// ---------------------------------------------------------------------------
const dias = (n) => `now() - interval '${n} days'`

async function card({ fone, etapa = 'prospeccao', criadoHa = 5, status = 'open' }) {
  const c = await um(`insert into central.contacts (organization_id, display_phone) values ($1, $2) returning id`, [ORG, fone])
  const conv = await um(`insert into central.conversations (organization_id, contact_id) values ($1, $2) returning id`, [ORG, c.id])
  const d = await um(
    `insert into crm.deals (organization_id, contact_id, stage_id, status, created_at)
     select $1, $2, s.id, $3, ${dias(criadoHa)} from crm.pipeline_stages s where s.slug = $4 returning id`,
    [ORG, c.id, status, etapa])
  return { contato: c.id, conversa: conv.id, deal: d.id }
}
const msg = (conversa, direcao, haDias) => db.query(
  `insert into central.messages (conversation_id, direction, created_at) values ($1, $2, ${dias(haDias)})`,
  [conversa, direcao])
const paciente = (id, fone) => db.query(`insert into public.pacientes (tita_paciente_id, responsavel_telefone) values ($1, $2)`, [id, fone])
const sessao = (id, haDias, status = 'concluido') => db.query(
  `insert into public.fila_autorizacoes (paciente_id, data_atendimento, status) values ($1, (${dias(haDias)})::date, $2)`,
  [String(id), status])
const estado = async (deal) => um(
  `select s.slug, d.status, d.closed_reason from crm.deals d join crm.pipeline_stages s on s.id = d.stage_id where d.id = $1`, [deal])
const atividades = async (deal) => (await um(
  `select coalesce(json_agg(title order by title), '[]') t from crm.deal_activities where deal_id = $1`, [deal])).t

// Ganha pelo telefone (WhatsApp sem o 9, cadastro com máscara).
const ganhaFone = await card({ fone: '552188887777', criadoHa: 5 })
await paciente(101, '(21) 98888-7777')
await sessao(101, 2)
await sessao(101, 1, 'pendente')

// Ganha pelo vínculo, mesmo sem telefone que case.
const ganhaVinculo = await card({ fone: '5511900000001', etapa: 'negociacao', criadoHa: 10 })
await db.query(`insert into central.contact_patient_links values ($1, $2, 102)`, [ganhaVinculo.contato, ORG])
await sessao(102, 3, 'concluido_sem_guia')

// Calado há semanas, mas veio: ganho vence "Nunca respondeu".
const caladoVeio = await card({ fone: '5521977776666', criadoHa: 20 })
await msg(caladoVeio.conversa, 'inbound', 20)
await msg(caladoVeio.conversa, 'outbound', 19)
await paciente(103, '21977776666')
await sessao(103, 4)

// Já era paciente: 1ª sessão bem antes do card.
const antigo = await card({ fone: '5521966665555', criadoHa: 2 })
await paciente(104, '(21) 96666-5555')
await sessao(104, 200)
await sessao(104, 1)

// Sessão só agendada (não concluída) não é presença.
const soAgendou = await card({ fone: '5521955554444', criadoHa: 3 })
await paciente(105, '21955554444')
await sessao(105, 1, 'pendente')

// Nunca respondeu: nada do contato depois da 1ª resposta da clínica, há 9 dias.
const sumiu = await card({ fone: '5521944443333', criadoHa: 12 })
await msg(sumiu.conversa, 'inbound', 10)
await msg(sumiu.conversa, 'outbound', 9)

// Clínica não respondeu: o silêncio não é do contato.
const semResposta = await card({ fone: '5521933332222', criadoHa: 12 })
await msg(semResposta.conversa, 'inbound', 10)

// Clínica falou há 3 dias: ainda no prazo.
const recente = await card({ fone: '5521922221111', criadoHa: 5 })
await msg(recente.conversa, 'inbound', 4)
await msg(recente.conversa, 'outbound', 3)

// Calado há 10 dias, mas em Qualificação: a regra é só de Prospecção.
const qualificado = await card({ fone: '5521911110000', etapa: 'qualificacao', criadoHa: 12 })
await msg(qualificado.conversa, 'inbound', 11)
await msg(qualificado.conversa, 'outbound', 10)

// Conversou depois da 1ª resposta e parou: não é "abriu e sumiu".
const conversouParou = await card({ fone: '5521988880000', criadoHa: 15 })
await msg(conversouParou.conversa, 'inbound', 14)
await msg(conversouParou.conversa, 'outbound', 14)
await msg(conversouParou.conversa, 'inbound', 13)
await msg(conversouParou.conversa, 'outbound', 12)

// Reação não conta como fala do contato.
const soReagiu = await card({ fone: '5521900009999', criadoHa: 12 })
await msg(soReagiu.conversa, 'inbound', 10)
await msg(soReagiu.conversa, 'outbound', 9)
await db.query(`insert into central.messages (conversation_id, direction, message_type, created_at) values ($1, 'inbound', 'reaction', now() - interval '1 day')`, [soReagiu.conversa])

// ---------------------------------------------------------------------------
console.log('\nprimeira rodada')
const r1 = (await um(`select crm.funil_regras_do_sistema() r`)).r
igual(r1, { ganhos: 3, ja_eram_pacientes: 1, nunca_respondeu: 2, reabertos: 0 }, 'contagens')

igual(await estado(ganhaFone.deal), { slug: 'atendimento', status: 'won', closed_reason: `Primeira presença em ${(await um(`select to_char((${dias(2)})::date, 'DD/MM/YYYY') d`)).d}` },
  'telefone casa (sem o 9 × com máscara) → Atendimento, ganho')
igual((await estado(ganhaVinculo.deal)).slug, 'atendimento', 'vínculo casa, de Negociação → Atendimento')
igual((await estado(caladoVeio.deal)).slug, 'atendimento', 'calado há semanas mas veio → ganho, não "Nunca respondeu"')
igual(await estado(antigo.deal), { slug: 'prospeccao', status: 'open', closed_reason: null }, 'já era paciente → não ganha')
igual(await atividades(antigo.deal), ['Contato já era paciente (anotado pelo sistema)'], 'já era paciente → uma nota')
igual((await estado(soAgendou.deal)).slug, 'prospeccao', 'sessão pendente não é presença')
igual(await estado(sumiu.deal), { slug: 'nunca_respondeu', status: 'lost', closed_reason: 'Sem resposta há 7 dias' },
  'clínica falou por último há 9 dias → Nunca respondeu')
igual((await estado(semResposta.deal)).slug, 'prospeccao', 'clínica não respondeu → fica')
igual((await estado(recente.deal)).slug, 'prospeccao', 'clínica falou há 3 dias → fica')
igual((await estado(qualificado.deal)).slug, 'qualificacao', 'Qualificação calada → fica (regra é só de Prospecção)')
igual((await estado(soReagiu.deal)).slug, 'nunca_respondeu', 'reação não conta como resposta')
igual((await estado(conversouParou.deal)).slug, 'prospeccao', 'respondeu à clínica e depois parou → fica (não é "abriu e sumiu")')
igual(await atividades(sumiu.deal), ['Movido para "Nunca respondeu" pelo sistema'], 'timeline diz "pelo sistema"')
igual((await um(`select bool_and(created_by_ai) b from crm.deal_activities`)).b, true, 'autoria de sistema (created_by_ai)')

console.log('\nsegunda rodada')
const r2 = (await um(`select crm.funil_regras_do_sistema() r`)).r
igual(r2, { ganhos: 0, ja_eram_pacientes: 0, nunca_respondeu: 0, reabertos: 0 }, 'nada se repete')
igual((await atividades(antigo.deal)).length, 1, 'a nota de "já era paciente" sai uma vez só')

console.log('\no contato voltou')
await msg(sumiu.conversa, 'inbound', 0)
// soReagiu volta a escrever, mas já tem outro card aberto: não reabre.
await db.query(
  `insert into crm.deals (organization_id, contact_id, stage_id) select $1, $2, id from crm.pipeline_stages where slug = 'prospeccao'`,
  [ORG, soReagiu.contato])
await msg(soReagiu.conversa, 'inbound', 0)
const r3 = (await um(`select crm.funil_regras_do_sistema() r`)).r
igual(r3.reabertos, 1, 'um reaberto')
igual(await estado(sumiu.deal), { slug: 'prospeccao', status: 'open', closed_reason: null }, 'escreveu de novo → Prospecção, aberto')
igual((await estado(soReagiu.deal)).status, 'lost', 'com outro card aberto → não reabre')

console.log('\npermissões')
igual((await um(`select has_function_privilege('authenticated', 'crm.funil_regras_do_sistema(integer)', 'execute') p`)).p, false,
  'authenticated não executa')
igual((await um(`select has_function_privilege('service_role', 'crm.funil_regras_do_sistema(integer)', 'execute') p`)).p, true,
  'service_role executa')
igual((await um(`select has_function_privilege('authenticated', 'crm.funil_presencas_dos_abertos()', 'execute') p`)).p, false,
  'presenças: authenticated não executa')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\ntudo ok')
process.exit(falhas ? 1 : 0)
