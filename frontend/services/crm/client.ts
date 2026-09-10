import {
  montarBoard,
  adaptarDeal,
  adaptarColuna,
  adaptarAtividade,
  type KanbanColumnUI,
  type DealUI,
  type DealActivityUI,
} from './adapter'
import type {
  DealWithContactRow,
  PipelineStageRow,
  DealActivityRow,
} from '@/modules/comercial/types/crm.types'

// ============================================================================
// Cliente HTTP do CRM — fala com /api/crm/*
//
// Substitui os mocks de services/api.ts e services/nina/api.ts, que retornavam
// dados fixos ("24 atendimentos", "Seg-Dom") desde que a UI foi portada.
//
// Por que passar por /api em vez de chamar o Supabase direto do browser:
//   - a lógica de auto_win/auto_lose e o registro de timeline vivem no
//     DealService, no servidor; um client direto os puliria
//   - o organization_id vem do JWT no servidor e nunca do cliente
//   - mantém o mesmo desenho que a Central já usa
// ============================================================================

// ----------------------------------------------------------------------------
// O projeto roda com `trailingSlash: true` (next.config). Sem a barra final o
// Next responde 308 apontando para a URL com barra.
//
// Em GET o browser segue o redirect e nada quebra — é por isso que a Central
// chama sem barra e funciona. Mas em POST/PATCH/DELETE o 308 é risco real: o
// corpo depende do cliente seguir o redirect preservando método e payload.
// Verificado neste servidor: `POST /api/crm/deals` devolve 308 e NÃO chega ao
// handler; com a barra, chega.
//
// Então a barra é adicionada aqui, antes da query string, e nenhuma chamada do
// CRM depende de redirect. Mesma família de armadilha de
// [[reference_webhook_meta_trailing_slash]].
// ----------------------------------------------------------------------------
function comBarraFinal(url: string): string {
  const [caminho, query] = url.split('?')
  const caminhoComBarra = caminho.endsWith('/') ? caminho : `${caminho}/`
  return query ? `${caminhoComBarra}?${query}` : caminhoComBarra
}

// O envelope de resposta é { data, pagination? } para sucesso e
// { error: { code, message } } para falha — ver lib/central/response.ts.
async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const resposta = await fetch(comBarraFinal(url), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  const corpo = await resposta.json().catch(() => null)

  if (!resposta.ok) {
    const msg = corpo?.error?.message ?? `Falha na requisição (${resposta.status})`
    const erro = new Error(msg) as Error & { code?: string; status?: number }
    erro.code   = corpo?.error?.code
    erro.status = resposta.status
    throw erro
  }

  return corpo?.data as T
}

export const crmApi = {
  // --------------------------------------------------------------------------
  // Board completo do Kanban.
  //
  // Estágios e deals são buscados EM PARALELO — são independentes, e sequenciar
  // dobraria o tempo de abertura da tela.
  //
  // Sem limite explícito o backend usa 500. Acima disso o board precisaria de
  // paginação por coluna, o que a UI atual não suporta.
  // --------------------------------------------------------------------------
  async fetchBoard(): Promise<KanbanColumnUI[]> {
    const [stages, deals] = await Promise.all([
      req<PipelineStageRow[]>('/api/crm/stages'),
      req<DealWithContactRow[]>('/api/crm/deals'),
    ])
    return montarBoard(stages, deals)
  },

  async fetchPipeline(): Promise<DealUI[]> {
    const deals = await req<DealWithContactRow[]>('/api/crm/deals')
    return deals.map(adaptarDeal)
  },

  async fetchPipelineStages(): Promise<KanbanColumnUI[]> {
    const stages = await req<PipelineStageRow[]>('/api/crm/stages')
    return stages.map(s => adaptarColuna(s))
  },

  async createDeal(input: {
    title:          string
    stageId?:       string
    contactId?:     string | null
    value?:         number | null
    priority?:      string
    description?:   string | null
    expectedCloseDate?: string | null
    tags?:          string[]
    source?:        string
  }): Promise<DealUI> {
    const row = await req<DealWithContactRow>('/api/crm/deals', {
      method: 'POST',
      body:   JSON.stringify(input),
    })
    return adaptarDeal(row)
  },

  async updateDeal(id: string, patch: Record<string, unknown>): Promise<DealUI> {
    const row = await req<DealWithContactRow>(`/api/crm/deals/${id}`, {
      method: 'PATCH',
      body:   JSON.stringify(patch),
    })
    return adaptarDeal(row)
  },

  // Mover de coluna tem rota própria: dispara auto_win/auto_lose e grava a
  // timeline. Um PATCH com stage_id pularia as duas coisas.
  async moveDealStage(id: string, stageId: string): Promise<DealUI> {
    const row = await req<DealWithContactRow>(`/api/crm/deals/${id}/move`, {
      method: 'POST',
      body:   JSON.stringify({ stageId }),
    })
    return adaptarDeal(row)
  },

  async markDealWon(id: string): Promise<DealUI> {
    const row = await req<DealWithContactRow>(`/api/crm/deals/${id}/status`, {
      method: 'POST',
      body:   JSON.stringify({ status: 'won' }),
    })
    return adaptarDeal(row)
  },

  // `reason` é exigido pelo backend — perda sem motivo torna a análise de
  // perda inútil depois.
  async markDealLost(id: string, reason: string): Promise<DealUI> {
    const row = await req<DealWithContactRow>(`/api/crm/deals/${id}/status`, {
      method: 'POST',
      body:   JSON.stringify({ status: 'lost', reason }),
    })
    return adaptarDeal(row)
  },

  async reopenDeal(id: string): Promise<DealUI> {
    const row = await req<DealWithContactRow>(`/api/crm/deals/${id}/status`, {
      method: 'POST',
      body:   JSON.stringify({ status: 'open' }),
    })
    return adaptarDeal(row)
  },

  async deleteDeal(id: string): Promise<void> {
    await req<void>(`/api/crm/deals/${id}`, { method: 'DELETE' })
  },

  async fetchDealActivities(dealId: string): Promise<DealActivityUI[]> {
    const rows = await req<DealActivityRow[]>(`/api/crm/deals/${dealId}/activities`)
    return rows.map(adaptarAtividade)
  },

  async createDealActivity(dealId: string, input: {
    type:         string
    title?:       string
    description?: string
  }): Promise<DealActivityUI> {
    const row = await req<DealActivityRow>(`/api/crm/deals/${dealId}/activities`, {
      method: 'POST',
      body:   JSON.stringify(input),
    })
    return adaptarAtividade(row)
  },

  async createStage(input: {
    title:     string
    color?:    string
    autoWin?:  boolean
    autoLose?: boolean
  }): Promise<KanbanColumnUI> {
    const row = await req<PipelineStageRow>('/api/crm/stages', {
      method: 'POST',
      body:   JSON.stringify(input),
    })
    return adaptarColuna(row)
  },
}
