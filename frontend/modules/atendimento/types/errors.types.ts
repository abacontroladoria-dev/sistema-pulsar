// ============================================================================
// Central de Atendimento — Domain Errors
//
// Hierarquia de erros tipados para a camada de serviços.
// Route Handlers e Server Actions capturam estes erros e mapeiam para
// respostas HTTP ou mensagens de UI — nunca expõem stack traces.
//
// Uso:
//   throw new ConversationNotFoundError(id)
//   catch (err) {
//     if (err instanceof ConversationNotFoundError) → 404
//     if (err instanceof ProviderError)             → 502
//     if (err instanceof UnauthorizedError)         → 403
//   }
// ============================================================================

export class CentralError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message)
    this.name = this.constructor.name
    // Mantém stack trace correto em subclasses no V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }
}

// ----------------------------------------------------------------------------
// Conversation
// ----------------------------------------------------------------------------

export class ConversationNotFoundError extends CentralError {
  constructor(id: string) {
    super(`Conversa ${id} não encontrada`, 'CONVERSATION_NOT_FOUND', { id })
  }
}

// Disparado ao tentar operar em conversa já resolvida ou arquivada.
// reopen() NÃO usa este erro — é idempotente.
export class ConversationAlreadyClosedError extends CentralError {
  constructor(id: string, currentStatus: string) {
    super(
      `Conversa ${id} já está ${currentStatus} e não pode ser modificada`,
      'CONVERSATION_ALREADY_CLOSED',
      { id, currentStatus }
    )
  }
}

// ----------------------------------------------------------------------------
// Message
// ----------------------------------------------------------------------------

// Disparado quando external_message_id já existe no banco (idempotência).
// MessageService.receive() retorna a mensagem existente em vez de lançar.
// Disponível para callers externos que precisam inspecionar a condição.
export class DuplicateMessageError extends CentralError {
  constructor(externalId: string, provider: string) {
    super(
      `Mensagem ${externalId} do provider ${provider} já foi processada`,
      'DUPLICATE_MESSAGE',
      { externalId, provider }
    )
  }
}

// ----------------------------------------------------------------------------
// Contact
// ----------------------------------------------------------------------------

export class ContactNotFoundError extends CentralError {
  constructor(identifier: string) {
    super(`Contato não encontrado: ${identifier}`, 'CONTACT_NOT_FOUND', { identifier })
  }
}

// O anexo não existe, ou é de outra organização. Os dois casos colapsam num
// 404 de propósito: distinguir "não existe" de "não é seu" confirmaria a
// existência de um anexo alheio a quem tentou adivinhar o id.
export class AnexoNaoEncontradoError extends CentralError {
  constructor(anexoId: string) {
    super(`Anexo não encontrado: ${anexoId}`, 'ANEXO_NAO_ENCONTRADO', { anexoId })
  }
}

// O anexo existe mas o arquivo não pôde ser obtido. Separado do 404 porque a
// ação de quem lê é outra: aqui a conversa TEM o arquivo, ele é que não veio —
// e o motivo (mídia expirada na Meta, token vencido) diz se adianta insistir.
export class AnexoIndisponivelError extends CentralError {
  constructor(anexoId: string, motivo: string) {
    super(
      `O arquivo não pôde ser carregado: ${motivo}`,
      'ANEXO_INDISPONIVEL',
      { anexoId, motivo },
    )
  }
}

export class MissingContactPhoneError extends CentralError {
  constructor(contactId: string) {
    super(
      `Contato ${contactId} não possui telefone cadastrado para envio de mensagem`,
      'MISSING_CONTACT_PHONE',
      { contactId }
    )
  }
}

// ----------------------------------------------------------------------------
// Tarefas
// ----------------------------------------------------------------------------

// Vale também para tarefa de OUTRA organização: o service converte o caso
// cross-org neste erro em vez de 403, porque um "403 existe, mas não é sua" já
// confirma a existência de uma tarefa de outra clínica. Mesma escolha de
// ContactService.
export class TaskNotFoundError extends CentralError {
  constructor(id: string) {
    super(`Tarefa ${id} não encontrada`, 'TASK_NOT_FOUND', { id })
  }
}

// ----------------------------------------------------------------------------
// Tags
// ----------------------------------------------------------------------------

// Chave que não está no catálogo ativo da organização (central.tag_definitions).
//
// 422, e não 400: o pedido é bem-formado — é um array de strings, como deve
// ser. O que ele não é, é aplicável, e repetir o mesmo corpo nunca vai passar.
// A mensagem nomeia as chaves recusadas porque é isso que permite descobrir se
// a tag foi desativada ou se o cliente está mandando lixo.
export class TagDesconhecidaError extends CentralError {
  constructor(chaves: string[]) {
    super(
      `Tag fora do catálogo da organização: ${chaves.join(', ')}`,
      'TAG_DESCONHECIDA',
      { chaves },
    )
  }
}

export class TagNaoAplicavelPelaMaiaError extends CentralError {
  constructor(chaves: string[]) {
    super(
      `Tag existe no catálogo mas a Maia não pode aplicá-la (maia_pode_aplicar = false): ${chaves.join(', ')}`,
      'TAG_NAO_APLICAVEL_PELA_MAIA',
      { chaves },
    )
  }
}

// ----------------------------------------------------------------------------
// Agendamento
// ----------------------------------------------------------------------------

export class AppointmentNotFoundError extends CentralError {
  constructor(id: string) {
    super(`Agendamento ${id} não encontrado`, 'APPOINTMENT_NOT_FOUND', { id })
  }
}

// A vaga pedida não existe como 'Livre' na grade do TiTa.
// Distinto de SlotAlreadyBookedError de propósito: aqui o horário nunca foi
// oferecível (o profissional não tem essa vaga), lá ele existia e foi tomado.
// O agente responde ao paciente de formas diferentes nos dois casos.
export class SlotNotInGradeError extends CentralError {
  constructor(profissionalId: number, date: string, time: string) {
    super(
      `Não existe vaga livre na grade para o profissional ${profissionalId} em ${date} às ${time}`,
      'SLOT_NOT_IN_GRADE',
      { profissionalId, date, time }
    )
  }
}

// A vaga existia na grade mas já foi prometida por nós a outra pessoa.
// Também é o erro em que a violação de uq_appointments_slot_ocupada (23505) é
// traduzida — o índice é a garantia real contra corrida entre duas reservas
// simultâneas, e o usuário precisa ver "esse horário acabou de ser preenchido".
export class SlotAlreadyBookedError extends CentralError {
  constructor(profissionalId: number, date: string, time: string) {
    super(
      `A vaga de ${date} às ${time} já está reservada`,
      'SLOT_ALREADY_BOOKED',
      { profissionalId, date, time }
    )
  }
}

export class SlotInPastError extends CentralError {
  constructor(date: string, time: string | null) {
    super(
      `Não é possível agendar em ${date}${time ? ` às ${time}` : ''}: o horário já passou`,
      'SLOT_IN_PAST',
      { date, time }
    )
  }
}

// ----------------------------------------------------------------------------
// Voz (ElevenLabs)
// ----------------------------------------------------------------------------

// Não há chave da ElevenLabs gravada para a organização.
// Separado de TtsProviderError de propósito: aqui nada foi tentado contra a
// ElevenLabs, então não faz sentido a UI sugerir "tente novamente".
export class TtsNotConfiguredError extends CentralError {
  constructor(
    orgId: string,
    motivo = 'Nenhuma chave da ElevenLabs configurada para esta organização'
  ) {
    super(motivo, 'TTS_NOT_CONFIGURED', { orgId })
  }
}

// A ElevenLabs foi chamada e recusou. `statusUpstream` e `mensagemUpstream`
// existem porque a mensagem do provider é a única informação útil aqui: chave
// inválida, voz que não pertence à conta e cota estourada são três problemas
// diferentes que o usuário resolve de três formas diferentes. Genericizar isso
// em "erro ao gerar áudio" é o que fazia a tela antiga ser impossível de
// depurar.
export class TtsProviderError extends CentralError {
  constructor(
    public readonly statusUpstream: number,
    public readonly mensagemUpstream: string,
    // detail.status / detail.code / detail.type da resposta, quando vem.
    public readonly codigoUpstream: string | null = null
  ) {
    super(mensagemUpstream, 'TTS_PROVIDER_ERROR', { statusUpstream, codigoUpstream })
  }

  // Cota esgotada é verificada ANTES de credencial porque a ElevenLabs devolve
  // 401 nesse caso — classificar pelo status faria "acabaram os caracteres"
  // aparecer como "sua chave está errada", e o admin trocaria uma chave que
  // estava correta.
  get cotaEsgotada(): boolean {
    return /quota|limit_reached|exceeded/i.test(this.codigoUpstream ?? '')
  }

  // true quando a própria credencial é o problema — a UI pede outra chave em
  // vez de mandar tentar de novo. Chave inválida chega como HTTP 400 com
  // detail.status = 'invalid_api_key', então o código manda mais que o status.
  get chaveRejeitada(): boolean {
    if (this.cotaEsgotada) return false
    if (/api_key|authentication|unauthorized|permission/i.test(this.codigoUpstream ?? '')) return true
    return this.statusUpstream === 401 || this.statusUpstream === 403
  }
}

// ----------------------------------------------------------------------------
// Channel
// ----------------------------------------------------------------------------

export class ChannelNotFoundError extends CentralError {
  constructor(id: string) {
    super(`Canal ${id} não encontrado`, 'CHANNEL_NOT_FOUND', { id })
  }
}

// ----------------------------------------------------------------------------
// Provider
// ----------------------------------------------------------------------------

// Erro de comunicação com o provider externo (Evolution API, Meta WABA, etc).
// Mensagem NÃO é persistida quando este erro é lançado — o provider não confirmou.
export class ProviderError extends CentralError {
  constructor(
    public readonly provider: string,
    public readonly originalError: unknown,
    public readonly externalRef?: string
  ) {
    const cause =
      originalError instanceof Error
        ? originalError.message
        : String(originalError)
    super(
      `Erro no provider ${provider}: ${cause}`,
      'PROVIDER_ERROR',
      { provider, externalRef, cause }
    )
  }
}

// Lançado pelo ProviderFactory quando o provider ainda não foi implementado.
// Esperado durante Sprint 1 — providers são implementados no Sprint 2.
export class ProviderNotImplementedError extends CentralError {
  constructor(providerType: string) {
    super(
      `Provider ${providerType} ainda não implementado`,
      'PROVIDER_NOT_IMPLEMENTED',
      { providerType }
    )
  }
}

// ----------------------------------------------------------------------------
// Authorization
// ----------------------------------------------------------------------------

// 401 — sem sessão válida ou token expirado.
// Lançado por extractUser() quando não há JWT válido.
export class UnauthenticatedError extends CentralError {
  constructor(reason = 'Sessão inválida ou expirada') {
    super(reason, 'UNAUTHENTICATED')
  }
}

// 403 — usuário autenticado mas sem permissão para a operação.
export class UnauthorizedError extends CentralError {
  constructor(reason: string) {
    super(reason, 'UNAUTHORIZED')
  }
}
