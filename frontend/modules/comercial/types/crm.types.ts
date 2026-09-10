// ============================================================================
// Tipos do domínio CRM — espelham o schema `crm` (migrations 20260701020*)
//
// Estes tipos descrevem as LINHAS DO BANCO, em snake_case, exatamente como o
// PostgREST as devolve. A tradução para o formato que a UI do Nina espera
// (camelCase, `deals` aninhados na coluna) acontece no adapter, nunca aqui.
//
// Separação de domínios declarada em 20260701020000_crm_schema.sql:
//   central → comunicação e atendimento
//   crm     → gestão comercial e pipeline
//   public  → operação clínica
// ============================================================================

export type DealStatus   = 'open' | 'won' | 'lost'
export type DealPriority = 'low' | 'medium' | 'high' | 'urgent'

// source válidos segundo o comentário de crm.deals. Não há CHECK no banco —
// a coluna é text livre —, então este union é a única guarda que existe.
export type DealSource =
  | 'whatsapp' | 'instagram' | 'facebook' | 'google_ads'
  | 'site'     | 'indicacao' | 'convenio' | 'importacao' | 'manual'

export type DealActivityType =
  | 'note' | 'call' | 'email' | 'meeting'
  | 'task' | 'status_change' | 'ai_analysis'

// ----------------------------------------------------------------------------
// crm.pipeline_stages
//
// auto_win / auto_lose: mover um deal para este estágio o fecha automaticamente
// como won/lost. Quem aplica essa regra é o DealService — o banco não tem
// trigger para isso.
//
// is_system: estágio protegido. A UI desabilita o delete; a policy NÃO bloqueia
// (admin pode remover se precisar), conforme nota em 20260701020300_crm_rls.sql.
// ----------------------------------------------------------------------------
export interface PipelineStageRow {
  id:              string
  organization_id: string
  title:           string
  description:     string | null
  color:           string
  position:        number
  is_system:       boolean
  is_active:       boolean
  auto_win:        boolean
  auto_lose:       boolean
  created_at:      string | null
  updated_at:      string | null
}

// ----------------------------------------------------------------------------
// crm.deals
//
// contact_id e conversation_id são ON DELETE SET NULL — o deal sobrevive à
// remoção do contato (LGPD) mantendo título, valor e histórico. Por isso ambos
// são nullable aqui: linha órfã é estado válido, não corrupção.
//
// value é numeric(12,2); o PostgREST devolve numeric como number em JSON.
// ----------------------------------------------------------------------------
export interface DealRow {
  id:                  string
  organization_id:     string
  contact_id:          string | null
  conversation_id:     string | null
  stage_id:            string
  title:               string
  description:         string | null
  value:               number | null
  currency:            string
  priority:            DealPriority
  status:              DealStatus
  expected_close_date: string | null
  closed_at:           string | null
  closed_reason:       string | null
  assigned_to:         string | null
  source:              string | null
  source_campaign:     string | null
  source_ref:          Record<string, unknown> | null
  created_by_ai:       boolean
  ai_score:            number | null
  ai_score_notes:      string | null
  ai_scored_at:        string | null
  tags:                string[] | null
  created_at:          string | null
  updated_at:          string | null
}

// Deal com o contato embutido pelo join do PostgREST.
// O contato vem de central.contacts — schema diferente, mas a FK cross-schema
// permite o embed porque o PostgREST resolve por constraint, não por schema.
export interface DealWithContactRow extends DealRow {
  contact: {
    id:           string
    name:         string | null
    phone_number: string | null
    email:        string | null
  } | null
}

// ----------------------------------------------------------------------------
// crm.deal_activities
//
// Append-only por convenção (o comentário da migration diz "não é editável"),
// embora a policy de UPDATE exista para marcar tarefa como concluída.
//
// created_by / created_by_ai: exatamente um deve ser não-nulo.
//   operador → created_by = user_id, created_by_ai = false
//   IA/sistema → created_by = null,  created_by_ai = true
// ----------------------------------------------------------------------------
export interface DealActivityRow {
  id:              string
  organization_id: string
  deal_id:         string
  type:            DealActivityType
  title:           string | null
  description:     string | null
  created_by:      string | null
  created_by_ai:   boolean
  created_at:      string | null
  updated_at:      string | null
}

// ----------------------------------------------------------------------------
// Entradas de escrita
// ----------------------------------------------------------------------------

export interface CreateDealInput {
  organization_id:      string
  stage_id:             string
  title:                string
  contact_id?:          string | null
  conversation_id?:     string | null
  description?:         string | null
  value?:               number | null
  priority?:            DealPriority
  expected_close_date?: string | null
  assigned_to?:         string | null
  source?:              string | null
  source_campaign?:     string | null
  tags?:                string[]
}

export interface UpdateDealInput {
  stage_id?:            string
  title?:               string
  description?:         string | null
  value?:               number | null
  priority?:            DealPriority
  expected_close_date?: string | null
  assigned_to?:         string | null
  tags?:                string[]
}

export interface ListDealsFilters {
  orgId:    string
  status?:  DealStatus | DealStatus[]
  stageId?: string
  /** Busca por título do deal (ilike). Não busca no nome do contato. */
  search?:  string
  limit?:   number
  offset?:  number
}
