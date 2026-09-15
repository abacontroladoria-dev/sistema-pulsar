import type {
  AIMode,
  Conversation,
  PaginatedResult,
} from '../types/central.types'
import type { ListConversationsFilters, CreateConversationInput } from '../repositories/conversation.repository'
import type { ConversationRepository } from '../repositories/conversation.repository'
import type { AuditRepository } from '../repositories/audit.repository'
import type { TypedEventBus } from '../events/event-bus'
import {
  ConversationNotFoundError,
  ConversationAlreadyClosedError,
} from '../types/errors.types'
import { isUniqueViolation } from '../utils/pg-errors'

// ============================================================================
// ConversationService
//
// Orquestra o ciclo de vida das conversas.
// Regras:
//   1. Toda operação de escrita valida o estado atual antes de prosseguir.
//   2. audit.insert() e events.emit() são side effects — disparados APÓS a
//      operação principal ser persistida. Nunca aguardados (void) para não
//      bloquear o fluxo de retorno.
//   3. Nenhuma regra de negócio existe nos repositories — apenas aqui.
//   4. Controllers e Server Actions não contêm lógica — apenas delegam.
// ============================================================================

// Statuses que impedem operações de ciclo de vida (assign, transfer, resolve)
const CLOSED_STATUSES = ['resolved', 'archived'] as const
type ClosedStatus = (typeof CLOSED_STATUSES)[number]

export interface FindOrCreateResult {
  conversation: Conversation
  created:      boolean
}

export interface TransferInput {
  conversationId: string
  toUserId:       string
  actorId:        string
  reason?:        string
}

export class ConversationService {
  constructor(
    private readonly conv:   ConversationRepository,
    private readonly audit:  AuditRepository,
    private readonly events: TypedEventBus
  ) {}

  // -------------------------------------------------------------------------
  // findOrCreate
  // Ponto de entrada do webhook processor. Garante exatamente uma conversa
  // ativa por par (contato, canal). Resistente a race conditions via retry
  // em violação de constraint única (PostgreSQL code 23505).
  // -------------------------------------------------------------------------
  async findOrCreate(
    contactId: string,
    channelId: string,
    inboxId:   string,
    orgId:     string
  ): Promise<FindOrCreateResult> {
    // Caminho feliz: conversa ativa já existe
    const existing = await this.conv.findActiveByContactAndChannel(contactId, channelId)
    if (existing) return { conversation: existing, created: false }

    // Tentar criar — pode colidir com outro processo concurrent
    try {
      const conversation = await this.conv.create({
        organization_id: orgId,
        inbox_id:        inboxId,
        channel_id:      channelId,
        contact_id:      contactId,
        status:          'open',
      })

      // Side effects: não bloqueia o retorno
      void this.audit.insert({
        organization_id: orgId,
        conversation_id: conversation.id,
        event_type:      'conversation.created',
        performed_by:    undefined,
        payload:         { contactId, channelId, inboxId },
      })

      this.events.emit('conversation.created', {
        conversation,
        actorId: 'system',
      })

      return { conversation, created: true }

    } catch (err) {
      // Race condition: outro processo criou a conversa primeiro.
      // PostgreSQL retorna code 23505 em violação de unique constraint.
      if (isUniqueViolation(err)) {
        const found = await this.conv.findActiveByContactAndChannel(contactId, channelId)
        if (found) return { conversation: found, created: false }
      }
      throw err
    }
  }

  // -------------------------------------------------------------------------
  // getById
  // -------------------------------------------------------------------------
  async getById(id: string): Promise<Conversation> {
    const conv = await this.conv.findById(id)
    if (!conv) throw new ConversationNotFoundError(id)
    return conv
  }

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------
  async list(filters: ListConversationsFilters): Promise<PaginatedResult<Conversation>> {
    return this.conv.list(filters)
  }

  // Contagem sem trazer linhas. Os cards da triagem chamam uma vez por caixa.
  async contar(filters: ListConversationsFilters): Promise<number> {
    return this.conv.contar(filters)
  }

  // -------------------------------------------------------------------------
  // assign
  // Atribui conversa a um operador. Muda status para 'assigned'.
  // Requer: conversa ativa (não resolvida/arquivada).
  // -------------------------------------------------------------------------
  async assign(conversationId: string, toUserId: string, actorId: string): Promise<void> {
    const conv            = await this.requireActive(conversationId)
    const previousAssignee= conv.assigned_user_id

    await this.conv.updateAssignee(conversationId, toUserId)
    await this.conv.updateStatus(conversationId, 'assigned')

    const updated: Conversation = {
      ...conv,
      assigned_user_id: toUserId,
      status:           'assigned',
    }

    void this.audit.insert({
      organization_id: conv.organization_id,
      conversation_id: conversationId,
      event_type:      'conversation.assigned',
      performed_by:    actorId,
      payload:         { toUserId, previousAssignee },
    })

    this.events.emit('conversation.assigned', {
      conversation:     updated,
      toUserId,
      previousAssignee,
      actorId,
    })
  }

  // -------------------------------------------------------------------------
  // setAiMode
  // A chave Maia / Atendente do inbox. Decide POR CONVERSA quem responde, sem
  // tocar no ai_mode da organização — a recepcionista assume UMA conversa, não
  // desliga a atendente da clínica inteira.
  //
  // `null` devolve a conversa ao padrão da inbox/org, e não é sinônimo de 'off':
  // 'off' é "esta conversa foi desligada" e sobrevive a qualquer mudança de
  // padrão; null é "nunca foi tocada". Ver 20260915220000.
  //
  // Não usa requireActive: faz sentido religar a Maia numa conversa que acabou
  // de ser resolvida e o responsável reabriu escrevendo de novo. O que torna a
  // conversa elegível a turno é o worker, não este método.
  //
  // A auditoria é o ponto todo deste método existir — sem ela, "a Maia parou de
  // responder esse contato" fica sem dono nem horário.
  // -------------------------------------------------------------------------
  async setAiMode(conversationId: string, aiMode: AIMode | null, actorId: string): Promise<void> {
    const conv      = await this.getById(conversationId)
    const anterior  = conv.ai_mode

    await this.conv.updateAiMode(conversationId, aiMode)

    void this.audit.insert({
      organization_id: conv.organization_id,
      conversation_id: conversationId,
      event_type:      'conversation.ai_mode_changed',
      performed_by:    actorId,
      payload:         { de: anterior, para: aiMode },
    })
  }

  // -------------------------------------------------------------------------
  // transfer
  // Transfere conversa para outro operador sem fechar.
  // Status permanece 'assigned' — apenas o assignee muda.
  // -------------------------------------------------------------------------
  async transfer(input: TransferInput): Promise<void> {
    const { conversationId, toUserId, actorId, reason } = input
    const conv       = await this.requireActive(conversationId)
    const fromUserId = conv.assigned_user_id

    await this.conv.updateAssignee(conversationId, toUserId)

    const updated: Conversation = { ...conv, assigned_user_id: toUserId }

    void this.audit.insert({
      organization_id: conv.organization_id,
      conversation_id: conversationId,
      event_type:      'conversation.transferred',
      performed_by:    actorId,
      payload:         { toUserId, fromUserId, reason: reason ?? null },
    })

    this.events.emit('conversation.transferred', {
      conversation: updated,
      toUserId,
      fromUserId,
      actorId,
      reason,
    })
  }

  // -------------------------------------------------------------------------
  // resolve
  // Encerra o atendimento. Preenche resolved_at.
  // -------------------------------------------------------------------------
  async resolve(conversationId: string, actorId: string): Promise<void> {
    const conv       = await this.requireActive(conversationId)
    const resolvedAt = new Date().toISOString()

    await this.conv.updateStatus(conversationId, 'resolved', { resolved_at: resolvedAt })

    const updated: Conversation = { ...conv, status: 'resolved', resolved_at: resolvedAt }

    void this.audit.insert({
      organization_id: conv.organization_id,
      conversation_id: conversationId,
      event_type:      'conversation.resolved',
      performed_by:    actorId,
      payload:         { resolvedAt },
    })

    this.events.emit('conversation.resolved', { conversation: updated, actorId })
  }

  // -------------------------------------------------------------------------
  // archive
  // Move conversa para histórico. Preenche archived_at.
  // -------------------------------------------------------------------------
  async archive(conversationId: string, actorId: string): Promise<void> {
    const conv       = await this.requireActive(conversationId)
    const archivedAt = new Date().toISOString()

    await this.conv.updateStatus(conversationId, 'archived', { archived_at: archivedAt })

    const updated: Conversation = { ...conv, status: 'archived', archived_at: archivedAt }

    void this.audit.insert({
      organization_id: conv.organization_id,
      conversation_id: conversationId,
      event_type:      'conversation.archived',
      performed_by:    actorId,
      payload:         { archivedAt },
    })

    this.events.emit('conversation.archived', { conversation: updated, actorId })
  }

  // -------------------------------------------------------------------------
  // reopen
  // Reabre conversa resolvida ou arquivada. Idempotente: se já estiver ativa,
  // retorna sem erro (não deve ser rejeitado como "já aberta").
  // -------------------------------------------------------------------------
  async reopen(conversationId: string, actorId: string): Promise<void> {
    const conv = await this.conv.findById(conversationId)
    if (!conv) throw new ConversationNotFoundError(conversationId)

    // Já está ativa — operação idempotente, sem efeito
    if (!CLOSED_STATUSES.includes(conv.status as ClosedStatus)) return

    await this.conv.updateStatus(conversationId, 'open')

    const updated: Conversation = {
      ...conv,
      status:      'open',
      resolved_at: null,
      archived_at: null,
    }

    void this.audit.insert({
      organization_id: conv.organization_id,
      conversation_id: conversationId,
      event_type:      'conversation.reopened',
      performed_by:    actorId,
      payload:         { previousStatus: conv.status },
    })

    this.events.emit('conversation.reopened', { conversation: updated, actorId })
  }

  // -------------------------------------------------------------------------
  // listByContactIds
  // Usada pela search API: dado um conjunto de contact IDs, retorna as
  // conversas ativas (open|assigned|waiting) associadas a eles.
  // -------------------------------------------------------------------------
  async listByContactIds(orgId: string, contactIds: string[], limit: number): Promise<Conversation[]> {
    return this.conv.listByContactIds(orgId, contactIds, limit)
  }

  // -------------------------------------------------------------------------
  // Helpers privados
  // -------------------------------------------------------------------------

  private async requireActive(id: string): Promise<Conversation> {
    const conv = await this.conv.findById(id)
    if (!conv) throw new ConversationNotFoundError(id)
    if (CLOSED_STATUSES.includes(conv.status as ClosedStatus)) {
      throw new ConversationAlreadyClosedError(id, conv.status)
    }
    return conv
  }

}
