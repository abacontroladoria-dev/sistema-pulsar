import type {
  DealWithContactRow,
  PipelineStageRow,
  DealActivityRow,
} from '@/modules/comercial/types/crm.types'

// ============================================================================
// Adapter — linha do banco → formato que a UI do Nina espera
//
// A UI foi escrita para um backend anterior (Nina como SPA Vite) e usa
// camelCase com nomes próprios: `stageId`, `company`, `dueDate`, `ownerAvatar`.
// O banco devolve snake_case. Traduzir aqui, num lugar só, evita reescrever
// ~900 linhas de Kanban e mantém o repositório fiel ao schema.
//
// Quando a UI for reescrita no padrão do Pulsar, este arquivo é o que se
// apaga — nada mais depende do formato antigo.
// ============================================================================

// Cores fixas por posição do funil, usadas quando o estágio não define a sua.
// A UI espera classes Tailwind de borda, não hex — a coluna `color` do banco
// guarda hex (#64748b), que não serve como classe.
const CORES_POR_POSICAO = [
  'border-slate-500',
  'border-yellow-500',
  'border-cyan-500',
  'border-blue-500',
  'border-emerald-500',
  'border-red-500',
]

function corDaColuna(stage: PipelineStageRow): string {
  // auto_win/auto_lose têm significado visual próprio e devem ser
  // reconhecíveis à primeira vista, independentemente da posição.
  if (stage.auto_win)  return 'border-emerald-500'
  if (stage.auto_lose) return 'border-red-500'
  return CORES_POR_POSICAO[stage.position % CORES_POR_POSICAO.length]
}

// Avatar por iniciais — evita <img src=""> quebrado quando não há foto.
// A UI faz <img src={deal.ownerAvatar}>, então precisa de uma URL válida.
function avatarDeIniciais(nome: string | null): string {
  const iniciais = (nome ?? '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(p => p[0] ?? '')
    .join('')
    .toUpperCase() || '?'
  // DiceBear via URL determinística: mesmo nome, mesmo avatar, sem requisição
  // ao nosso backend e sem estado.
  return `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(iniciais)}`
}

export interface KanbanColumnUI {
  id:          string
  title:       string
  name:        string
  color:       string
  isLocked:    boolean
  isAiManaged: boolean
  order:       number
  deals:       DealUI[]
  autoWin:     boolean
  autoLose:    boolean
  isSystem:    boolean
}

export interface DealUI {
  id:             string
  title:          string
  company:        string
  value:          number
  priority:       string
  status:         string
  stageId:        string
  tags:           string[]
  dueDate:        string | null
  ownerAvatar:    string
  ownerId:        string | null
  contactId:      string | null
  contactName:    string | null
  contactPhone:   string | null
  conversationId: string | null
  aiScore:        number | null
  createdAt:      string | null
  updatedAt:      string | null
  closedReason:   string | null
  source:         string | null
}

export function adaptarDeal(row: DealWithContactRow): DealUI {
  const nomeContato = row.contact?.name ?? null

  return {
    id:      row.id,
    title:   row.title,
    // A UI mostra `company` como subtítulo do card e o usa na busca. Aqui não
    // há empresa (clínica, não B2B): o nome do contato é a informação útil
    // nesse lugar. String vazia — nunca null — porque o Kanban chama
    // .toLowerCase() nesse campo ao filtrar e quebraria com null.
    company:        nomeContato ?? '',
    value:          row.value ?? 0,
    priority:       row.priority,
    status:         row.status,
    stageId:        row.stage_id,
    tags:           row.tags ?? [],
    dueDate:        row.expected_close_date,
    ownerAvatar:    avatarDeIniciais(nomeContato),
    ownerId:        row.assigned_to,
    contactId:      row.contact_id,
    contactName:    nomeContato,
    contactPhone:   row.contact?.phone_number ?? null,
    conversationId: row.conversation_id,
    aiScore:        row.ai_score,
    createdAt:      row.created_at,
    updatedAt:      row.updated_at,
    closedReason:   row.closed_reason,
    source:         row.source,
  }
}

export function adaptarColuna(stage: PipelineStageRow, deals: DealUI[] = []): KanbanColumnUI {
  return {
    id:    stage.id,
    title: stage.title,
    name:  stage.title,
    color: corDaColuna(stage),
    // `isLocked` na UI original desabilitava o delete da coluna. Mapeia para
    // is_system, que é a flag equivalente no banco.
    isLocked:    stage.is_system,
    // Nenhum estágio é gerido por IA hoje. O campo existe na UI (mostra um
    // ícone de robô) e fica false até haver essa funcionalidade.
    isAiManaged: false,
    order:       stage.position,
    deals,
    autoWin:     stage.auto_win,
    autoLose:    stage.auto_lose,
    isSystem:    stage.is_system,
  }
}

// Monta o board completo: cada coluna já com seus deals.
// Deals cujo stage_id não corresponde a nenhuma coluna ativa são DESCARTADOS
// aqui — isso acontece quando um estágio é desativado com deals dentro. Some
// da tela, mas não do banco; a correção é reativar o estágio ou mover os deals.
export function montarBoard(
  stages: PipelineStageRow[],
  deals:  DealWithContactRow[]
): KanbanColumnUI[] {
  const adaptados = deals.map(adaptarDeal)
  return stages.map(stage =>
    adaptarColuna(stage, adaptados.filter(d => d.stageId === stage.id))
  )
}

export interface DealActivityUI {
  id:          string
  deal_id:     string
  type:        string
  title:       string | null
  description: string
  createdAt:   string | null
  createdByAi: boolean
  createdBy:   string | null
}

export function adaptarAtividade(row: DealActivityRow): DealActivityUI {
  return {
    id:          row.id,
    deal_id:     row.deal_id,
    type:        row.type,
    title:       row.title,
    description: row.description ?? '',
    createdAt:   row.created_at,
    createdByAi: row.created_by_ai,
    createdBy:   row.created_by,
  }
}
