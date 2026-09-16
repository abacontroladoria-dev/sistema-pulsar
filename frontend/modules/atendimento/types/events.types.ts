// ============================================================================
// Central de Atendimento — Event Types
//
// Define dois contratos relacionados a eventos:
//
//   1. ConversationEventType — string union dos tipos de eventos gravados em
//      central.conversation_events (tabela de auditoria). Usado por AuditRepository.
//
//   2. CAEventMap — mapa tipado dos eventos emitidos pelo caEventBus (in-process).
//      Apenas eventos de side effect: notificação, SLA, auditoria.
//      NÃO usados para orquestrar o fluxo principal de negócio.
// ============================================================================

import type { Conversation, Message, MessageStatus } from './central.types'

// ----------------------------------------------------------------------------
// ConversationEventType
// Superset dos eventos do CAEventMap — inclui eventos de sistema (webhook,
// contact) que não passam pelo EventBus mas são registrados no banco.
// ----------------------------------------------------------------------------

export type ConversationEventType =
  // Ciclo de vida da conversa
  | 'conversation.created'
  | 'conversation.assigned'
  | 'conversation.unassigned'
  | 'conversation.transferred'
  | 'conversation.resolved'
  | 'conversation.archived'
  | 'conversation.reopened'
  // Chave Maia / Atendente: quem passou esta conversa da IA para gente (ou de
  // volta), e quando. payload: { de, para } com os ai_mode, onde null significa
  // "seguindo o padrão da inbox/org". performed_by ausente = foi a própria IA
  // escalando (escalarParaHumano), não um operador.
  | 'conversation.ai_mode_changed'
  // Mensagens
  | 'message.received'
  | 'message.sent'
  | 'message.deleted'
  | 'message.status_updated'
  // Contatos
  | 'contact.created'
  | 'contact.updated'
  | 'contact.merged'
  | 'patient_link.created'
  // Agendamentos — o rastro de quem prometeu qual vaga a quem.
  // Vale tanto para operador humano (performed_by = uuid) quanto para o agente
  // de IA (performed_by = null, payload.criadoPorIa = true).
  | 'appointment.created'
  | 'appointment.updated'
  | 'appointment.rescheduled'
  | 'appointment.cancelled'
  | 'appointment.deleted'
  // Tarefas de atendimento (central.tasks). `task.status_changed` carrega
  // { de, para } porque concluir, cancelar e reabrir são a mesma escrita com
  // significados diferentes — sem o estado anterior, a trilha não distingue
  // "resolvi" de "desisti".
  | 'task.created'
  | 'task.updated'
  | 'task.status_changed'
  // Configuração do agente. Payload lista quais campos mudaram e sinaliza
  // troca de credencial — nunca o valor da credencial.
  | 'agent_settings.updated'
  // Rastro de uma chamada de ferramenta do agente. performed_by = null (é o
  // agente, não um operador).
  //
  // Payload: { iteracao, nome, argumentos, ok, motivo, qtdItens, duracaoMs }.
  // `argumentos` passa por uma ALLOWLIST em orquestrador.ts — só chaves e
  // parâmetros de recorte (terapiaId, unidade, datas, limite). Nunca o
  // conteúdo do resultado, nunca texto livre digitado pelo responsável.
  //
  // Existe para que "a IA ofereceu horário da unidade errada" seja respondível
  // por SQL. Sem ele as tool calls morriam no array local do orquestrador, e
  // "passou unidade: null e filtrou de cabeça" (defeito de prompt) era
  // indistinguível de "passou a unidade certa e o banco devolveu vazio"
  // (defeito de dados) — consertos em lugares completamente diferentes.
  | 'ai.tool_call'
  // Infra
  | 'webhook.received'
  | 'webhook.failed'
  | 'channel.connected'
  | 'channel.disconnected'

// ----------------------------------------------------------------------------
// CAEventMap — contrato do EventBus in-process
//
// ESCOPO: side effects após operação principal persistida com sucesso.
//
// Listeners ativos no Sprint 1: nenhum (estrutura preparada).
// Listeners Sprint 2: NotificationService (message.received, conversation.assigned,
//                     conversation.transferred).
// Listeners Sprint 3: SLAService (message.received, conversation.resolved).
//
// Regra: listeners NÃO lançam exceção para o caller — falha interna de listener
// não reverte a operação que gerou o evento.
// ----------------------------------------------------------------------------

export type CAEventMap = {
  'conversation.created': {
    conversation: Conversation
    actorId:      string   // 'system' para webhooks
  }

  'conversation.assigned': {
    conversation:     Conversation
    toUserId:         string
    previousAssignee: string | null
    actorId:          string
  }

  // A conversa voltou para a fila: ninguém é responsável por ela. Evento
  // próprio, e não um `assigned` com toUserId null, porque as duas coisas pedem
  // reações opostas — atribuir tira da fila de triagem, desatribuir devolve.
  // O nome já estava na lista de CentralEventType desde o início; faltava o
  // payload, e por isso nada podia emiti-lo.
  'conversation.unassigned': {
    conversation:     Conversation
    previousAssignee: string | null
    actorId:          string
  }

  'conversation.transferred': {
    conversation: Conversation
    toUserId:     string
    fromUserId:   string | null
    actorId:      string
    reason?:      string
  }

  'conversation.resolved': {
    conversation: Conversation
    actorId:      string
  }

  'conversation.archived': {
    conversation: Conversation
    actorId:      string
  }

  'conversation.reopened': {
    conversation: Conversation
    actorId:      string
  }

  'message.received': {
    message:      Message
    // Subset para evitar carregar conversa completa desnecessariamente
    conversation: Pick<Conversation, 'id' | 'organization_id' | 'inbox_id' | 'assigned_user_id'>
  }

  'message.sent': {
    message:      Message
    conversation: Pick<Conversation, 'id' | 'organization_id' | 'inbox_id'>
    actorId:      string
  }

  // Delivery status update recebido do provider (sent → delivered → read)
  'message.status_updated': {
    messageId:   string
    status:      MessageStatus
    externalId:  string
    provider:    string
  }
}

export type CAEventName    = keyof CAEventMap
export type CAEventPayload<K extends CAEventName> = CAEventMap[K]
