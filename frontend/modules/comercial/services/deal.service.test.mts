// npx tsx --conditions=react-server modules/comercial/services/deal.service.test.mts
//
// Regras do funil da diretoria no movimento de card — sem banco e sem rede.
// (`--conditions=react-server` porque deal.service importa 'server-only'.)
//
// O que cada bloco protege:
//   1. MOTIVO OBRIGATÓRIO. Sem motivo, "Encaminhado para humano" e "Perdido /
//      Objeção" viram colunas mudas — e o motivo é o dado que a diretoria pediu.
//   2. TRILHA. Card de particular em "Aguardando elegibilidade" é convênio
//      fingido; card sem trilha que entra ali passa a ser de convênio.
//   3. PERDA GRAVA O MOTIVO em closed_reason, inclusive trocando uma perda
//      por outra.
//   4. REABRIR ANTES DE MOVER. Tirar um card de "Encerrados" para uma coluna
//      em andamento reabre — e se reabrir falhar, o card não se move.
//   5. O motivo é da posição atual: mover sem motivo limpa o anterior.

import { DealService } from './deal.service.js'
import { MotivoObrigatorioError, TrilhaIncompativelError } from '../types/errors.types.js'
import type { DealRow, PipelineStageRow } from '../types/crm.types'

let falhas = 0
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado)
  if (ok) { console.log(`  ok    ${nome}`); return }
  console.log(`  FALHA ${nome}: esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`)
  falhas++
}

// --- dublês -----------------------------------------------------------------

function estagio(slug: string, extra: Partial<PipelineStageRow> = {}): PipelineStageRow {
  return {
    id: `st-${slug}`, organization_id: 'org-1', title: slug, description: null, color: '#000',
    position: 1, is_system: false, is_active: true, auto_win: false, auto_lose: false,
    slug, trilha: 'ambas', exige_motivo: false, created_at: null, updated_at: null,
    ...extra,
  }
}

const ESTAGIOS = [
  estagio('qualificado'),
  estagio('encaminhado_humano',       { exige_motivo: true }),
  estagio('aguardando_elegibilidade', { trilha: 'convenio' }),
  estagio('proposta_apresentada',     { trilha: 'particular' }),
  estagio('iniciou_tratamento',       { auto_win: true }),
  estagio('perdido_objecao',          { auto_lose: true, exige_motivo: true }),
  estagio('sem_interesse',            { auto_lose: true }),
]

function montar(deal: Partial<DealRow>, opcoes: { falharAoReabrir?: boolean } = {}) {
  const estado: DealRow = {
    id: 'deal-1', organization_id: 'org-1', contact_id: 'ct-1', conversation_id: null,
    stage_id: 'st-qualificado', title: 'Ana', description: null, value: null, currency: 'BRL',
    priority: 'medium', status: 'open', expected_close_date: null, closed_at: null,
    closed_reason: null, assigned_to: null, source: null, source_campaign: null, source_ref: null,
    created_by_ai: false, ai_score: null, ai_score_notes: null, ai_scored_at: null, tags: [],
    trilha: null, resgate: false, motivo: null, stage_changed_at: '', created_at: null, updated_at: null,
    ...deal,
  }
  const chamadas: string[] = []
  const atividades: string[] = []

  const deals = {
    findById: async () => ({ ...estado, contact: null }),
    update: async (_id: string, _org: string, patch: Partial<DealRow>) => {
      chamadas.push('update')
      Object.assign(estado, patch)
      return { ...estado }
    },
    updateStatus: async (_id: string, _org: string, status: DealRow['status'], motivo?: string | null) => {
      chamadas.push(`status:${status}`)
      if (status === 'open' && opcoes.falharAoReabrir) throw new Error('23505')
      estado.status = status
      estado.closed_reason = status === 'open' ? null : (motivo ?? null)
      return { ...estado }
    },
  }
  const stages = {
    findById: async (id: string) => ESTAGIOS.find(s => s.id === id) ?? null,
    list: async () => ESTAGIOS,
  }
  const activities = {
    registrarMudancaDeStatus: async (a: { descricao: string }) => { atividades.push(a.descricao) },
  }

  const service = new DealService(deals as any, stages as any, activities as any)
  return { service, estado, chamadas, atividades }
}

async function erroDe(fn: () => Promise<unknown>): Promise<string | null> {
  try { await fn(); return null } catch (e) { return (e as Error).constructor.name }
}

// --- 1. motivo obrigatório --------------------------------------------------
console.log('1. motivo obrigatório')
{
  const { service, chamadas } = montar({})
  checar('sem motivo recusa',
    await erroDe(() => service.moverParaEstagio('deal-1', 'org-1', 'st-encaminhado_humano', 'u', null)),
    MotivoObrigatorioError.name)
  checar('motivo só com espaços recusa',
    await erroDe(() => service.moverParaEstagio('deal-1', 'org-1', 'st-encaminhado_humano', 'u', '   ')),
    MotivoObrigatorioError.name)
  checar('recusa não escreve nada', chamadas, [])
}
{
  const { service, estado, atividades } = montar({})
  await service.moverParaEstagio('deal-1', 'org-1', 'st-encaminhado_humano', 'u', ' pediu pessoa ')
  checar('com motivo move', estado.stage_id, 'st-encaminhado_humano')
  checar('motivo gravado aparado', estado.motivo, 'pediu pessoa')
  checar('timeline leva o motivo', atividades, ['Movido para "encaminhado_humano" — motivo: pediu pessoa'])
}

// --- 2. trilha --------------------------------------------------------------
console.log('2. trilha')
{
  const { service, chamadas } = montar({ trilha: 'particular' })
  checar('particular não entra em posição de convênio',
    await erroDe(() => service.moverParaEstagio('deal-1', 'org-1', 'st-aguardando_elegibilidade', 'u')),
    TrilhaIncompativelError.name)
  checar('recusa não escreve nada', chamadas, [])
}
{
  const { service, estado } = montar({ trilha: null })
  await service.moverParaEstagio('deal-1', 'org-1', 'st-aguardando_elegibilidade', 'u')
  checar('sem trilha entra e vira convênio', [estado.stage_id, estado.trilha], ['st-aguardando_elegibilidade', 'convenio'])
}
{
  const { service, estado } = montar({ trilha: 'convenio' })
  await service.moverParaEstagio('deal-1', 'org-1', 'st-qualificado', 'u')
  checar('posição "ambas" não mexe na trilha', estado.trilha, 'convenio')
}

// --- 3. perda e ganho -------------------------------------------------------
console.log('3. perda e ganho')
{
  const { service, estado } = montar({})
  await service.moverParaEstagio('deal-1', 'org-1', 'st-perdido_objecao', 'u', 'achou caro')
  checar('objeção fecha como perdido com o motivo', [estado.status, estado.closed_reason], ['lost', 'achou caro'])
}
{
  const { service, estado } = montar({ status: 'lost', stage_id: 'st-perdido_objecao', closed_reason: 'achou caro' })
  await service.moverParaEstagio('deal-1', 'org-1', 'st-sem_interesse', 'u')
  checar('trocar de perda atualiza o motivo (título da posição quando não há)', [estado.status, estado.closed_reason], ['lost', 'sem_interesse'])
}
{
  const { service, estado } = montar({})
  await service.moverParaEstagio('deal-1', 'org-1', 'st-iniciou_tratamento', 'u')
  checar('iniciou tratamento fecha como ganho', estado.status, 'won')
}

// --- 4. reabrir antes de mover ----------------------------------------------
console.log('4. reabrir')
{
  const { service, estado, chamadas, atividades } = montar({ status: 'lost', stage_id: 'st-sem_interesse' })
  await service.moverParaEstagio('deal-1', 'org-1', 'st-qualificado', 'u')
  checar('perdido volta para posição em andamento aberto', [estado.status, estado.stage_id], ['open', 'st-qualificado'])
  checar('reabre ANTES de mover', chamadas, ['status:open', 'update'])
  checar('timeline diz que reabriu', atividades, ['Movido para "qualificado" (reaberto)'])
}
{
  const { service, estado } = montar({ status: 'lost', stage_id: 'st-sem_interesse' }, { falharAoReabrir: true })
  await erroDe(() => service.moverParaEstagio('deal-1', 'org-1', 'st-qualificado', 'u'))
  checar('reabrir falhou → card não se move', estado.stage_id, 'st-sem_interesse')
}

// --- 5. motivo é da posição atual -------------------------------------------
console.log('5. motivo da posição atual')
{
  const { service, estado } = montar({ stage_id: 'st-encaminhado_humano', motivo: 'pediu pessoa' })
  await service.moverParaEstagio('deal-1', 'org-1', 'st-qualificado', 'u')
  checar('mover sem motivo limpa o anterior', estado.motivo, null)
}

console.log(falhas === 0 ? '\nTudo certo.' : `\n${falhas} falha(s).`)
if (falhas > 0) process.exit(1)
