import 'server-only'

import { ProviderError } from '../types/errors.types'

// ============================================================================
// Cliente HTTP da Evolution API
//
// Um lugar só para URL, chave e timeout, compartilhado pelo EvolutionProvider
// (envio/mídia) e pelas rotas de gestão de números (criar, QR, status).
//
// A chave global fica em ambiente (EVOLUTION_API_KEY), nunca no banco, pela
// mesma decisão de META_WABA_TOKEN: quem lê o Postgres não pode ler a chave que
// controla todos os números.
//
// TIMEOUT CURTO DE PROPÓSITO. A Evolution roda no mesmo servidor que o Pulsar.
// Se ela travar sem cair, uma chamada sem prazo seguraria a requisição da
// atendente — e várias delas seguram o Next inteiro. Falhar em 10s com erro
// claro é o que mantém a tela de pé.
// ============================================================================

const TIMEOUT_MS = 10_000
export const TIMEOUT_MIDIA_MS = 60_000

export function evolutionConfigurada(): boolean {
  return Boolean(process.env.EVOLUTION_API_URL?.trim() && process.env.EVOLUTION_API_KEY?.trim())
}

function config(): { url: string; chave: string } {
  const url = (process.env.EVOLUTION_API_URL ?? '').trim().replace(/\/+$/, '')
  const chave = (process.env.EVOLUTION_API_KEY ?? '').trim()
  if (!url || !chave) {
    throw new ProviderError(
      'evolution',
      new Error('EVOLUTION_API_URL e EVOLUTION_API_KEY precisam estar definidas (variáveis de RUNTIME no Coolify).'),
    )
  }
  return { url, chave }
}

export async function chamarEvolution<T = Record<string, unknown>>(
  metodo: 'GET' | 'POST' | 'PUT' | 'DELETE',
  caminho: string,
  corpo?: unknown,
  timeoutMs: number = TIMEOUT_MS,
): Promise<T> {
  const { url, chave } = config()

  let resposta: Response
  try {
    resposta = await fetch(`${url}${caminho}`, {
      method: metodo,
      headers: {
        apikey: chave,
        ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new ProviderError('evolution', new Error(`a Evolution não respondeu em ${timeoutMs}ms (${caminho.split('/').slice(0, 3).join('/')})`))
    }
    throw new ProviderError('evolution', err)
  }

  const texto = await resposta.text()
  if (!resposta.ok) {
    throw new ProviderError('evolution', new Error(`HTTP ${resposta.status}: ${mensagemDeErro(texto)}`))
  }

  if (!texto) return {} as T
  try {
    return JSON.parse(texto) as T
  } catch {
    throw new ProviderError('evolution', new Error(`resposta ilegível: ${texto.slice(0, 200)}`))
  }
}

// A Evolution devolve `{"status":400,"error":"Bad Request","response":{"message":[...]}}`.
// `response.message` é o que diz o que corrigir.
function mensagemDeErro(corpo: string): string {
  try {
    const json = JSON.parse(corpo) as {
      error?: string
      message?: unknown
      response?: { message?: unknown }
    }
    const detalhe = json.response?.message ?? json.message
    const texto = Array.isArray(detalhe) ? detalhe.map(d => typeof d === 'string' ? d : JSON.stringify(d)).join('; ') : detalhe
    return [json.error, texto].filter(Boolean).join(' — ') || corpo.slice(0, 300)
  } catch {
    return corpo.slice(0, 300)
  }
}
