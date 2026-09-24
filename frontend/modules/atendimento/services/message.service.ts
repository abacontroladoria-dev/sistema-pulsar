import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Message,
  Channel,
  ProviderType,
  ProviderResolver,
} from '../types/central.types'
import type { MessageRepository, CreateAttachmentInput, ListMessagesParams } from '../repositories/message.repository'
import type { ConversationRepository } from '../repositories/conversation.repository'
import type { ContactRepository } from '../repositories/contact.repository'
import type { AuditRepository } from '../repositories/audit.repository'
import type { ConversationService } from './conversation.service'
import type { TypedEventBus } from '../events/event-bus'
import {
  ConversationNotFoundError,
  ConversationAlreadyClosedError,
  ContactNotFoundError,
  MissingContactPhoneError,
  ChannelNotFoundError,
  ProviderError,
  AnexoNaoEncontradoError,
  AnexoIndisponivelError,
} from '../types/errors.types'
import {
  AnexoStorageRepository,
  montarPath,
} from '../repositories/anexo-storage.repository'
import { mapProviderStatus } from '../utils/provider-status'
import { isUniqueViolation } from '../utils/pg-errors'

// ============================================================================
// MessageService
//
// Gerencia envio, recebimento e estado de mensagens.
//
// Resolução de provider (ajuste obrigatório):
//   O service resolve o provider internamente a partir do channel_id da conversa.
//   Callers NÃO passam MessagingProvider como parâmetro.
//   Fluxo: conversationId → channel_id → Channel → provider enum → ProviderFactory.get()
//
// Idempotência (receive):
//   Toda mensagem inbound é verificada por external_message_id antes de persistir.
//   Webhook duplicado retorna a mensagem existente sem INSERT adicional.
//
// Webhook de status (updateDeliveryStatus):
//   Evolution e Meta WABA enviam atualizações de entrega separadas do conteúdo.
//   MessageService atualiza o status no banco → Supabase Realtime propaga → UI atualiza.
// ============================================================================

const CLOSED_STATUSES = ['resolved', 'archived'] as const

export interface SendMessageInput {
  conversationId:     string
  body:               string
  messageType?:       string     // default 'text'
  sentByUserId?:      string
  sentByAi?:          boolean
  // UUID local já resolvido pelo caller — não o external_message_id do provider
  replyToMessageId?:  string
}

export interface EnviarMidiaInput {
  conversationId: string
  // Os bytes já em memória. A rota é quem lê o multipart e valida o tamanho —
  // o service recebe o arquivo pronto e não conhece HTTP.
  bytes:          ArrayBuffer
  mimeType:       string
  fileName:       string
  // 'image' | 'audio' | 'video' | 'document', já derivado do MIME pela rota.
  messageType:    string
  // O texto que o operador digitou junto. Vira legenda na Meta (exceto em
  // áudio, que a Meta não aceita legendar) e `body` na nossa mensagem.
  caption?:       string
  sentByUserId?:  string
}

export interface ReceiveMessageInput {
  conversationId:     string
  orgId:              string
  externalMessageId:  string
  messageType:        string
  body?:              string
  provider:           ProviderType
  sentAt?:            string
  // External ID da mensagem citada — service resolve para UUID local
  replyToExternalId?: string
  attachments?: {
    externalUrl:  string
    fileType?:    string
    fileName?:    string
    fileSize?:    number
    durationSecs?:number
  }[]
}

export interface UpdateDeliveryStatusInput {
  externalMessageId: string
  orgId:             string
  provider:          ProviderType
  status:            string
}

export class MessageService {
  constructor(
    private readonly msg:     MessageRepository,
    private readonly conv:    ConversationRepository,
    private readonly contact: ContactRepository,
    private readonly audit:   AuditRepository,
    private readonly events:  TypedEventBus,
    private readonly factory: ProviderResolver,
    // Necessário para resolveChannel() — ChannelRepository é Sprint 2
    private readonly supabase:SupabaseClient,
    // Para assumir a conversa quando um humano responde (ver o passo 7 de send).
    // A dependência é de mão única — mensagem conhece conversa, nunca o inverso —
    // então não há ciclo. Opcional para não quebrar composições em teste que
    // instanciam MessageService sozinho; sem ele, o envio só deixa de assumir.
    private readonly conversas?: ConversationService,
    // O bucket dos anexos. Opcional pela mesma razão de `conversas`: composições
    // de teste que só exercitam texto não precisam dele. Sem ele, os caminhos de
    // mídia lançam dizendo o que falta, em vez de falharem com
    // "cannot read property of undefined".
    private readonly anexos?: AnexoStorageRepository,
  ) {}

  private get storage(): AnexoStorageRepository {
    if (!this.anexos) {
      throw new Error(
        'MessageService foi construído sem AnexoStorageRepository — '
        + 'use createMessageService, que o injeta.',
      )
    }
    return this.anexos
  }

  // -------------------------------------------------------------------------
  // send
  // Envia mensagem outbound via provider.
  //
  // Ordem: PERSISTE, envia, atualiza o status.
  //
  // A versão anterior fazia o inverso — chamava o provider e só persistia depois,
  // "para nunca salvar mensagem não enviada". Para registro clínico a troca está
  // no sentido errado: se o INSERT falhar depois de a Meta aceitar, a mensagem
  // existe no WhatsApp do responsável e NÃO existe no histórico da clínica.
  // Ninguém descobre, porque não sobra rastro de nada.
  //
  // Invertida, o pior caso passa a ser uma linha `status = 'failed'` visível na
  // conversa — que é honesta e acionável. Não é coincidência que
  // central.messages.status já tenha default 'pending': o schema sempre assumiu
  // esta ordem, era o código que divergia.
  // -------------------------------------------------------------------------
  async send(input: SendMessageInput): Promise<Message> {
    // 1. Validar conversa ativa
    const conversation = await this.conv.findById(input.conversationId)
    if (!conversation) throw new ConversationNotFoundError(input.conversationId)
    if (CLOSED_STATUSES.includes(conversation.status as typeof CLOSED_STATUSES[number])) {
      throw new ConversationAlreadyClosedError(input.conversationId, conversation.status)
    }

    // 2. Resolver canal, contato e provider internamente
    const channel = await this.resolveChannel(conversation.channel_id)
    const contact = await this.contact.findById(conversation.contact_id)

    if (!contact) throw new ContactNotFoundError(conversation.contact_id)
    if (!contact.display_phone) throw new MissingContactPhoneError(conversation.contact_id)

    const provider = this.factory.get(channel.provider)

    // 3. Registrar a intenção ANTES de existir rede no caminho.
    // Sem external_message_id ainda — ele só existe depois do aceite do provider.
    const pendente = await this.msg.create({
      organization_id:     conversation.organization_id,
      conversation_id:     input.conversationId,
      direction:           'outbound',
      message_type:        input.messageType ?? 'text',
      body:                input.body,
      provider:            channel.provider,
      sent_by_user_id:     input.sentByUserId,
      sent_by_ai:          input.sentByAi         ?? false,
      reply_to_message_id: input.replyToMessageId ?? undefined,
      status:              'pending',
    })

    // 4. Enviar
    let result
    try {
      result = await provider.sendMessage(channel, {
        to:          contact.display_phone,  // validado acima — nunca null
        body:        input.body,
        messageType: input.messageType ?? 'text',
        replyToId:   undefined,  // reply de outbound não mapeado no provider ainda
      })
    } catch (err) {
      // A mensagem fica registrada como falha em vez de desaparecer. O erro
      // continua subindo: quem chamou precisa saber que não foi entregue.
      await this.msg.updateStatus(pendente.id, 'failed').catch(erroStatus => {
        console.error('[MessageService] Falha ao marcar mensagem como failed', {
          messageId: pendente.id,
          conversationId: input.conversationId,
          erroStatus: erroStatus instanceof Error ? erroStatus.message : String(erroStatus),
        })
      })
      throw new ProviderError(channel.provider, err)
    }

    // 5. Confirmar com a identidade que o provider devolveu.
    // Se ESTE update falhar, a mensagem existe como 'pending' com o corpo certo —
    // recuperável por reconciliação, ao contrário de não existir.
    const message = await this.msg.confirmarEnvio(
      pendente.id,
      result.externalId,
      result.sentAt,
    )

    // 6. Side effects
    void this.audit.insert({
      organization_id: conversation.organization_id,
      conversation_id: input.conversationId,
      event_type:      'message.sent',
      performed_by:    input.sentByUserId,
      payload:         { messageId: message.id, provider: channel.provider },
    })

    this.events.emit('message.sent', {
      message,
      conversation: {
        id:              conversation.id,
        organization_id: conversation.organization_id,
        inbox_id:        conversation.inbox_id,
      },
      actorId: input.sentByUserId ?? 'system',
    })

    // 7. Quem responde, assume.
    //
    // Depois do envio confirmado, e não antes: assumir uma conversa cuja
    // mensagem a Meta vai recusar deixaria a fila apontando um responsável que
    // nunca falou com o paciente.
    //
    // As duas condições são a proteção do sinal. `sentByAi` é a que mais importa:
    // o worker da Maia também envia outbound, e sem esse recorte TODA conversa
    // atendida pela IA migraria para a caixa "Humano" — o inverso exato do
    // defeito que isto corrige. `sentByUserId` ausente é envio de sistema, que
    // não tem a quem atribuir.
    if (input.sentByUserId && input.sentByAi !== true && this.conversas) {
      await this.conversas.assumirAoResponder(conversation, input.sentByUserId)
    }

    return message
  }

  // -------------------------------------------------------------------------
  // enviarMidia
  //
  // Mesma coreografia do `send` — persiste, envia, confirma — e pelo mesmo
  // motivo: se a Meta aceitar e o registro falhar, o arquivo existe no WhatsApp
  // do responsável e não existe no histórico da clínica, sem rastro de nada.
  //
  // A ORDEM DOS QUATRO PASSOS
  //
  // 1. mensagem 'pending'  — para existir a quem culpar se o resto falhar
  // 2. bucket              — nossa cópia, que é o que a bolha vai exibir
  // 3. upload à Meta       — vira media ID
  // 4. envio               — consome o media ID
  //
  // O bucket vem ANTES da Meta de propósito. Invertido, um upload aceito pela
  // Meta seguido de falha no bucket entregaria ao responsável um arquivo que a
  // clínica não tem — e é exatamente o caso em que alguém vai precisar rever o
  // que foi mandado.
  //
  // O anexo só é registrado depois do envio confirmado, com o media ID em
  // `external_url`: assim uma linha de anexo nunca aponta para algo que não
  // chegou ao destinatário.
  // -------------------------------------------------------------------------
  async enviarMidia(input: EnviarMidiaInput): Promise<Message> {
    const conversation = await this.conv.findById(input.conversationId)
    if (!conversation) throw new ConversationNotFoundError(input.conversationId)
    if (CLOSED_STATUSES.includes(conversation.status as typeof CLOSED_STATUSES[number])) {
      throw new ConversationAlreadyClosedError(input.conversationId, conversation.status)
    }

    const channel = await this.resolveChannel(conversation.channel_id)
    const contact = await this.contact.findById(conversation.contact_id)
    if (!contact) throw new ContactNotFoundError(conversation.contact_id)
    if (!contact.display_phone) throw new MissingContactPhoneError(conversation.contact_id)

    const provider = this.factory.get(channel.provider)

    // 1. A intenção, antes de qualquer rede.
    //
    // `body` guarda a LEGENDA, não um placeholder. O adapter já sabe esconder
    // o corpo quando ele é só o marcador — e aqui não há marcador a escrever:
    // o chip do anexo diz o que é.
    const pendente = await this.msg.create({
      organization_id:     conversation.organization_id,
      conversation_id:     input.conversationId,
      direction:           'outbound',
      message_type:        input.messageType,
      body:                input.caption,
      provider:            channel.provider,
      sent_by_user_id:     input.sentByUserId,
      sent_by_ai:          false,
      status:              'pending',
    })

    // A partir daqui toda falha marca a mensagem e repropaga: mensagem some da
    // tela é pior que mensagem visivelmente falha.
    const falhar = async (err: unknown): Promise<never> => {
      await this.msg.updateStatus(pendente.id, 'failed').catch(erroStatus => {
        console.error('[MessageService] falha ao marcar mídia como failed', {
          messageId: pendente.id,
          erroStatus: erroStatus instanceof Error ? erroStatus.message : String(erroStatus),
        })
      })
      throw err instanceof ProviderError ? err : new ProviderError(channel.provider, err)
    }

    // 2. Nossa cópia primeiro.
    const path = montarPath(
      conversation.organization_id,
      input.conversationId,
      pendente.id,
      input.mimeType,
    )
    try {
      await this.storage.salvar(path, input.bytes, input.mimeType)
    } catch (err) {
      return falhar(err)
    }

    // 3 e 4. Meta: bytes viram media ID, media ID vira mensagem entregue.
    // Evolution: sem upload separado, os bytes vão no próprio envio.
    let result
    try {
      const arquivo = {
        bytes:    input.bytes,
        mimeType: input.mimeType,
        fileName: input.fileName,
      }
      const mediaId = provider.exigeUploadPrevio === false
        ? undefined
        : (await provider.uploadMedia(channel, arquivo)).externalId
      result = await provider.sendMedia(channel, {
        to:          contact.display_phone,
        messageType: input.messageType,
        mediaId,
        caption:     input.caption,
        fileName:    input.fileName,
        arquivo,
      })
      // O media ID fica no anexo: vale 30 dias na Meta e é o que permite
      // reenviar o mesmo arquivo sem subir de novo. Na Evolution fica o id da
      // mensagem, que é o que existe.
      await this.msg.criarAnexo({
        organization_id: conversation.organization_id,
        message_id:      pendente.id,
        file_name:       input.fileName,
        file_type:       input.mimeType,
        file_size:       input.bytes.byteLength,
        external_url:    mediaId ?? result.externalId,
        storage_path:    path,
        // 'stored' porque o arquivo JÁ está no nosso bucket — foi de lá que ele
        // saiu. Mídia de saída nunca passa por 'pending'.
        storage_status:  'stored',
      })
    } catch (err) {
      return falhar(err)
    }

    const message = await this.msg.confirmarEnvio(pendente.id, result.externalId, result.sentAt)

    void this.audit.insert({
      organization_id: conversation.organization_id,
      conversation_id: input.conversationId,
      event_type:      'message.sent',
      performed_by:    input.sentByUserId,
      payload:         {
        messageId: message.id,
        provider:  channel.provider,
        midia:     { tipo: input.messageType, bytes: input.bytes.byteLength },
      },
    })

    this.events.emit('message.sent', {
      message,
      conversation: {
        id:              conversation.id,
        organization_id: conversation.organization_id,
        inbox_id:        conversation.inbox_id,
      },
      actorId: input.sentByUserId ?? 'system',
    })

    // Quem responde, assume — mandar um arquivo é responder.
    if (input.sentByUserId && this.conversas) {
      await this.conversas.assumirAoResponder(conversation, input.sentByUserId)
    }

    return message
  }

  // -------------------------------------------------------------------------
  // urlDoAnexo
  //
  // O endereço temporário que a bolha consome. Duas responsabilidades, e as
  // duas precisam estar aqui e não na rota:
  //
  //  • CONFERIR A ORGANIZAÇÃO. A RLS do bucket já isola por org, mas depender
  //    só dela faria um anexo de outra organização virar um erro de storage
  //    ilegível em vez de um 404 honesto.
  //  • BAIXAR SOB DEMANDA. Um anexo 'pending' é mídia recebida que ninguém
  //    trouxe da Meta ainda. Em vez de mostrar "indisponível" e esperar um
  //    worker, busca na hora: quem abriu a conversa está olhando para ela.
  // -------------------------------------------------------------------------
  async urlDoAnexo(anexoId: string, orgId: string): Promise<string> {
    const anexo = await this.msg.buscarAnexo(anexoId)
    if (!anexo || anexo.organization_id !== orgId) {
      throw new AnexoNaoEncontradoError(anexoId)
    }

    if (anexo.storage_status === 'stored' && anexo.storage_path) {
      return this.storage.urlAssinada(anexo.storage_path)
    }

    // Não está no bucket. `external_url` guarda o media ID da Meta — que vale
    // 7 dias para mídia recebida, contra os 5 MINUTOS da URL que a Graph
    // devolve. É por isso que o webhook guarda o id e não a URL.
    if (!anexo.external_url) {
      throw new AnexoIndisponivelError(anexoId, 'o anexo não tem identificador de mídia')
    }

    const mensagem = await this.msg.findById(anexo.message_id)
    if (!mensagem) throw new AnexoNaoEncontradoError(anexoId)

    const conversation = await this.conv.findById(mensagem.conversation_id)
    if (!conversation) throw new AnexoNaoEncontradoError(anexoId)

    const channel  = await this.resolveChannel(conversation.channel_id)
    const provider = this.factory.get(channel.provider)

    let baixado
    try {
      baixado = await provider.baixarMedia(channel, anexo.external_url)
    } catch (err) {
      // O motivo fica gravado: mídia expirada na Meta é irrecuperável e não
      // adianta a pessoa clicar de novo; token vencido conserta-se e a próxima
      // tentativa funciona. Sem isto, os dois são "não carregou".
      const motivo = err instanceof Error ? err.message : String(err)
      await this.msg.marcarAnexoFalho(anexo.id, motivo).catch(() => {})
      throw new AnexoIndisponivelError(anexoId, motivo)
    }

    const path = montarPath(
      orgId,
      conversation.id,
      mensagem.id,
      baixado.mimeType,
    )
    await this.storage.salvar(path, baixado.bytes, baixado.mimeType)
    // O file_type da Graph é mais confiável que o que o webhook capturou, e o
    // tamanho só se conhece depois de baixar.
    await this.msg.marcarAnexoArmazenado(anexo.id, path, {
      file_type: baixado.mimeType,
      file_size: baixado.fileSize,
    })

    return this.storage.urlAssinada(path)
  }

  // -------------------------------------------------------------------------
  // receive
  // Persiste mensagem inbound recebida via webhook.
  //
  // Idempotente em duas camadas, e a segunda é a que vale:
  //   1. Consulta prévia por external_message_id — resolve a reentrega comum,
  //      que chega segundos ou minutos depois.
  //   2. Captura de 23505 no INSERT — resolve a reentrega SIMULTÂNEA, em que as
  //      duas requisições passam pela consulta antes de qualquer uma inserir.
  //      Aqui quem garante é uq_messages_ext_id.
  //
  // Sem a camada 2, a segunda entrega estoura e a rota responde 500 — e 5xx é
  // justamente o que faz a Meta reentregar. O laço se alimenta do próprio erro.
  // -------------------------------------------------------------------------
  async receive(input: ReceiveMessageInput): Promise<Message> {
    // 1. Checar idempotência — webhook pode ser entregue mais de uma vez
    const existing = await this.msg.findByExternalId(
      input.externalMessageId,
      input.orgId,
      input.provider
    )
    if (existing) return existing

    // 2. Resolver reply: external ID → UUID local (best-effort, não bloqueia)
    let replyToMessageId: string | undefined
    if (input.replyToExternalId) {
      const replyMsg = await this.msg.findByExternalId(
        input.replyToExternalId,
        input.orgId,
        input.provider
      )
      replyToMessageId = replyMsg?.id
    }

    // 3. Construir lista de attachments para INSERT sequencial
    const attachmentInputs: CreateAttachmentInput[] = (input.attachments ?? []).map(a => ({
      organization_id: input.orgId,
      message_id:      '',         // preenchido dentro de createWithAttachments
      file_name:       a.fileName    ?? undefined,
      file_type:       a.fileType    ?? undefined,
      file_size:       a.fileSize    ?? undefined,
      external_url:    a.externalUrl,
      storage_status:  'pending'  as const,
      duration_secs:   a.durationSecs ?? undefined,
    }))

    // 4. Persistir mensagem (+ attachments se houver), atomicamente.
    // Trigger DB atualiza conversation.last_message_at automaticamente após INSERT
    let message: Message
    try {
      message = await this.msg.createWithAttachments(
        {
          organization_id:     input.orgId,
          conversation_id:     input.conversationId,
          external_message_id: input.externalMessageId,
          direction:           'inbound',
          message_type:        input.messageType,
          body:                input.body,
          provider:            input.provider,
          // Mensagem inbound não tem sent_by_user_id nem sent_by_ai
          status:              'delivered',   // inbound já chegou entregue
          sent_at:             input.sentAt,
          reply_to_message_id: replyToMessageId,
        },
        attachmentInputs
      )
    } catch (err) {
      // Entrega simultânea: o outro processo inseriu entre a consulta e este
      // INSERT. Buscar de novo e devolver a que venceu — o webhook responde 200
      // e a Meta para de reentregar.
      if (isUniqueViolation(err)) {
        const jaGravada = await this.msg.findByExternalId(
          input.externalMessageId,
          input.orgId,
          input.provider
        )
        if (jaGravada) return jaGravada
      }
      throw err
    }

    // 5. Side effects — não bloqueiam o retorno
    void this.audit.insert({
      organization_id: input.orgId,
      conversation_id: input.conversationId,
      event_type:      'message.received',
      performed_by:    undefined,
      payload:         {
        messageId:        message.id,
        externalMessageId:input.externalMessageId,
        provider:         input.provider,
        messageType:      input.messageType,
        hasAttachments:   (input.attachments?.length ?? 0) > 0,
      },
    })

    this.events.emit('message.received', {
      message,
      conversation: {
        id:              input.conversationId,
        organization_id: input.orgId,
        // inbox_id e assigned_user_id não disponíveis sem query adicional
        // Listeners que precisam desses campos devem buscá-los via ConversationRepository
        inbox_id:        '',
        assigned_user_id:null,
      },
    })

    return message
  }

  // -------------------------------------------------------------------------
  // updateDeliveryStatus
  // Atualiza o status de entrega de uma mensagem outbound.
  // Disparado por webhooks de status do provider (Evolution: MESSAGE_UPDATE).
  // Supabase Realtime propaga o UPDATE → UI atualiza tick de leitura em < 1s.
  // -------------------------------------------------------------------------
  async updateDeliveryStatus(input: UpdateDeliveryStatusInput): Promise<void> {
    const message = await this.msg.findByExternalId(
      input.externalMessageId,
      input.orgId,
      input.provider
    )

    if (!message) {
      // Mensagem ainda não processada — race condition improvável mas tratável.
      // Provider pode entregar status update antes do conteúdo em cenários de retry.
      console.warn('[MessageService] Status update para mensagem não encontrada', {
        externalMessageId: input.externalMessageId,
        provider:          input.provider,
        status:            input.status,
      })
      return
    }

    const mappedStatus = mapProviderStatus(input.status, input.provider)
    await this.msg.updateStatus(message.id, mappedStatus)

    this.events.emit('message.status_updated', {
      messageId:  message.id,
      status:     mappedStatus,
      externalId: input.externalMessageId,
      provider:   input.provider,
    })
  }

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------
  async list(params: ListMessagesParams): Promise<Message[]> {
    return this.msg.listByConversation(params)
  }

  // -------------------------------------------------------------------------
  // softDelete
  // Mensagem apagada pelo contato via WhatsApp.
  // Idempotente: se a mensagem não existir (já deletada), retorna sem erro.
  // -------------------------------------------------------------------------
  async softDelete(messageId: string, actorId: string): Promise<void> {
    const message = await this.msg.findById(messageId)
    if (!message) return

    await this.msg.softDelete(messageId)

    void this.audit.insert({
      organization_id: message.organization_id,
      conversation_id: message.conversation_id,
      event_type:      'message.deleted',
      performed_by:    actorId,
      payload:         { messageId },
    })

    this.events.emit('message.status_updated', {
      messageId,
      status:     'deleted',
      externalId: message.external_message_id ?? '',
      provider:   message.provider             ?? '',
    })
  }

  // -------------------------------------------------------------------------
  // resolveChannel (privado)
  // Busca o canal da conversa para extrair o provider.
  // ChannelRepository será implementado no Sprint 2 — por ora query direta.
  // -------------------------------------------------------------------------
  private async resolveChannel(channelId: string): Promise<Channel> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('channels')
      .select('id, organization_id, inbox_id, name, provider, channel_type, status, active, created_at, updated_at')
      .eq('id', channelId)
      .single()

    if (error || !data) throw new ChannelNotFoundError(channelId)
    return data as Channel
  }
}
