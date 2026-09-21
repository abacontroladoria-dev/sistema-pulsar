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
  // `toUserId: null` devolve a conversa à fila — é o "Não atribuído" do painel
  // de detalhamento. O status volta para 'open' junto: 'assigned' sem ninguém
  // atribuído é um estado contraditório, e a triagem passaria a mostrar como
  // "em atendimento" uma conversa que não tem quem a atenda. É a mesma dupla de
  // writes que `setAiMode` faz ao religar a Maia.
  async assign(conversationId: string, toUserId: string | null, actorId: string): Promise<void> {
    const conv            = await this.requireActive(conversationId)
    const previousAssignee= conv.assigned_user_id
    const status          = toUserId === null ? 'open' : 'assigned'

    await this.conv.updateAssignee(conversationId, toUserId)
    await this.conv.updateStatus(conversationId, status)

    const updated: Conversation = {
      ...conv,
      assigned_user_id: toUserId,
      status,
    }

    // Atribuir e devolver à fila são eventos distintos: quem escuta reage de
    // formas opostas a cada um, e um `assigned` com destinatário nulo obrigaria
    // todo ouvinte a testar isso por conta própria.
    if (toUserId === null) {
      void this.audit.insert({
        organization_id: conv.organization_id,
        conversation_id: conversationId,
        event_type:      'conversation.unassigned',
        performed_by:    actorId,
        payload:         { previousAssignee },
      })

      this.events.emit('conversation.unassigned', {
        conversation: updated,
        previousAssignee,
        actorId,
      })
      return
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
  // assumirAoResponder
  //
  // Quem responde, assume. Chamado pelo MessageService depois de a mensagem sair
  // de fato — responder é o ato de assumir o atendimento, e exigir um clique a
  // mais para declarar o óbvio faria a fila mentir toda vez que alguém
  // esquecesse.
  //
  // Antes disto, `assigned_user_id` nunca era escrito por nada no sistema: a
  // caixa "Humano" da triagem era inalcançável e conversas atendidas por gente
  // ficavam indistinguíveis das largadas, empilhadas em "Ninguém" — que é a fila
  // de alarme. O banco sabia quem tinha respondido (`messages.sent_by_user_id`)
  // e não registrava essa pessoa como responsável.
  //
  // Os três writes andam juntos de propósito:
  //   assigned_user_id  quem atende agora
  //   status            'assigned' — a conversa saiu da fila de entrada
  //   ai_mode 'off'     a Maia sai desta conversa. Sem isto os dois respondem o
  //                     mesmo paciente, cada um sem saber do outro.
  //
  // Devolve `true` se assumiu. Não lança: quem chama já mandou a mensagem para o
  // WhatsApp, e falhar aqui não pode desfazer o que o paciente já recebeu.
  // -------------------------------------------------------------------------
  async assumirAoResponder(conversa: Conversation, userId: string): Promise<boolean> {
    // Não rouba conversa de quem já a tem. Se outra pessoa assumiu, responder
    // não troca o dono — transferir é ação explícita (ver `transfer`).
    if (conversa.assigned_user_id !== null) return false

    try {
      await this.conv.updateAssignee(conversa.id, userId)
      await this.conv.updateStatus(conversa.id, 'assigned')

      // Só escreve se ainda não estiver desligada, para não sobrescrever à toa.
      if (conversa.ai_mode !== 'off') {
        await this.conv.updateAiMode(conversa.id, 'off')
      }
    } catch (erro) {
      // A mensagem já saiu. Registrar e seguir é melhor que estourar um envio
      // bem-sucedido; o pior caso é a conversa seguir em "Ninguém", visível na
      // triagem, e não uma resposta entregue que a interface reporta como falha.
      console.error('[ConversationService] Falha ao assumir a conversa ao responder', {
        conversationId: conversa.id,
        userId,
        erro: erro instanceof Error ? erro.message : String(erro),
      })
      return false
    }

    void this.audit.insert({
      organization_id: conversa.organization_id,
      conversation_id: conversa.id,
      event_type:      'conversation.assigned',
      performed_by:    userId,
      payload:         { toUserId: userId, previousAssignee: null, motivo: 'respondeu' },
    })

    this.events.emit('conversation.assigned', {
      conversation:     { ...conversa, assigned_user_id: userId, status: 'assigned', ai_mode: 'off' },
      toUserId:         userId,
      previousAssignee: null,
      actorId:          userId,
    })

    return true
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
  //
  // `actorId` aceita null desde que a própria IA passou a escalar por decisão
  // (não só por falha): events.types.ts já documentava que "performed_by ausente
  // = foi a própria IA escalando", mas a assinatura exigia string e era o único
  // ponto que não tinha acompanhado a convenção. Null em vez de um uuid sintético
  // de "usuário IA": um usuário falso apareceria em todo join de operadores e em
  // toda lista de quem mexeu na conversa.
  // -------------------------------------------------------------------------
  async setAiMode(conversationId: string, aiMode: AIMode | null, actorId: string | null): Promise<void> {
    const conv      = await this.getById(conversationId)
    const anterior  = conv.ai_mode

    await this.conv.updateAiMode(conversationId, aiMode)

    // Religar a Maia SOLTA a conversa: quem devolve o atendimento à IA está
    // dizendo "não sou mais eu que conduzo". Sem isto ela ficaria em "Humano"
    // com a Maia respondendo — o pior dos dois mundos, porque a fila mostraria
    // um responsável que não está mais lá.
    //
    // O status volta para 'open' junto: 'assigned' sem `assigned_user_id` é um
    // estado contraditório. A triagem não se importa (STATUS_ATIVOS tem os dois,
    // ver caixas.ts), mas o dado ficaria mentindo para qualquer outro leitor.
    //
    // Só ao virar 'autonomous'. Passar para 'off' ou null é o humano continuando
    // no comando — mexer no responsável ali tiraria a conversa de quem a atende.
    const soltou = aiMode === 'autonomous' && conv.assigned_user_id !== null
    if (soltou) {
      await this.conv.updateAssignee(conversationId, null)
      await this.conv.updateStatus(conversationId, 'open')
    }

    void this.audit.insert({
      organization_id: conv.organization_id,
      conversation_id: conversationId,
      event_type:      'conversation.ai_mode_changed',
      // `?? undefined` e não `?? null`: o campo é opcional no AuditEntry e o
      // repositório é quem normaliza para null na coluna. Passar null direto
      // não tipa.
      performed_by:    actorId ?? undefined,
      payload:         {
        de: anterior, para: aiMode,
        // Quem era o responsável antes de a conversa voltar para a Maia. Sem
        // isto, a trilha perde o fim do atendimento humano.
        ...(soltou ? { responsavelLiberado: conv.assigned_user_id } : {}),
      },
    })
  }

  // -------------------------------------------------------------------------
  // escalarParaAtendimentoHumano
  //
  // "Esta conversa passa a ser de gente." É a operação inteira, com nome: a Maia
  // sai (`ai_mode = 'off'`), a conversa sobe na fila (`priority = 'high'`) e o
  // motivo fica na trilha.
  //
  // POR QUE UM MÉTODO, E NÃO DOIS UPDATES NO CHAMADOR
  //
  // Esta escrita já existia como UPDATE cru dentro do worker (`escalarParaHumano`),
  // e por viver lá ela não gerava evento nenhum — a convenção de
  // events.types.ts:34 ("performed_by ausente = foi a própria IA escalando") estava
  // documentada e nunca tinha sido ligada. Com a ferramenta `escalar_para_humano`
  // haveria um SEGUNDO lugar reimplementando as mesmas duas colunas. Um nome só,
  // um caminho só.
  //
  // `origem` separa as duas razões de escalar, que se parecem no banco e não se
  // parecem em nada na vida: 'ferramenta_agente' é a Maia fazendo a coisa certa a
  // pedido do responsável; 'falha_tecnica' é a Maia quebrando (loop, timeout,
  // filtro). Sem esse campo, medir "quantas vezes o atendimento automático não deu
  // conta" exigiria adivinhar pelo motivo.
  //
  // O QUE ESTE MÉTODO NÃO FAZ, DE PROPÓSITO
  //
  //   • Não toca em `assigned_user_id`. A caixa "Ninguém" da triagem é exatamente
  //     `ai_mode 'off'` + assignee NULL (ver caixas.ts): atribuir aqui esconderia a
  //     conversa da fila que existe para ela. E se JÁ houver um responsável, ele
  //     está atendendo — sobrescrever seria tirar a conversa de quem está nela.
  //   • Não rebaixa `priority`. Só escreve 'high' quando o que está lá é menor.
  //   • Não mexe em `status`. Escalar não resolve nem arquiva.
  //
  // IDEMPOTENTE: conversa já em 'off' não é reescrita e não gera segundo evento.
  // O retorno diz qual dos dois casos ocorreu, porque quem chama precisa saber se
  // a escalada é NOVA (a ferramenta usa isso para não repetir o aviso ao
  // responsável).
  // -------------------------------------------------------------------------
  async escalarParaAtendimentoHumano(
    conversationId: string,
    motivoEscalada: string,
    origem: 'ferramenta_agente' | 'falha_tecnica',
  ): Promise<{ jaEstavaEscalada: boolean }> {
    const conv = await this.getById(conversationId)

    // 'off' é a marca de "a Maia foi tirada desta conversa". Já estando lá, não há
    // o que escalar — reescrever só produziria um evento de 'off' para 'off' na
    // timeline de quem for investigar depois.
    const jaEstavaEscalada = conv.ai_mode === 'off'

    if (!jaEstavaEscalada) {
      await this.conv.updateAiMode(conversationId, 'off')
    }

    // 'urgent' é o único valor acima de 'high' (20260701000500). Nada no sistema
    // o grava hoje, mas escrever 'high' por cima dele seria rebaixar uma conversa
    // que alguém marcou como mais grave — e um rebaixamento silencioso é o tipo de
    // perda que ninguém liga a esta linha depois.
    if (conv.priority !== 'high' && conv.priority !== 'urgent') {
      await this.conv.updatePriority(conversationId, 'high')
    }

    // Só o que muda de fato vira evento.
    if (!jaEstavaEscalada) {
      void this.audit.insert({
        organization_id: conv.organization_id,
        conversation_id: conversationId,
        // performed_by ausente: quem escalou foi a IA, não um operador. É a
        // convenção que events.types.ts:34 descreve.
        event_type:      'conversation.ai_mode_changed',
        payload:         { de: conv.ai_mode, para: 'off', motivoEscalada, origem },
      })
    }

    return { jaEstavaEscalada }
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
  // marcarComoLida / marcarComoNaoLida
  //
  // As duas escrevem a MESMA coluna, e essa simetria é o ponto: não existe
  // contador para zerar nem badge para acender, só uma marca d'água que anda
  // para frente ou para trás.
  //
  // Nenhuma das duas passa por `requireActive`. Ler uma conversa arquivada é
  // legítimo — o operador abre o histórico para consultar —, e recusar a
  // marcação ali faria a conversa resolvida voltar a cobrar atenção para
  // sempre. Marcar leitura não é ação de ciclo de vida.
  //
  // Sem evento no barramento: nada no domínio reage a alguém ter lido. Emitir
  // um evento por abertura de conversa seria ruído a 5s de poll.
  // -------------------------------------------------------------------------

  // Chamada ao abrir a conversa. `now()` do servidor, não do cliente: o relógio
  // do navegador adiantado marcaria como lidas mensagens que ainda vão chegar.
  //
  // Sem auditoria: abrir conversa é o gesto mais comum da tela, e uma linha de
  // auditoria por abertura afogaria a trilha que existe para investigar quem
  // mexeu em quê.
  async marcarComoLida(conversationId: string): Promise<void> {
    const conv = await this.conv.findById(conversationId)
    if (!conv) throw new ConversationNotFoundError(conversationId)

    await this.conv.updateLastReadAt(conversationId, new Date().toISOString())
  }

  // Recua a marca para ANTES da última mensagem do contato, de modo que o
  // não-lido passe a ser exatamente 1.
  //
  // Quando não há penúltima (a conversa tem uma única mensagem do contato, ou
  // nenhuma), a marca vai para `null` — "nunca lida". É o mesmo resultado
  // prático e não exige inventar uma data.
  //
  // Esta SIM é auditada: é uma decisão deliberada do operador ("isto precisa de
  // retorno"), e é o tipo de coisa que se quer poder reconstituir quando a
  // pergunta for "por que ninguém respondeu a essa pessoa".
  async marcarComoNaoLida(conversationId: string, actorId: string): Promise<void> {
    const conv = await this.conv.findById(conversationId)
    if (!conv) throw new ConversationNotFoundError(conversationId)

    const marca = await this.conv.penultimaEntradaEm(conversationId)
    await this.conv.updateLastReadAt(conversationId, marca)

    void this.audit.insert({
      organization_id: conv.organization_id,
      conversation_id: conversationId,
      event_type:      'conversation.marked_unread',
      performed_by:    actorId,
      payload:         { lastReadAt: marca, anterior: conv.last_read_at },
    })
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
