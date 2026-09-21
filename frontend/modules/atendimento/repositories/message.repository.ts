import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Message,
  MessageAttachment,
  MessageDirection,
  MessageStatus,
  ProviderType,
  StorageStatus,
} from '../types/central.types'

// ============================================================================
// MessageRepository
//
// Acesso às tabelas central.messages e central.message_attachments.
//
// Design append-mostly:
//   Conteúdo de mensagem é imutável após criação.
//   Status (pending→sent→delivered→read) é mutável via updateStatus().
//   Deleção é soft-only via softDelete() — deleted_at nunca é null após deleção.
//
// Indexes utilizados (migration 20260701000600):
//   findByExternalId      → uq_messages_ext_id (unique partial index)
//   listByConversation    → idx_messages_conversation_sent
//   updateStatus          → PK lookup
// ============================================================================

export interface CreateMessageInput {
  organization_id:      string
  conversation_id:      string
  external_message_id?: string
  direction:            MessageDirection
  message_type?:        string        // default 'text'
  body?:                string
  provider?:            ProviderType
  sent_by_user_id?:     string
  sent_by_ai?:          boolean
  reply_to_message_id?: string
  status?:              MessageStatus  // default 'pending'
  sent_at?:             string
}

export interface CreateAttachmentInput {
  organization_id: string
  message_id:      string
  file_name?:      string
  file_type?:      string
  file_size?:      number
  external_url?:   string
  storage_path?:   string
  storage_status?: StorageStatus   // default 'pending'
  duration_secs?:  number
}

export interface ListMessagesParams {
  conversationId:   string
  limit?:           number    // default 50
  // Cursor ISO datetime para scroll infinito — carrega mensagens ANTES deste timestamp
  before?:          string
  withAttachments?: boolean   // default true
}

export class MessageRepository {
  // `escrita` existe por causa da RLS de central.messages: a migration
  // 20260701000800 dá a `authenticated` apenas SELECT e INSERT, e documenta
  // "UPDATE: service_role only (delivery status updates by worker)". O desenho
  // supunha que todo envio passaria pelo worker.
  //
  // Enviar pela tela quebra essa suposição: o UPDATE de confirmação sai com o
  // client do usuário, não casa linha nenhuma, e o `.single()` do RETURNING
  // levanta PGRST116 DEPOIS de a mensagem já ter ido para o WhatsApp — o
  // paciente recebe e a tela diz que falhou (visto em 01/09).
  //
  // Quando não é passado, cai no client do usuário e o comportamento é o de
  // antes. Os callers com service role já passam o mesmo client nos dois.
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly escrita:  SupabaseClient = supabase,
  ) {}

  async findById(id: string): Promise<Message | null> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('messages')
      .select('*, attachments:message_attachments(*)')
      .eq('id', id)
      .maybeSingle()

    if (error) throw error
    return data ? this.normalize(data) : null
  }

  // Idempotência de webhooks — retorna null se não existir, nunca lança em miss.
  // Usa o índice único parcial uq_messages_ext_id scoped em (org, provider, external_id).
  async findByExternalId(
    externalId: string,
    orgId:      string,
    provider:   ProviderType
  ): Promise<Message | null> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('messages')
      .select('*')
      .eq('organization_id', orgId)
      .eq('provider', provider)
      .eq('external_message_id', externalId)
      .maybeSingle()

    if (error) throw error
    return (data ?? null) as Message | null
  }

  // Paginação infinita com cursor: carrega as 'limit' mensagens mais recentes
  // anteriores ao timestamp 'before'. Frontend concatena ao state existente.
  async listByConversation(params: ListMessagesParams): Promise<Message[]> {
    const limit           = params.limit           ?? 50
    const withAttachments = params.withAttachments ?? true

    const select = withAttachments
      ? '*, attachments:message_attachments(*)'
      : '*'

    let query = (this.supabase as any)
      .schema('central')
      .from('messages')
      .select(select)
      .eq('conversation_id', params.conversationId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (params.before) {
      query = query.lt('created_at', params.before)
    }

    const { data, error } = await query
    if (error) throw error

    return ((data ?? []) as Record<string, unknown>[]).map(r => this.normalize(r))
  }

  async create(input: CreateMessageInput): Promise<Message> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('messages')
      .insert({
        organization_id:     input.organization_id,
        conversation_id:     input.conversation_id,
        external_message_id: input.external_message_id ?? null,
        direction:           input.direction,
        message_type:        input.message_type ?? 'text',
        body:                input.body ?? null,
        provider:            input.provider ?? null,
        sent_by_user_id:     input.sent_by_user_id ?? null,
        sent_by_ai:          input.sent_by_ai ?? false,
        reply_to_message_id: input.reply_to_message_id ?? null,
        status:              input.status ?? 'pending',
        sent_at:             input.sent_at ?? null,
      })
      .select()
      .single()

    if (error) throw error
    return data as Message
  }

  // Persiste mensagem + attachments atomicamente, via
  // central.criar_mensagem_com_anexos (migration 20260810120400).
  //
  // A versão anterior fazia dois INSERTs sem transação e documentava o estado
  // intermediário como "inconsistente tolerável, worker de storage detecta e
  // retenta". Não é tolerável para áudio de WhatsApp: `body` de mensagem de
  // áudio é vazio, então mensagem sem anexo é indistinguível de mensagem sem
  // conteúdo — o orquestrador não tem o que responder e o responsável conclui
  // que a clínica ignorou o áudio dele. E o worker de storage não existe.
  //
  // A RPC é SECURITY INVOKER: os privilégios de quem chama continuam valendo.
  async createWithAttachments(
    messageInput:     CreateMessageInput,
    attachmentInputs: CreateAttachmentInput[]
  ): Promise<Message> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .rpc('criar_mensagem_com_anexos', {
        p_mensagem: {
          organization_id:     messageInput.organization_id,
          conversation_id:     messageInput.conversation_id,
          external_message_id: messageInput.external_message_id ?? null,
          direction:           messageInput.direction,
          message_type:        messageInput.message_type ?? 'text',
          body:                messageInput.body ?? null,
          provider:            messageInput.provider ?? null,
          sent_by_user_id:     messageInput.sent_by_user_id ?? null,
          sent_by_ai:          messageInput.sent_by_ai ?? false,
          reply_to_message_id: messageInput.reply_to_message_id ?? null,
          status:              messageInput.status ?? 'pending',
          sent_at:             messageInput.sent_at ?? null,
        },
        p_anexos: attachmentInputs.map(a => ({
          // organization_id e message_id NÃO viajam: a função os toma da
          // mensagem que acabou de criar, para anexo não cair em outra org.
          file_name:      a.file_name      ?? null,
          file_type:      a.file_type      ?? null,
          file_size:      a.file_size      ?? null,
          external_url:   a.external_url   ?? null,
          storage_status: a.storage_status ?? 'pending',
          duration_secs:  a.duration_secs  ?? null,
        })),
      })

    if (error) throw error
    return { ...(data as Message), attachments: [] }
  }

  // --------------------------------------------------------------------------
  // Um anexo para uma mensagem QUE JÁ EXISTE.
  //
  // `createWithAttachments` serve ao caminho de ENTRADA, onde mensagem e anexo
  // nascem juntos do mesmo webhook e a atomicidade importa (mensagem de áudio
  // sem anexo é indistinguível de mensagem vazia). A saída é o inverso: o
  // arquivo já está no bucket e o que falta é registrar onde — a mensagem foi
  // criada antes, no passo que registra a intenção de enviar.
  //
  // Não passa pela RPC porque ela não aceita `storage_path`: foi escrita para
  // anexo recém-chegado, que por definição ainda não foi baixado.
  // --------------------------------------------------------------------------
  async criarAnexo(input: CreateAttachmentInput): Promise<MessageAttachment> {
    const { data, error } = await (this.escrita as any)
      .schema('central')
      .from('message_attachments')
      .insert({
        organization_id: input.organization_id,
        message_id:      input.message_id,
        file_name:       input.file_name      ?? null,
        file_type:       input.file_type      ?? null,
        file_size:       input.file_size      ?? null,
        external_url:    input.external_url   ?? null,
        storage_path:    input.storage_path   ?? null,
        storage_status:  input.storage_status ?? 'pending',
        duration_secs:   input.duration_secs  ?? null,
      })
      .select('*')
      .single()

    if (error) throw error
    return data as MessageAttachment
  }

  // Fecha o download de uma mídia RECEBIDA: o arquivo foi para o bucket e o
  // anexo passa a apontar para lá. Limpa `storage_error` de propósito — uma
  // retentativa bem-sucedida não pode deixar para trás a explicação da falha
  // anterior, que passaria a descrever um estado que não existe mais.
  async marcarAnexoArmazenado(
    id: string,
    storagePath: string,
    extras: { file_type?: string; file_size?: number } = {},
  ): Promise<void> {
    const { error } = await (this.escrita as any)
      .schema('central')
      .from('message_attachments')
      .update({
        storage_path:   storagePath,
        storage_status: 'stored',
        storage_error:  null,
        ...(extras.file_type ? { file_type: extras.file_type } : {}),
        ...(extras.file_size ? { file_size: extras.file_size } : {}),
      })
      .eq('id', id)

    if (error) throw error
  }

  // O porquê da falha, em texto. `storage_status` sozinho não distingue mídia
  // expirada na Meta (irrecuperável) de token vencido (retentável depois de
  // corrigir) — e as duas pedem ações opostas de quem for investigar.
  async marcarAnexoFalho(id: string, motivo: string): Promise<void> {
    const { error } = await (this.escrita as any)
      .schema('central')
      .from('message_attachments')
      .update({ storage_status: 'failed', storage_error: motivo.slice(0, 500) })
      .eq('id', id)

    if (error) throw error
  }

  async buscarAnexo(id: string): Promise<MessageAttachment | null> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('message_attachments')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (error) throw error
    return (data ?? null) as MessageAttachment | null
  }

  // Atualiza status de entrega: pending → sent → delivered → read.
  // Disparado por webhooks de status do provider (Evolution: MESSAGE_UPDATE).
  // Supabase Realtime emite o evento de UPDATE automaticamente → UI atualiza tick.
  // Fecha o envio: grava a identidade que o provider devolveu e marca 'sent'.
  //
  // Existe separado de updateStatus porque as duas coisas precisam acontecer no
  // MESMO update. Em dois updates, uma falha entre eles deixaria a mensagem
  // 'sent' sem external_message_id — e sem esse id o webhook de entrega não
  // encontra a mensagem (updateDeliveryStatus busca por ele), então o "entregue"
  // e o "lido" nunca chegariam a esta linha.
  async confirmarEnvio(
    id:         string,
    externalId: string,
    sentAt?:    string,
  ): Promise<Message> {
    // `escrita` e não `supabase`: ver a nota no construtor. É escrituração de
    // sistema sobre uma linha que ACABAMOS de criar — a autorização já foi
    // exercida no INSERT, que passou pela RLS do usuário.
    const { data, error } = await (this.escrita as any)
      .schema('central')
      .from('messages')
      .update({
        external_message_id: externalId,
        status:              'sent',
        sent_at:             sentAt ?? new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data as Message
  }

  // `escrita` pelo mesmo motivo de confirmarEnvio. Aqui o sintoma era ainda
  // mais silencioso: sem RETURNING não há PGRST116, então o UPDATE não casava
  // linha nenhuma e a chamada voltava sem erro. Marcar 'failed' no caminho de
  // falha do envio não marcava nada, e a mensagem ficava 'pending' para sempre.
  async updateStatus(id: string, status: MessageStatus): Promise<void> {
    const { error } = await (this.escrita as any)
      .schema('central')
      .from('messages')
      .update({ status })
      .eq('id', id)

    if (error) throw error
  }

  // Soft delete — WhatsApp permite que o remetente apague mensagens.
  // deleted_at preenchido; conteúdo preservado para auditoria.
  // UI deve exibir "Mensagem apagada" quando deleted_at IS NOT NULL.
  async softDelete(id: string): Promise<void> {
    const { error } = await (this.supabase as any)
      .schema('central')
      .from('messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)

    if (error) throw error
  }

  private normalize(row: Record<string, unknown>): Message {
    const { attachments, ...msg } = row
    return {
      ...msg,
      attachments: Array.isArray(attachments)
        ? (attachments as MessageAttachment[])
        : [],
    } as Message
  }
}
