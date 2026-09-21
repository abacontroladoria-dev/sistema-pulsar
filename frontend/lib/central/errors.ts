import { NextResponse } from 'next/server'
import {
  CentralError,
  UnauthenticatedError,
  UnauthorizedError,
  ConversationNotFoundError,
  ContactNotFoundError,
  ChannelNotFoundError,
  ConversationAlreadyClosedError,
  MissingContactPhoneError,
  ProviderError,
  ProviderNotImplementedError,
  AppointmentNotFoundError,
  SlotNotInGradeError,
  SlotAlreadyBookedError,
  SlotInPastError,
  TtsNotConfiguredError,
  TtsProviderError,
  TagDesconhecidaError,
  TaskNotFoundError,
} from '@/modules/atendimento/types/errors.types'
import { JanelaAtendimentoFechadaError } from '@/modules/atendimento/providers/meta-waba.provider'
import {
  LlmConfiguracaoError,
  LlmRateLimitError,
  LlmTimeoutError,
  LlmBudgetExceededError,
  LlmRecusadoError,
  LlmProviderError,
} from '@/modules/atendimento/llm/erros'
import {
  unauthorized,
  forbidden,
  notFound,
  conflict,
  unprocessable,
  badGateway,
  serviceUnavailable,
  internalError,
} from './response'

// Mapeia erros de domínio para respostas HTTP tipadas.
// Nunca expõe stack traces ao cliente — erros inesperados são logados internamente.
export function mapCentralError(err: unknown): NextResponse {
  if (err instanceof UnauthenticatedError)        return unauthorized(err.message)
  if (err instanceof ConversationNotFoundError)   return notFound(err.code, err.message)
  if (err instanceof ContactNotFoundError)        return notFound(err.code, err.message)
  if (err instanceof ChannelNotFoundError)        return notFound(err.code, err.message)
  if (err instanceof AppointmentNotFoundError)    return notFound(err.code, err.message)
  if (err instanceof TaskNotFoundError)           return notFound(err.code, err.message)
  if (err instanceof ConversationAlreadyClosedError) return conflict(err.code, err.message)
  // 409: a vaga existia e foi tomada — retentar com outro horário resolve.
  if (err instanceof SlotAlreadyBookedError)      return conflict(err.code, err.message)
  // 422: o pedido é bem-formado mas inviável — a vaga não existe na grade
  // ou está no passado. Retentar igual nunca resolve.
  if (err instanceof SlotNotInGradeError)         return unprocessable(err.code, err.message)
  if (err instanceof SlotInPastError)             return unprocessable(err.code, err.message)
  if (err instanceof MissingContactPhoneError)    return unprocessable(err.code, err.message)
  // 422: o array é bem-formado, mas a chave não existe no catálogo da org.
  // Repetir o mesmo corpo nunca passa — a correção é escolher outra tag.
  if (err instanceof TagDesconhecidaError)        return unprocessable(err.code, err.message)
  // 422: a janela de 24h da Meta fechou. Regra da plataforma, não falha nossa —
  // repetir o mesmo texto nunca passa; só template aprovado passa.
  //
  // Precisa de linha própria porque JanelaAtendimentoFechadaError estende Error,
  // não CentralError: sem isto cai no fallback e o operador recebe "Internal
  // server error" quando o que ele precisa saber é que a janela fechou. O worker
  // de envio já tratava esse caso (envio.worker.ts); a rota HTTP não tratava.
  if (err instanceof JanelaAtendimentoFechadaError) return unprocessable(err.code, err.message)
  // 422: falta configuração nossa — nada foi tentado contra a ElevenLabs.
  if (err instanceof TtsNotConfiguredError)       return unprocessable(err.code, err.message)
  // 502: a ElevenLabs respondeu recusando. A mensagem repassada é a dela —
  // é a única que diz se o problema é a chave, a voz ou a cota. O código é
  // separado por causa da ação que cada um pede: trocar credencial, esperar o
  // ciclo da cota, ou nenhuma das duas.
  if (err instanceof TtsProviderError) {
    const code = err.cotaEsgotada   ? 'TTS_QUOTA_EXCEEDED'
               : err.chaveRejeitada ? 'TTS_KEY_REJECTED'
               : err.code
    return badGateway(code, err.message)
  }
  // 502: o provider (Meta) recusou. A mensagem repassada é a DELE — é a única
  // que diz se o problema é token, número ou formato.
  //
  // O log é obrigatório aqui. Sem ele, uma recusa da Meta deixa como único
  // rastro no servidor a linha ` POST /api/central/messages/ 502`, e descobrir
  // o motivo exige refazer a chamada à mão contra a Graph API. Foi exatamente
  // o que aconteceu em 01/09: dois envios falharam e o `code: 190` (token
  // expirado) não estava em lugar nenhum do log.
  if (err instanceof ProviderError) {
    console.error('[Central API] provider recusou', {
      code:    err.code,
      message: err.message,
    })
    return badGateway(err.code, err.message)
  }
  if (err instanceof ProviderNotImplementedError) return serviceUnavailable(err.code, err.message)
  if (err instanceof UnauthorizedError)           return forbidden(err.message)

  // ------------------------------------------------------------------------
  // Camada de LLM
  //
  // Sem estas linhas tudo aqui cai no fallback e vira "Internal server error".
  // Para o worker isso não mudava nada — ele ramifica nas classes, não no HTTP.
  // Para uma rota chamada por gente, muda tudo: falta de crédito, chave errada e
  // instabilidade da OpenAI são três problemas com três donos diferentes, e um
  // 500 genérico manda todos os três para o mesmo lugar (ninguém).
  //
  // A ordem importa: LlmConfiguracaoError e LlmBudgetExceededError são os dois
  // que NUNCA se resolvem sozinhos, e por isso não podem sair como "tente de
  // novo" — alguém precisa mexer no ambiente ou pôr crédito na conta.
  // ------------------------------------------------------------------------

  // 503: falha de instalação. Não é erro do pedido, e repetir não adianta.
  if (err instanceof LlmConfiguracaoError)  return serviceUnavailable(err.code, err.message)
  // 503 também, mas por saldo: esperar nunca resolve — só crédito resolve.
  if (err instanceof LlmBudgetExceededError) return serviceUnavailable(err.code, err.message)
  // 503: throttling. Aqui esperar É a correção, e a UI pode oferecer "tentar
  // de novo" sem mentir.
  if (err instanceof LlmRateLimitError)     return serviceUnavailable(err.code, err.message)
  // 502: a OpenAI demorou ou quebrou. Transitório.
  if (err instanceof LlmTimeoutError)       return badGateway(err.code, err.message)
  if (err instanceof LlmProviderError)      return badGateway(err.code, err.message)
  // 502: a OpenAI recusou o pedido (credencial, modelo inexistente, schema
  // inválido). A mensagem repassada é a dela — é a única que distingue os três.
  if (err instanceof LlmRecusadoError) {
    console.error('[Central API] OpenAI recusou', { code: err.code, message: err.message })
    return badGateway(err.code, err.message)
  }

  if (err instanceof CentralError) {
    console.error('[Central API] CentralError não mapeado', {
      code:    err.code,
      message: err.message,
      context: err.context,
    })
  } else {
    console.error('[Central API] Erro inesperado', err)
  }

  return internalError()
}
