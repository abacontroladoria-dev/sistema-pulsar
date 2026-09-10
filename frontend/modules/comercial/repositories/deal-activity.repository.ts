import type { SupabaseClient } from '@supabase/supabase-js'
import type { DealActivityRow, DealActivityType } from '../types/crm.types'

// ============================================================================
// DealActivityRepository
//
// Acesso exclusivo a crm.deal_activities — a timeline de cada negócio.
//
// A migration descreve a tabela como "appended chronologically — não é
// editável". A policy de UPDATE existe (para marcar tarefa como concluída),
// mas a convenção é registrar novo evento em vez de reescrever o anterior:
// a timeline é auditoria.
//
// created_by / created_by_ai: exatamente um deve ser não-nulo.
//   operador   → created_by = user_id, created_by_ai = false
//   IA/sistema → created_by = null,    created_by_ai = true
// ============================================================================

export class DealActivityRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  private get table() {
    return (this.supabase as any).schema('crm').from('deal_activities')
  }

  // Mais recente primeiro — é como a timeline é lida na UI.
  async listByDeal(dealId: string, orgId: string, limit = 100): Promise<DealActivityRow[]> {
    const { data, error } = await this.table
      .select('*')
      .eq('deal_id', dealId)
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) throw error
    return (data ?? []) as DealActivityRow[]
  }

  async create(input: {
    organization_id: string
    deal_id:         string
    type:            DealActivityType
    title?:          string | null
    description?:    string | null
    created_by?:     string | null
    created_by_ai?:  boolean
  }): Promise<DealActivityRow> {
    const { data, error } = await this.table
      .insert({
        ...input,
        created_by_ai: input.created_by_ai ?? false,
      })
      .select('*')
      .single()

    if (error) throw error
    return data as DealActivityRow
  }

  // --------------------------------------------------------------------------
  // registrarMudancaDeStatus — evento de sistema.
  //
  // Chamado pelo DealService sempre que um deal muda de estágio ou é fechado.
  // created_by carrega o usuário que agiu (não é IA), então a timeline mostra
  // quem moveu o quê.
  //
  // Nunca deve derrubar a operação principal: se o registro da atividade
  // falhar, o deal já foi movido e reverter seria pior. Quem chama trata o
  // erro como não-fatal — ver DealService.moverParaEstagio.
  // --------------------------------------------------------------------------
  async registrarMudancaDeStatus(input: {
    organization_id: string
    deal_id:         string
    descricao:       string
    created_by:      string | null
  }): Promise<DealActivityRow> {
    return this.create({
      organization_id: input.organization_id,
      deal_id:         input.deal_id,
      type:            'status_change',
      title:           'Mudança de etapa',
      description:     input.descricao,
      created_by:      input.created_by,
      created_by_ai:   false,
    })
  }
}
