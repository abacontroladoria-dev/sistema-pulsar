// Teste do funil clássico (20261022110000) no PGlite (Postgres de verdade em
// Node, sem Docker), sobre o estado de produção em 22/10/2026: as 17 posições
// de 28/09 ativas, as 6 do seed de julho inativas em 1000..1005.
//
// Prova: a migration roda e reroda; ficam 11 posições ativas na ordem da
// diretoria; cada negócio das 12 posições que saem cai na etapa certa, com o
// detalhe certo, o ganho onde é ganho e o "há N dias" de antes; conversa nova
// nasce em Prospecção; tag nao_paciente_* encerra em Qualificação; a Maia aceita
// os slugs antigos, marca detalhe sem mudar de coluna, não passa de
// Agendamento, não encerra depois de Apresentação e nunca volta; o card que
// anda perde o detalhe.
//
// Rodar FORA do repo (o pacote não é dependência do projeto):
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   cp <repo>/supabase/tests/crm_funil_classico.pglite.mjs . && node crm_funil_classico.pglite.mjs \
//     <repo>/supabase/migrations/20261022110000_crm_funil_classico.sql
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'

const [, , migPath] = process.argv
const mig = readFileSync(migPath, 'utf8')

let falhas = 0
const ok = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { falhas++; console.log('  FALHA', msg) } }
const igual = (obtido, esperado, msg) => {
  const bate = JSON.stringify(obtido) === JSON.stringify(esperado)
  ok(bate, bate ? msg : `${msg}: esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`)
}

const db = new PGlite()
const um = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const todos = async (sql, params = []) => (await db.query(sql, params)).rows
async function erro(sql, params = []) {
  try { await db.query(sql, params); return null } catch (e) { return e }
}
async function rodar(sql) {
  try { await db.exec(sql); return null } catch (e) { console.log('   ', e.message); return e }
}

const ORG = 'a0000000-0000-0000-0000-000000000001'

// O que existe no banco real e a migration usa, sem o resto.
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema crm; create schema central;

create table central.channels (id uuid primary key, provider text);
create table central.inboxes  (id uuid primary key, maia_automatica boolean default false);
create table central.contacts (
  id uuid primary key default gen_random_uuid(), organization_id uuid, name text,
  display_phone text, status text default 'active', tags text[] default '{}'
);
create table central.contact_patient_links (contact_id uuid, organization_id uuid);
create table central.tag_definitions (organization_id uuid, key text, label text);
create table central.conversations (
  id uuid primary key default gen_random_uuid(), organization_id uuid, contact_id uuid,
  channel_id uuid, inbox_id uuid
);

create table crm.pipeline_stages (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  title text, description text, color text, position int not null,
  is_system boolean default false, is_active boolean default true,
  auto_win boolean default false, auto_lose boolean default false,
  slug text, trilha text not null default 'ambas', exige_motivo boolean not null default false,
  updated_at timestamptz,
  constraint uq_pipeline_stage_org_position unique (organization_id, position)
);
create unique index uq_pipeline_stage_org_slug on crm.pipeline_stages (organization_id, slug) where slug is not null;

create table crm.deals (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  contact_id uuid, conversation_id uuid,
  stage_id uuid not null references crm.pipeline_stages(id) on delete restrict,
  title text, source text, created_by_ai boolean default false,
  status text not null default 'open', priority text default 'medium',
  closed_at timestamptz, closed_reason text,
  trilha text check (trilha in ('particular', 'convenio')),
  resgate boolean not null default false, motivo text,
  stage_changed_at timestamptz not null default now(),
  created_at timestamptz default now()
);
create unique index uq_open_deal_per_contact on crm.deals (organization_id, contact_id) where status = 'open';

create table crm.deal_activities (
  id uuid primary key default gen_random_uuid(), organization_id uuid, deal_id uuid,
  type text, title text, description text, created_by_ai boolean
);

-- O gatilho de 20260930100000, como está em produção.
create function crm.marcar_troca_de_estagio() returns trigger language plpgsql as $$
begin
  if new.stage_id is distinct from old.stage_id then new.stage_changed_at := now(); end if;
  return new;
end $$;
create trigger marcar_troca_de_estagio before update of stage_id on crm.deals
  for each row execute function crm.marcar_troca_de_estagio();
`)

// Estado de produção: seed de julho inativo + 17 posições de 28/09.
for (let i = 0; i < 6; i++) {
  await db.query(`insert into crm.pipeline_stages (organization_id, title, position, is_active) values ($1, $2, $3, false)`,
    [ORG, `antigo ${i}`, 1000 + i])
}
const ANTIGAS = [
  ['novo', 1, {}], ['em_qualificacao', 2, {}], ['qualificado', 3, {}],
  ['proposta_apresentada', 4, { trilha: 'particular' }], ['agendado', 5, { trilha: 'particular' }],
  ['aguardando_elegibilidade', 6, { trilha: 'convenio' }], ['encaminhado_humano', 7, { exige: true }],
  ['entrevista_agendada', 8, {}], ['compareceu', 9, {}], ['aguardando_cronograma', 10, {}],
  ['iniciou_tratamento', 11, { win: true }], ['em_follow_up', 12, {}],
  ['perdido_objecao', 13, { lose: true, exige: true }], ['perdido_nao_elegivel', 14, { lose: true, exige: true, trilha: 'convenio' }],
  ['nao_qualificado', 15, { lose: true }], ['sem_interesse', 16, { lose: true }], ['nunca_respondeu', 17, { lose: true }],
]
for (const [slug, pos, o] of ANTIGAS) {
  await db.query(
    `insert into crm.pipeline_stages (organization_id, slug, title, position, trilha, auto_win, auto_lose, exige_motivo)
     values ($1, $2, $2, $3, $4, $5, $6, $7)`,
    [ORG, slug, pos, o.trilha ?? 'ambas', !!o.win, !!o.lose, !!o.exige])
}

// Um negócio aberto em cada posição que sai (iniciou_tratamento já ganho) e um
// perdido em nao_qualificado. Contato = um por negócio.
const DESDE = '2026-10-01T10:00:00Z'
const deals = {}
for (const [slug] of ANTIGAS.filter(([s]) => !['perdido_objecao', 'perdido_nao_elegivel', 'sem_interesse', 'nunca_respondeu'].includes(s))) {
  const c = await um(`insert into central.contacts (organization_id, name) values ($1, $2) returning id`, [ORG, slug])
  const status = slug === 'iniciou_tratamento' ? 'won' : slug === 'nao_qualificado' ? 'lost' : 'open'
  const d = await um(
    `insert into crm.deals (organization_id, contact_id, stage_id, title, status, stage_changed_at)
     select $1, $2, id, $3, $4, $5 from crm.pipeline_stages where organization_id = $1 and slug = $3 returning id`,
    [ORG, c.id, slug, status, DESDE])
  deals[slug] = { id: d.id, contato: c.id }
}

console.log('migration')
ok(!(await rodar(mig)), 'roda')
ok(!(await rodar(mig)), 'reroda')

igual(
  (await todos(`select position, slug from crm.pipeline_stages where is_active order by position`)).map(r => `${r.position} ${r.slug}`),
  ['1 prospeccao', '2 qualificacao', '3 apresentacao', '4 negociacao', '5 agendamento', '6 atendimento',
   '7 perdido_objecao', '8 perdido_nao_elegivel', '9 nao_qualificado', '10 sem_interesse', '11 nunca_respondeu'],
  '11 ativas na ordem da diretoria')
igual((await um(`select count(*)::int n from crm.pipeline_stages where not is_active`)).n, 18, '12 que saem + 6 do seed inativas')
const atend = await um(`select auto_win, is_system from crm.pipeline_stages where slug = 'atendimento'`)
ok(atend.auto_win && atend.is_system, 'Atendimento é o ganho')

console.log('negócios das posições que saem')
const ESPERADO = {
  novo:                     ['prospeccao',   null,                       'open'],
  em_qualificacao:          ['qualificacao', null,                       'open'],
  qualificado:              ['qualificacao', null,                       'open'],
  proposta_apresentada:     ['apresentacao', null,                       'open'],
  aguardando_elegibilidade: ['negociacao',   'aguardando_elegibilidade', 'open'],
  encaminhado_humano:       ['negociacao',   'encaminhado_humano',       'open'],
  em_follow_up:             ['negociacao',   'em_follow_up',             'open'],
  agendado:                 ['agendamento',  null,                       'open'],
  entrevista_agendada:      ['agendamento',  null,                       'open'],
  compareceu:               ['atendimento',  null,                       'won'],
  aguardando_cronograma:    ['atendimento',  'aguardando_cronograma',    'won'],
  iniciou_tratamento:       ['atendimento',  null,                       'won'],
  nao_qualificado:          ['nao_qualificado', null,                    'lost'],
}
for (const [velho, [novo, detalhe, status]] of Object.entries(ESPERADO)) {
  const r = await um(
    `select s.slug, d.detalhe, d.status, d.stage_changed_at = $2::timestamptz as manteve,
            d.detalhe_desde, d.closed_at is not null as fechou
       from crm.deals d join crm.pipeline_stages s on s.id = d.stage_id where d.id = $1`,
    [deals[velho].id, DESDE])
  igual([r.slug, r.detalhe, r.status], [novo, detalhe, status], `${velho} → ${novo}${detalhe ? ` (${detalhe})` : ''}`)
  ok(r.manteve, `${velho}: "há N dias" mantido`)
  if (detalhe) ok(r.detalhe_desde && new Date(r.detalhe_desde).toISOString() === new Date(DESDE).toISOString(), `${velho}: prazo do detalhe conta de antes`)
  if (status === 'won' && velho !== 'iniciou_tratamento') ok(r.fechou, `${velho}: ganho com closed_at`)
}

console.log('detalhe')
ok(await erro(`update crm.deals set detalhe = 'inventado' where id = $1`, [deals.novo.id]), 'detalhe fora da lista é recusado')
await db.query(`update crm.deals set stage_id = (select id from crm.pipeline_stages where slug = 'agendamento') where id = $1`,
  [deals.encaminhado_humano.id])
const andou = await um(`select detalhe, detalhe_desde, stage_changed_at > $2::timestamptz as novo_tempo from crm.deals where id = $1`,
  [deals.encaminhado_humano.id, DESDE])
ok(andou.detalhe === null && andou.detalhe_desde === null, 'card que anda perde o detalhe')
ok(andou.novo_tempo, 'card que anda zera o "há N dias"')

console.log('conversa nova')
const CH = '10000000-0000-0000-0000-000000000001'
await db.query(`insert into central.channels values ($1, 'meta')`, [CH])
await db.exec(`create trigger criar_negocio_na_conversa_nova after insert on central.conversations
  for each row execute function crm.criar_negocio_na_conversa_nova()`)
const novo = await um(`insert into central.contacts (organization_id, name) values ($1, 'Lead novo') returning id`, [ORG])
await db.query(`insert into central.conversations (organization_id, contact_id, channel_id) values ($1, $2, $3)`, [ORG, novo.id, CH])
igual((await um(`select s.slug from crm.deals d join crm.pipeline_stages s on s.id = d.stage_id where d.contact_id = $1`, [novo.id]))?.slug,
  'prospeccao', 'nasce em Prospecção')

console.log('tags')
await db.query(`insert into central.tag_definitions values ($1, 'nao_paciente_curso', 'Curso')`, [ORG])
await db.query(`select crm.aplicar_tags_no_funil($1, $2, array['nao_paciente_curso'], '{}', 'Maia')`, [ORG, deals.qualificado.contato])
igual(Object.values(await um(`select s.slug, d.status from crm.deals d join crm.pipeline_stages s on s.id = d.stage_id where d.id = $1`, [deals.qualificado.id])),
  ['nao_qualificado', 'lost'], 'nao_paciente_* em Qualificação encerra')
await db.query(`select crm.aplicar_tags_no_funil($1, $2, array['nao_paciente_curso'], '{}', 'Maia')`, [ORG, deals.proposta_apresentada.contato])
igual((await um(`select status from crm.deals where id = $1`, [deals.proposta_apresentada.id])).status, 'open',
  'nao_paciente_* em Apresentação não encerra')

console.log('Maia')
const maia = async (contato, slug, motivo = null) =>
  (await um(`select crm.maia_mover_negocio($1, $2, $3, $4) as r`, [ORG, contato, slug, motivo])).r
const onde = async (contato) =>
  Object.values(await um(`select s.slug, coalesce(d.detalhe, '-') as detalhe, coalesce(d.trilha, '-') as trilha
                            from crm.deals d join crm.pipeline_stages s on s.id = d.stage_id
                           where d.contact_id = $1 and d.status = 'open'`, [contato]))
const L = novo.id
igual(await maia(L, 'em_qualificacao'), 'movido', 'slug antigo em_qualificacao vale')
igual(await onde(L), ['qualificacao', '-', '-'], '→ Qualificação')
igual(await maia(L, 'encaminhado_humano'), 'falta_motivo', 'com a equipe sem motivo é recusado')
igual(await maia(L, 'encaminhado_humano', 'Pediu pessoa'), 'movido', 'com a equipe com motivo')
igual(await onde(L), ['qualificacao', 'encaminhado_humano', '-'], 'marca o detalhe sem mudar de coluna')
igual(await maia(L, 'encaminhado_humano', 'De novo'), 'ja_esta', 'detalhe repetido é ja_esta')
igual(await maia(L, 'atendimento'), 'posicao_nao_permitida', 'Atendimento é da equipe')
igual(await maia(L, 'aguardando_elegibilidade'), 'movido', 'elegibilidade')
igual(await onde(L), ['negociacao', 'aguardando_elegibilidade', 'convenio'], 'leva a Negociação, trilha Convênio')
igual(await maia(L, 'perdido_objecao', 'caro'), 'nao_volta', 'não encerra depois de Apresentação')
igual(await maia(L, 'apresentacao'), 'nao_volta', 'nunca volta')
igual(await maia(L, 'agendado'), 'movido', 'slug antigo agendado vale')
igual(await onde(L), ['agendamento', '-', 'convenio'], '→ Agendamento, detalhe sai')
igual(await maia(L, 'nunca_respondeu'), 'posicao_nao_permitida', 'nunca_respondeu é da equipe')

const P = deals.novo.contato
await db.query(`update crm.deals set trilha = 'particular' where contact_id = $1`, [P])
igual(await maia(P, 'aguardando_elegibilidade'), 'trilha_diferente', 'elegibilidade em card particular é recusada')
igual(await maia(P, 'proposta_apresentada'), 'movido', 'slug antigo proposta_apresentada vale')
igual(await onde(P), ['apresentacao', '-', 'particular'], '→ Apresentação')
igual(await maia(P, 'perdido_objecao'), 'falta_motivo', 'objeção exige motivo')
igual(await maia(P, 'perdido_objecao', 'achou caro'), 'movido', 'encerra em Apresentação')
igual((await um(`select status, closed_reason from crm.deals where id = $1`, [deals.novo.id])), { status: 'lost', closed_reason: 'achou caro' },
  'perdido com o motivo')

const acl = await um(`select has_function_privilege('authenticated', 'crm.maia_mover_negocio(uuid,uuid,text,text)', 'execute') as a,
                             has_function_privilege('service_role', 'crm.maia_mover_negocio(uuid,uuid,text,text)', 'execute') as s`)
ok(!acl.a && acl.s, 'maia_mover_negocio só para service_role')

console.log(falhas === 0 ? '\nTudo certo.' : `\n${falhas} falha(s).`)
process.exit(falhas === 0 ? 0 : 1)
