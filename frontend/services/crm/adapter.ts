import type {
  DealWithContactRow,
  PipelineStageRow,
  DealActivityRow,
  TrilhaEstagio,
  TrilhaNegocio,
} from '@/modules/comercial/types/crm.types'

// ============================================================================
// Adapter — linha do banco → formato da tela do funil
//
// camelCase e só o que a tela usa. Os campos do port do Nina que não existem
// numa clínica (valor em R$, "empresa", avatar sorteado) saíram junto com o
// Kanban antigo — ver components/nina/funil/.
// ============================================================================

export interface KanbanColumnUI {
  id:          string
  slug:        string | null
  title:       string
  description: string | null
  // Hex do banco (#64748b). Vai em `style`, nunca em classe Tailwind.
  color:       string
  order:       number
  trilha:      TrilhaEstagio
  exigeMotivo: boolean
  autoWin:     boolean
  autoLose:    boolean
  isSystem:    boolean
}

export interface DealUI {
  id:             string
  title:          string
  status:         string
  stageId:        string
  trilha:         TrilhaNegocio | null
  resgate:        boolean
  motivo:         string | null
  stageChangedAt: string | null
  ownerId:        string | null
  contactId:      string | null
  contactName:    string | null
  contactPhone:   string | null
  conversationId: string | null
  closedReason:   string | null
  closedAt:       string | null
  createdByAi:    boolean
  source:         string | null
  createdAt:      string | null
  updatedAt:      string | null
}

export function adaptarDeal(row: DealWithContactRow): DealUI {
  return {
    id:             row.id,
    title:          row.title,
    status:         row.status,
    stageId:        row.stage_id,
    trilha:         row.trilha ?? null,
    resgate:        row.resgate ?? false,
    motivo:         row.motivo ?? null,
    stageChangedAt: row.stage_changed_at ?? row.updated_at ?? null,
    ownerId:        row.assigned_to,
    contactId:      row.contact_id,
    contactName:    row.contact?.name ?? null,
    contactPhone:   row.contact?.display_phone ?? null,
    conversationId: row.conversation_id,
    closedReason:   row.closed_reason,
    closedAt:       row.closed_at,
    createdByAi:    row.created_by_ai,
    source:         row.source,
    createdAt:      row.created_at,
    updatedAt:      row.updated_at,
  }
}

export function adaptarColuna(stage: PipelineStageRow): KanbanColumnUI {
  return {
    id:          stage.id,
    slug:        stage.slug ?? null,
    title:       stage.title,
    description: stage.description,
    color:       stage.color,
    order:       stage.position,
    trilha:      stage.trilha ?? 'ambas',
    exigeMotivo: stage.exige_motivo ?? false,
    autoWin:     stage.auto_win,
    autoLose:    stage.auto_lose,
    isSystem:    stage.is_system,
  }
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
