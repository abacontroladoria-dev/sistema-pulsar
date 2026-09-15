import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AIMode,
  Conversation,
  ConversationStatus,
  PaginatedResult,
} from '../types/central.types'

// ============================================================================
// ConversationRepository
//
// Acesso exclusivo à tabela central.conversations.
// Nunca contém lógica de negócio — toda orquestração pertence ao ConversationService.
//
// Indexes utilizados (migration 20260701000500):
//   findById                          → PK lookup
//   findActiveByContactAndChannel     → uq_conversations_active_per_contact_channel
//   list                              → idx_conversations_org_inbox_status
//                                     → idx_conversations_org_status_last_msg
//   listByContact                     → idx_conversations_org_contact
// ============================================================================

export interface ListConversationsFilters {
  orgId:           string
  inboxId?:        string
  status?:         ConversationStatus | ConversationStatus[]
  // null = buscar não atribuídas; string = buscar por operador específico
  assignedUserId?: string | null
  contactId?:      string
  limit?:          number   // default 30
  offset?:         number   // default 0
}

export interface CreateConversationInput {
  organization_id:   string
  inbox_id:          string
  channel_id:        string
  contact_id:        string
  assigned_user_id?: string | null
  status?:           ConversationStatus   // default 'open'
}

export class ConversationRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async findById(id: string): Promise<Conversation | null> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('conversations')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (error) throw error
    return (data ?? null) as Conversation | null
  }

  // Hot path do webhook processor.
  // Verifica se existe conversa ativa (open|assigned|waiting) para o par
  // contato+canal antes de criar uma nova. Usa o índice parcial único
  // uq_conversations_active_per_contact_channel via filtro equivalente.
  async findActiveByContactAndChannel(
    contactId: string,
    channelId: string
  ): Promise<Conversation | null> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('conversations')
      .select('*')
      .eq('contact_id', contactId)
      .eq('channel_id', channelId)
      .in('status', ['open', 'assigned', 'waiting'])
      .maybeSingle()

    if (error) throw error
    return (data ?? null) as Conversation | null
  }

  async list(filters: ListConversationsFilters): Promise<PaginatedResult<Conversation>> {
    const limit  = filters.limit  ?? 30
    const offset = filters.offset ?? 0

    let query = (this.supabase as any)
      .schema('central')
      .from('conversations')
      .select('*', { count: 'exact' })
      .eq('organization_id', filters.orgId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1)

    if (filters.inboxId) {
      query = query.eq('inbox_id', filters.inboxId)
    }

    if (filters.status !== undefined) {
      if (Array.isArray(filters.status)) {
        query = query.in('status', filters.status)
      } else {
        query = query.eq('status', filters.status)
      }
    }

    if (filters.assignedUserId !== undefined) {
      if (filters.assignedUserId === null) {
        query = query.is('assigned_user_id', null)
      } else {
        query = query.eq('assigned_user_id', filters.assignedUserId)
      }
    }

    if (filters.contactId) {
      query = query.eq('contact_id', filters.contactId)
    }

    const { data, count, error } = await query
    if (error) throw error

    return {
      data:  (data ?? []) as Conversation[],
      count: count ?? 0,
    }
  }

  // INSERT sem ON CONFLICT porque o índice único parcial do PostgreSQL
  // (uq_conversations_active_per_contact_channel) não suporta ON CONFLICT
  // com predicado composto. Race conditions são tratadas pelo ConversationService:
  // captura o código 23505 e faz retry em findActiveByContactAndChannel.
  async create(input: CreateConversationInput): Promise<Conversation> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('conversations')
      .insert({
        organization_id:  input.organization_id,
        inbox_id:         input.inbox_id,
        channel_id:       input.channel_id,
        contact_id:       input.contact_id,
        assigned_user_id: input.assigned_user_id ?? null,
        status:           input.status ?? 'open',
      })
      .select()
      .single()

    if (error) throw error
    return data as Conversation
  }

  async updateStatus(
    id:     string,
    status: ConversationStatus,
    extra?: { resolved_at?: string; archived_at?: string }
  ): Promise<void> {
    const patch: Record<string, unknown> = { status }
    if (extra?.resolved_at) patch.resolved_at = extra.resolved_at
    if (extra?.archived_at) patch.archived_at = extra.archived_at

    const { error } = await (this.supabase as any)
      .schema('central')
      .from('conversations')
      .update(patch)
      .eq('id', id)

    if (error) throw error
  }

  // Busca conversas ativas de uma lista de contatos.
  // Usado pela search API para correlacionar contatos com suas conversas abertas.
  async listByContactIds(orgId: string, contactIds: string[], limit: number): Promise<Conversation[]> {
    if (contactIds.length === 0) return []

    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('conversations')
      .select('*')
      .eq('organization_id', orgId)
      .in('contact_id', contactIds)
      .in('status', ['open', 'assigned', 'waiting'])
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(limit)

    if (error) throw error
    return (data ?? []) as Conversation[]
  }

  // Escreve a decisão de IA DESTA conversa. `null` devolve a conversa ao padrão
  // da inbox/organização — não é o mesmo que 'off', que é uma decisão de
  // desligar. Ver 20260915220000.
  async updateAiMode(id: string, aiMode: AIMode | null): Promise<void> {
    const { error } = await (this.supabase as any)
      .schema('central')
      .from('conversations')
      .update({ ai_mode: aiMode })
      .eq('id', id)

    if (error) throw error
  }

  async updateAssignee(id: string, userId: string | null): Promise<void> {
    const { error } = await (this.supabase as any)
      .schema('central')
      .from('conversations')
      .update({ assigned_user_id: userId })
      .eq('id', id)

    if (error) throw error
  }
}
