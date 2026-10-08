import "server-only"

import type {
  AgendaFavorecidoTita,
  AgendamentoTitaPayload,
  DisponibilidadeRequest,
  DisponibilidadeResponse,
  TitaApiResult,
} from "./types"

// Base URL e header confirmados em "Integração - Documentação API TITA.pdf" (seção
// "Configuração de Acesso") e usados de forma consistente em todas as Edge
// Functions do projeto que já integram com o TiTa.
const TITA_BASE_URL = process.env.TITA_API_URL || "https://apiv2.apptita.com.br/api"

function getTitaToken(): string {
  const token = process.env.TITA_TOKEN
  if (!token) throw new Error("Variável de ambiente TITA_TOKEN não configurada")
  return token
}

/**
 * Extrai só a mensagem textual (campo "message") de um corpo de erro do TiTa —
 * nunca repassa error_stack_trace, error_file, error_function ou params, que
 * contêm caminhos internos do servidor deles. Essa é a única parte da resposta
 * de erro que sai de postTita(); o corpo bruto completo só é logado no servidor
 * (console.error), nunca devolvido ao chamador.
 */
function extrairMensagemTita(data: unknown): string | undefined {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const msg = (data as Record<string, unknown>).message
    if (typeof msg === "string") return msg
  }
  return typeof data === "string" ? data : undefined
}

/**
 * Detecta deadlock no MySQL do TiTa (achado real em produção, 2026-08-07: duas
 * chamadas concorrentes de agendamento/create do mesmo bundle, cada uma inserindo
 * em lote em agenda_fav_items, colidiram com "SQLSTATE[40001]: Deadlock found when
 * trying to get lock; try restarting transaction" — a própria TiTa recomenda
 * reexecutar). Só olha message_dev (nunca exposto ao chamador, ver
 * extrairMensagemTita) — é a única forma de diferenciar isso de qualquer outro
 * erro 500 sem chutar pelo texto genérico de `message`.
 */
function isDeadlockTita(data: unknown): boolean {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const dev = (data as Record<string, unknown>).message_dev
    if (typeof dev === "string") return /deadlock found|SQLSTATE\[40001\]/i.test(dev)
  }
  return false
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Ponto único de saída para a API TiTa — instrumentado aqui para que payload
// enviado, resposta recebida e tempo de execução fiquem logados para as duas
// chamadas (get_disponibilidade e agendamento/create) sem duplicar código.
//
// deadlockRetryBackoffsMs: se informado, reexecuta a chamada quando o TiTa
// sinalizar deadlock (ver isDeadlockTita), esperando o backoff indicado entre
// tentativas. Vazio/omitido = nunca reexecuta (comportamento original).
async function postTita<T>(
  path: string,
  body: unknown,
  deadlockRetryBackoffsMs: number[] = [],
): Promise<TitaApiResult<T>> {
  const tentativas = deadlockRetryBackoffsMs.length + 1

  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    const inicio = Date.now()
    console.log(`[tita:client] → POST ${path} (tentativa ${tentativa}/${tentativas})`, JSON.stringify(body))

    const response = await fetch(`${TITA_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-INTEGRACAO-TOKEN": getTitaToken(),
      },
      body: JSON.stringify(body),
    })

    let data: unknown = null
    try { data = await response.json() } catch { /* corpo vazio ou não-JSON */ }

    const duracaoMs = Date.now() - inicio

    if (!response.ok) {
      // Corpo bruto (pode conter stack trace/caminhos internos do TiTa) só vai para
      // o log do servidor — nunca é retornado ao chamador (ver extrairMensagemTita).
      console.error(
        `[tita:client] ← POST ${path} falhou (status ${response.status}, ${duracaoMs}ms, tentativa ${tentativa}/${tentativas})`,
        JSON.stringify(data),
      )

      const podeReexecutar = tentativa < tentativas && isDeadlockTita(data)
      if (podeReexecutar) {
        const backoff = deadlockRetryBackoffsMs[tentativa - 1]
        console.warn(`[tita:client] deadlock detectado em ${path} — reexecutando em ${backoff}ms`)
        await sleep(backoff)
        continue
      }

      return {
        ok: false,
        status: response.status,
        error: extrairMensagemTita(data) ?? `Erro HTTP ${response.status}`,
      }
    }

    console.log(`[tita:client] ← POST ${path} ok (status ${response.status}, ${duracaoMs}ms)`, JSON.stringify(data))
    return { ok: true, status: response.status, data: data as T }
  }

  // Inalcançável (o loop sempre retorna no sucesso ou na última tentativa falha),
  // mas satisfaz o checador de tipos sem recorrer a `as`.
  throw new Error(`[tita:client] postTita ${path} saiu do loop de tentativas sem retornar`)
}

/** POST /integracao/get_disponibilidade — verifica disponibilidade antes de criar o agendamento. */
export function verificarDisponibilidade(payload: DisponibilidadeRequest): Promise<TitaApiResult<DisponibilidadeResponse>> {
  return postTita("/integracao/get_disponibilidade", payload)
}

/**
 * POST /integracao/agendamento/create — cria o agendamento recorrente no TiTa.
 * Reexecuta até 2x (backoff 300ms, 800ms) se o TiTa sinalizar deadlock no MySQL
 * dela (ver isDeadlockTita) — cenário real e transiente, não um erro de dados
 * nosso; ver route.ts para o porquê das chamadas desta fase serem sequenciais.
 */
export function criarAgendamento(payload: AgendamentoTitaPayload): Promise<TitaApiResult<AgendaFavorecidoTita[]>> {
  return postTita("/integracao/agendamento/create", payload, [300, 800])
}

