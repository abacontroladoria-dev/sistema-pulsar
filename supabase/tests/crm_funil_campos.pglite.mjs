// Teste dos campos do card preenchidos pelo sistema (20261022180000) no
// PGlite (Postgres de verdade em Node, sem Docker).
//
// Prova: a migration roda e reroda; Resgate marca card novo de contato com
// card perdido e card perdido que reabre, e não marca contato sem histórico
// nem card ganho; o responsável segue a conversa, acompanha a troca de pessoa
// e não pisa na escolha à mão; "Com a equipe" pela conversa em Aberto ou
// Atribuída e sai em Autoatendimento; "Follow-up" só para quem já respondeu,
// com a clínica por último há 24h, até Negociação, e sai quando o contato
// escreve; elegibilidade não é tocada; o backfill acerta os cards de hoje; só
// service_role executa.
//
// Rodar FORA do repo (o pacote não é dependência do projeto):
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   cp <repo>/supabase/tests/crm_funil_campos.pglite.mjs . && node crm_funil_campos.pglite.mjs \
//     <repo>/supabase/migrations/20261022180000_crm_funil_campos_pelo_sistema.sql
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'

const [, , migPath] = process.argv
const mig = readFileSync(migPath, 'utf8')

let falhas = 0
const ok = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { falhas++; console.log('  FALHA', msg) } }
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
const ANA = 'b0000000-0000-0000-0000-00000000000a'
const BIA = 'b0000000-0000-0000-0000-00000000000b'
const CAU = 'b0000000-0000-0000-0000-00000000000c'

await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema crm; create schema central; create schema cron;

create table cron.job (jobname text primary key, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as
  $$ insert into cron.job values (n, s, c) on conflict (jobname) do update set schedule = s, command = c; select 1::bigint $$;
create function cron.unschedule(n text) returns boolean language plpgsql as
  $$ begin delete from cron.job where jobname = n; if not found then raise exception 'não existe'; end if; return true; end $$;

create table public.usuarios (id uuid primary key);
insert into public.usuarios values ('${ANA}'), ('${BIA}'), ('${CAU}');

create type central.conversation_status as enum ('self_service', 'open', 'assigned', 'waiting', 'resolved', 'archived');
create table central.conversations (
  id uuid primary key default gen_random_uuid(), organization_id uuid, contact_id uuid,
  status central.conversation_status not null default 'open',
  assigned_user_id uuid references public.usuarios(id),
  last_message_at timestamptz
);
create table central.messages (
  id uuid primary key default gen_random_uuid(), conversation_id uuid, direction text,
  message_type text default 'text', deleted_at timestamptz, created_at timestamptz
);

create table crm.pipeline_stages (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  slug text, title text, position int
);
create table crm.deals (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  contact_id uuid, stage_id uuid not null references crm.pipeline_stages(id),
  status text not null default 'open' check (status in ('open', 'won', 'lost')),
  assigned_to uuid references public.usuarios(id),
  resgate boolean not null default false,
  detalhe text check (detalhe in ('aguardando_elegibilidade', 'encaminhado_humano', 'aguardando_cronograma', 'em_follow_up')),
  detalhe_desde timestamptz,
  created_at timestamptz default now()
);
create unique index uq_open_deal_per_contact on crm.deals (organization_id, contact_id) where status = 'open';
create table crm.deal_activities (
  id uuid primary key default gen_random_uuid(), organization_id uuid, deal_id uuid,
  type text, title text, description text, created_by_ai boolean
);
`)

for (const [i, slug] of ['prospeccao', 'qualificacao', 'apresentacao', 'negociacao', 'agendamento', 'atendimento', 'perdido_objecao'].entries()) {
  await db.query(`insert into crm.pipeline_stages (organization_id, slug, title, position) values ($1, $2, $2, $3)`, [ORG, slug, i + 1])
}

const novoContato = () => um(`select gen_random_uuid() id`).then((r) => r.id)
const horas = (n) => `now() - interval '${n} hours'`
async function card({ contato, etapa = 'prospeccao', status = 'open', dono = null, detalhe = null }) {
  return (await um(
    `insert into crm.deals (organization_id, contact_id, stage_id, status, assigned_to, detalhe, detalhe_desde)
     select $1, $2, s.id, $3, $5, $6::text, case when $6::text is null then null else now() - interval '1 day' end
       from crm.pipeline_stages s where s.slug = $4 returning id`,
    [ORG, contato, status, etapa, dono, detalhe])).id
}
async function conversa(contato, { status = 'self_service', dono = null, ultimaHa = 1 } = {}) {
  return (await um(
    `insert into central.conversations (organization_id, contact_id, status, assigned_user_id, last_message_at)
     values ($1, $2, $3, $4, ${horas(ultimaHa)}) returning id`, [ORG, contato, status, dono])).id
}
const msg = (conv, direcao, haHoras, tipo = 'text') => db.query(
  `insert into central.messages (conversation_id, direction, message_type, created_at) values ($1, $2, $3, ${horas(haHoras)})`,
  [conv, direcao, tipo])
const deal = (id) => um(`select resgate, assigned_to, detalhe from crm.deals where id = $1`, [id])

// Cards que existem ANTES da migration: o backfill.
const cAntigo = await novoContato()
await card({ contato: cAntigo, status: 'lost' })
const dAntigo = await card({ contato: cAntigo })
const cSemDono = await novoContato()
const dSemDono = await card({ contato: cSemDono })
await conversa(cSemDono, { status: 'assigned', dono: ANA })

console.log('\nmigration')
ok(!(await rodar(mig)), 'roda')
ok(!(await rodar(mig)), 'reroda')
igual((await um(`select schedule from cron.job where jobname = 'crm-funil-situacao'`))?.schedule, '*/15 * * * *', 'cron a cada 15 min')

console.log('\nbackfill')
igual((await deal(dAntigo)).resgate, true, 'card aberto de contato com card perdido vira resgate')
igual((await deal(dSemDono)).assigned_to, ANA, 'card sem responsável recebe o da conversa')

console.log('\nresgate')
const cVoltou = await novoContato()
await card({ contato: cVoltou, status: 'lost' })
igual((await deal(await card({ contato: cVoltou }))).resgate, true, 'card novo de quem tem card perdido')
const cNovo = await novoContato()
igual((await deal(await card({ contato: cNovo }))).resgate, false, 'contato sem histórico não é resgate')
const cGanho = await novoContato()
await card({ contato: cGanho, status: 'won' })
igual((await deal(await card({ contato: cGanho }))).resgate, false, 'card ganho antes não conta')
const cReabre = await novoContato()
const dReabre = await card({ contato: cReabre, status: 'lost' })
await db.query(`update crm.deals set status = 'open' where id = $1`, [dReabre])
igual((await deal(dReabre)).resgate, true, 'card perdido que reabre')
const dGanhoAgora = await card({ contato: await novoContato() })
await db.query(`update crm.deals set status = 'won' where id = $1`, [dGanhoAgora])
igual((await deal(dGanhoAgora)).resgate, false, 'aberto que ganha não é resgate')

console.log('\nresponsável')
const cResp = await novoContato()
const dResp = await card({ contato: cResp })
const convResp = await conversa(cResp)
await db.query(`update central.conversations set assigned_user_id = $1, status = 'assigned' where id = $2`, [ANA, convResp])
igual((await deal(dResp)).assigned_to, ANA, 'conversa atribuída → card ganha o responsável')
await db.query(`update central.conversations set assigned_user_id = $1 where id = $2`, [BIA, convResp])
igual((await deal(dResp)).assigned_to, BIA, 'transferência leva o card junto')
await db.query(`update crm.deals set assigned_to = $1 where id = $2`, [CAU, dResp])
await db.query(`update central.conversations set assigned_user_id = $1 where id = $2`, [ANA, convResp])
igual((await deal(dResp)).assigned_to, CAU, 'escolha à mão no card fica')
await db.query(`update central.conversations set assigned_user_id = null where id = $1`, [convResp])
igual((await deal(dResp)).assigned_to, CAU, 'conversa sem responsável não apaga o do card')

console.log('\nsituação na etapa')
const rodada = async () => (await um(`select crm.funil_situacao_do_sistema() r`)).r

// Com a equipe: conversa em Aberto.
const cEquipe = await novoContato()
const dEquipe = await card({ contato: cEquipe, etapa: 'qualificacao' })
const convEquipe = await conversa(cEquipe, { status: 'open' })
await msg(convEquipe, 'inbound', 1)

// Com a Maia: nada.
const cMaia = await novoContato()
const dMaia = await card({ contato: cMaia })
await msg(await conversa(cMaia, { status: 'self_service' }), 'inbound', 1)

// Follow-up: respondeu, clínica por último há 30h.
const cFU = await novoContato()
const dFU = await card({ contato: cFU, etapa: 'negociacao' })
const convFU = await conversa(cFU, { status: 'waiting', ultimaHa: 30 })
await msg(convFU, 'inbound', 50); await msg(convFU, 'outbound', 49); await msg(convFU, 'inbound', 40); await msg(convFU, 'outbound', 30)
await msg(convFU, 'inbound', 2, 'reaction')

// Clínica por último há 10h: ainda não.
const cCedo = await novoContato()
const dCedo = await card({ contato: cCedo, etapa: 'apresentacao' })
const convCedo = await conversa(cCedo, { status: 'waiting', ultimaHa: 10 })
await msg(convCedo, 'inbound', 20); await msg(convCedo, 'outbound', 19); await msg(convCedo, 'inbound', 15); await msg(convCedo, 'outbound', 10)

// Nunca respondeu à clínica: é da regra de "Nunca respondeu", não follow-up.
const cMudo = await novoContato()
const dMudo = await card({ contato: cMudo })
const convMudo = await conversa(cMudo, { status: 'waiting', ultimaHa: 40 })
await msg(convMudo, 'inbound', 50); await msg(convMudo, 'outbound', 40)

// Agendamento calado: normal, sem follow-up.
const cAg = await novoContato()
const dAg = await card({ contato: cAg, etapa: 'agendamento' })
const convAg = await conversa(cAg, { status: 'waiting', ultimaHa: 30 })
await msg(convAg, 'inbound', 50); await msg(convAg, 'outbound', 49); await msg(convAg, 'inbound', 40); await msg(convAg, 'outbound', 30)

// Elegibilidade não é tocada, mesmo com a conversa com a equipe.
const cEl = await novoContato()
const dEl = await card({ contato: cEl, etapa: 'negociacao', detalhe: 'aguardando_elegibilidade' })
await msg(await conversa(cEl, { status: 'open' }), 'inbound', 1)

// Com a equipe que a Maia retomou: sai.
const cVolta = await novoContato()
const dVolta = await card({ contato: cVolta, detalhe: 'encaminhado_humano' })
await msg(await conversa(cVolta, { status: 'self_service' }), 'inbound', 1)

// Follow-up marcado à mão, contato ainda calado: fica.
const cMao = await novoContato()
const dMao = await card({ contato: cMao, detalhe: 'em_follow_up' })
const convMao = await conversa(cMao, { status: 'waiting', ultimaHa: 30 })
await msg(convMao, 'inbound', 50); await msg(convMao, 'outbound', 30)

igual(await rodada(), { follow_up: 1, com_a_equipe: 3, limpos: 1 }, '1ª rodada')
igual((await deal(dEquipe)).detalhe, 'encaminhado_humano', 'conversa em Aberto → Com a equipe')
igual((await deal(dResp)).detalhe, 'encaminhado_humano', 'conversa Atribuída → Com a equipe')
igual((await deal(dMaia)).detalhe, null, 'conversa com a Maia → nada')
igual((await deal(dFU)).detalhe, 'em_follow_up', 'respondeu e a clínica está sem resposta há 30h → Follow-up')
igual((await deal(dCedo)).detalhe, null, 'só 10h → nada')
igual((await deal(dMudo)).detalhe, null, 'nunca respondeu à clínica → não é follow-up')
igual((await deal(dAg)).detalhe, null, 'Agendamento calado → nada')
igual((await deal(dEl)).detalhe, 'aguardando_elegibilidade', 'elegibilidade intocada')
igual((await deal(dVolta)).detalhe, null, 'Maia retomou → Com a equipe sai')
igual((await deal(dMao)).detalhe, 'em_follow_up', 'follow-up à mão com o contato calado fica')
igual((await um(`select count(*)::int n from crm.deal_activities where deal_id = $1 and title like 'Situação "Follow-up"%'`, [dFU])).n, 1, 'uma atividade na timeline')

igual(await rodada(), { follow_up: 0, com_a_equipe: 0, limpos: 0 }, '2ª rodada não muda nada')

// O contato escreveu: o follow-up sai; a conversa volta com a Maia.
await msg(convFU, 'inbound', 0)
await db.query(`update central.conversations set status = 'self_service', last_message_at = now() where id = $1`, [convFU])
await msg(convMao, 'inbound', 0)
await db.query(`update central.conversations set status = 'open', last_message_at = now() where id = $1`, [convMao])
igual(await rodada(), { follow_up: 0, com_a_equipe: 1, limpos: 1 }, '3ª rodada')
igual((await deal(dFU)).detalhe, null, 'contato escreveu e está com a Maia → follow-up sai')
igual((await deal(dMao)).detalhe, 'encaminhado_humano', 'contato escreveu e está com a equipe → Com a equipe')

console.log('\npermissões')
for (const papel of ['anon', 'authenticated']) {
  igual((await um(`select has_function_privilege('${papel}', 'crm.funil_situacao_do_sistema(integer)', 'execute') p`)).p, false, `${papel} não executa a rodada`)
}
igual((await um(`select has_function_privilege('service_role', 'crm.funil_situacao_do_sistema(integer)', 'execute') p`)).p, true, 'service_role executa')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\ntudo verde')
process.exit(falhas ? 1 : 0)
