import 'server-only'

import {
  resolverConfiguracaoOpenAI,
  resolverChaveOpenAI,
  MAX_TOKENS_SAIDA_PADRAO,
  TEMPERATURA_PADRAO,
  MODELO_TRANSCRICAO,
  IDIOMA_TRANSCRICAO,
} from './modelo'
import {
  LlmRateLimitError,
  LlmTimeoutError,
  LlmRecusadoError,
  LlmProviderError,
  LlmBudgetExceededError,
} from './erros'
import type {
  LLMProvider,
  LlmRequisicao,
  LlmResposta,
  LlmMensagem,
  LlmChamadaFerramenta,
  LlmMotivoParada,
  TranscricaoProvider,
  TranscricaoRequisicao,
  TranscricaoResposta,
} from './tipos'

// ============================================================================
// OpenAIProvider — a única coisa neste repositório que fala com a OpenAI
//
// POR QUE fetch E NÃO O SDK `openai`
//
// O pacote não está instalado, e a superfície que usamos são DOIS endpoints:
// POST /v1/chat/completions e /v1/audio/transcriptions. O SDK entregaria streaming (que não usamos — a
// resposta vai para uma fila, não para uma tela) e retry automático (que não
// queremos: `erros.ts` define reações DIFERENTES por classe de falha, e um
// retry cego apagaria essa distinção — retentar um LlmRecusadoError reproduz o
// mesmo erro e cobra de novo).
//
// Há um ganho lateral. `tipos.ts` estabelece a regra de fronteira: nenhum tipo
// do SDK pode vazar para a interface, e o teste é `grep -rn "from 'openai'"`
// retornando exatamente um arquivo. Sem o SDK, o grep retorna ZERO — a regra
// deixa de depender de vigilância.
//
// O preço é este arquivo: os tipos do wire ficam declarados aqui embaixo, à
// mão. É um preço pequeno e localizado, e é o mesmo que `voz/elevenlabs.ts`
// paga pelo mesmo motivo.
// ============================================================================

const BASE_URL = 'https://api.openai.com/v1'

// 60s. Uma volta com tool calling é tipicamente 2-8s; 60 é folga para o dia
// ruim da OpenAI sem prender o worker, que tem orçamento próprio de 25s por
// tique e conta com o lease da fila para o que não couber.
const TIMEOUT_MS = 60_000

// Recorte da resposta HTTP. Declarado por extenso porque é contrato de rede, e
// contrato de rede quebra em silêncio: `escolha.message` ausente vira
// `undefined.content` e o erro aparece longe daqui. Ver `interpretar()`.
interface RespostaBrutaOpenAI {
  model?: string
  choices?: {
    finish_reason?: string
    message?: {
      content?: string | null
      tool_calls?: {
        id?: string
        function?: { name?: string; arguments?: string }
      }[]
    }
  }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
  }
}

// ----------------------------------------------------------------------------
// Tradução: vocabulário do módulo → vocabulário do wire
//
// A união de `LlmMensagem` é discriminada por `papel` justamente para que este
// switch seja exaustivo. O `satisfies never` no default é o que faz o
// TypeScript reclamar em tempo de compilação se um papel novo for acrescentado
// em tipos.ts e esquecido aqui — falha fechada, e não uma mensagem
// silenciosamente descartada no meio de um turno.
// ----------------------------------------------------------------------------
function paraWire(m: LlmMensagem): Record<string, unknown> {
  switch (m.papel) {
    case 'system':
      return { role: 'system', content: m.conteudo }

    case 'user':
      return { role: 'user', content: m.conteudo }

    case 'tool':
      // `tool_call_id` é o que amarra o resultado à chamada. Sem ele a API
      // rejeita o turno inteiro, e o erro chega longe da origem.
      return { role: 'tool', tool_call_id: m.chamadaId, content: m.conteudo }

    case 'assistant':
      return {
        role: 'assistant',
        content: m.conteudo,
        // `tool_calls: []` não é o mesmo que ausente para a API — omitimos
        // a chave quando não há chamadas.
        ...(m.chamadas?.length
          ? {
              tool_calls: m.chamadas.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.nome, arguments: c.argumentosJson },
              })),
            }
          : {}),
      }

    default: {
      const jamais: never = m
      throw new LlmProviderError(
        `papel de mensagem não suportado: ${JSON.stringify(jamais)}`,
      )
    }
  }
}

// `finish_reason` desconhecido vira 'other' em vez de lançar: um motivo novo no
// catálogo da OpenAI não deve derrubar um turno cuja resposta já veio.
function paraMotivoParada(bruto: string | undefined): LlmMotivoParada {
  switch (bruto) {
    case 'stop':
    case 'tool_calls':
    case 'length':
    case 'content_filter':
      return bruto
    default:
      return 'other'
  }
}

// ----------------------------------------------------------------------------
// Extração da mensagem de erro
//
// A OpenAI devolve `{"error":{"message":"...","code":"..."}}`, mas nem sempre:
// um 502 de borda vem como HTML. Por isso a tentativa de JSON é otimista e o
// recorte de 300 caracteres é o fallback — mesma forma de `elevenlabs.ts`.
// ----------------------------------------------------------------------------
// Distingue saldo esgotado de throttling dentro do mesmo 429. A checagem é
// pelo `type`/`code` do corpo, NUNCA pelo status — que é idêntico nos dois
// casos. Os dois identificadores são verificados porque a OpenAI já usou
// ambos e o `type` é o mais estável dos dois.
function ehSaldoEsgotado(corpo: string): boolean {
  try {
    const json = JSON.parse(corpo) as { error?: { type?: string; code?: string } }
    const tipo = json.error?.type ?? ''
    const codigo = json.error?.code ?? ''
    return tipo === 'insufficient_quota'
      || codigo === 'insufficient_quota'
      || codigo === 'credit_balance_exhausted'
  } catch {
    return false
  }
}

function extrairErro(corpo: string): string {
  try {
    const json = JSON.parse(corpo) as { error?: { message?: string; code?: string } }
    const msg = json.error?.message
    if (msg) {
      return json.error?.code ? `${msg} (${json.error.code})` : msg
    }
  } catch {
    // corpo não é JSON — cai no recorte
  }
  return corpo.slice(0, 300)
}

// ----------------------------------------------------------------------------
// Transcrição: o nome do arquivo é o que decide o formato
//
// /audio/transcriptions olha a EXTENSÃO do arquivo enviado, não o Content-Type.
// O áudio do WhatsApp é ogg/opus e chega como 'audio/ogg; codecs=opus'. AMR
// (gravador de celular antigo) não está na lista da OpenAI — lança aqui, antes
// de pagar uma ida que seria recusada.
// ----------------------------------------------------------------------------
const EXTENSAO_TRANSCRICAO: Record<string, string> = {
  'audio/ogg':  'ogg',
  'audio/opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3':  'mp3',
  'audio/mp4':  'm4a',
  'audio/m4a':  'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac':  'm4a',
  'audio/wav':  'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
  'video/mp4':  'mp4',
}

// 25 MB é o teto do endpoint. O WhatsApp limita áudio a 16 MB, então isto só
// pega arquivo que não deveria ter chegado aqui.
const TETO_TRANSCRICAO_BYTES = 25 * 1024 * 1024

export function nomeArquivoTranscricao(mimeType: string): string {
  const limpo = mimeType.split(';')[0].trim().toLowerCase()
  const ext = EXTENSAO_TRANSCRICAO[limpo]
  if (!ext) {
    throw new LlmRecusadoError(415, `formato de áudio não suportado para transcrição: ${limpo || 'desconhecido'}`)
  }
  return `audio.${ext}`
}

interface RespostaBrutaTranscricao {
  text?: string
}

// ----------------------------------------------------------------------------

export class OpenAIProvider implements LLMProvider, TranscricaoProvider {
  readonly nome = 'openai'

  async chat(requisicao: LlmRequisicao): Promise<LlmResposta> {
    // Lança LlmConfiguracaoError se faltar env. Deliberado: quem chama trata
    // isso como falha de instalação, não retenta, e escala.
    const { chaveApi, modelo } = resolverConfiguracaoOpenAI()

    const iniciadoEm = Date.now()

    const corpo = {
      model: modelo,
      messages: requisicao.mensagens.map(paraWire),
      // DEFINICOES_FERRAMENTAS já nasce no formato do wire (ver o comentário
      // de STRICT MODE em agente/ferramentas.ts) — passa sem conversão.
      ...(requisicao.ferramentas?.length
        ? {
            tools: requisicao.ferramentas,
            tool_choice: requisicao.escolhaFerramenta
              ? { type: 'function', function: { name: requisicao.escolhaFerramenta } }
              : 'auto',
          }
        : {}),
      max_tokens: requisicao.maxTokensSaida ?? MAX_TOKENS_SAIDA_PADRAO,
      temperature: requisicao.temperatura ?? TEMPERATURA_PADRAO,
    }

    const resposta = await this.despachar('/chat/completions', JSON.stringify(corpo), chaveApi)
    return this.interpretar(resposta, iniciadoEm)
  }

  // POST /audio/transcriptions. Mesma classificação de erro do chat — 429 de
  // saldo esgotado aqui também não é throttling.
  async transcrever(requisicao: TranscricaoRequisicao): Promise<TranscricaoResposta> {
    const chaveApi = resolverChaveOpenAI()
    const nome = nomeArquivoTranscricao(requisicao.mimeType)

    if (requisicao.bytes.byteLength === 0) {
      throw new LlmRecusadoError(400, 'arquivo de áudio vazio')
    }
    if (requisicao.bytes.byteLength > TETO_TRANSCRICAO_BYTES) {
      throw new LlmRecusadoError(413, `áudio de ${Math.round(requisicao.bytes.byteLength / 1_048_576)} MB passa do teto de 25 MB`)
    }

    const form = new FormData()
    form.append('file', new Blob([requisicao.bytes], { type: requisicao.mimeType.split(';')[0].trim() }), nome)
    form.append('model', MODELO_TRANSCRICAO)
    form.append('language', IDIOMA_TRANSCRICAO)
    form.append('response_format', 'json')

    const iniciadoEm = Date.now()
    const resposta = await this.despachar('/audio/transcriptions', form, chaveApi, requisicao.timeoutMs)

    let json: RespostaBrutaTranscricao
    try {
      json = (await resposta.json()) as RespostaBrutaTranscricao
    } catch {
      throw new LlmProviderError('transcrição 200 com corpo ilegível', resposta.status)
    }
    // Sem `text` é contrato quebrado, não áudio mudo: áudio mudo vem com
    // `text: ""`. Tratar os dois igual gravaria "transcrição vazia" por defeito.
    if (typeof json.text !== 'string') {
      throw new LlmProviderError('transcrição sem o campo text', resposta.status)
    }

    return {
      texto: json.text.trim(),
      // /audio/transcriptions não devolve `model`; o pedido é o que vale.
      modelo: MODELO_TRANSCRICAO,
      latenciaMs: Date.now() - iniciadoEm,
    }
  }

  // Rede. Separado de `interpretar` porque as duas etapas falham por motivos
  // diferentes e a classificação de cada uma é independente.
  //
  // `corpo` string é JSON; FormData é multipart, e aí o Content-Type fica de
  // fora para o fetch montar o boundary.
  private async despachar(
    caminho:   string,
    corpo:     string | FormData,
    chaveApi:  string,
    timeoutMs: number = TIMEOUT_MS,
  ): Promise<Response> {
    let resposta: Response
    try {
      resposta = await fetch(`${BASE_URL}${caminho}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${chaveApi}`,
          ...(typeof corpo === 'string' ? { 'Content-Type': 'application/json' } : {}),
        },
        body: corpo,
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      })
    } catch (err) {
      // AbortSignal.timeout produz TimeoutError; distinguir importa porque
      // timeout e falha de rede pedem reações diferentes do orquestrador.
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new LlmTimeoutError(timeoutMs)
      }
      // status 0 = a requisição não chegou lá. Convenção herdada de
      // elevenlabs.ts, e é uma distinção útil: 0 nunca foi cobrado.
      throw new LlmProviderError(
        err instanceof Error ? err.message : String(err),
        0,
      )
    }

    if (resposta.ok) return resposta

    const texto = await resposta.text()
    const detalhe = extrairErro(texto)

    // 429 NÃO É UMA COISA SÓ, e a diferença decide se retentar faz sentido.
    //
    // A OpenAI devolve 429 para dois fenômenos opostos:
    //   - throttling (`rate_limit_exceeded`): esperar RESOLVE.
    //   - saldo esgotado (`insufficient_quota` / `credit_balance_exhausted`):
    //     esperar NUNCA resolve — só alguém pôr crédito na conta resolve.
    //
    // Classificar os dois como LlmRateLimitError faria a fila devolver o item
    // indefinidamente, sem nunca esgotar tentativas (porque `aguardar` não
    // consome attempts, de propósito) e sem nada avisar. A atendente ficaria
    // muda para sempre, e o log dizendo "limite de taxa, tentando de novo"
    // apontaria o diagnóstico para o lado errado.
    //
    // Medido em 2026-08-31: a conta devolveu 429 com type `insufficient_quota`
    // e code `credit_balance_exhausted`. É a mesma lição que a integração da
    // ElevenLabs já tinha registrado — lá, 400 é chave inválida e 401 é cota.
    if (resposta.status === 429) {
      if (ehSaldoEsgotado(texto)) {
        throw new LlmBudgetExceededError('organizacao', detalhe)
      }
      const retryAfter = resposta.headers.get('retry-after')
      const esperarMs = retryAfter ? Number(retryAfter) * 1000 : null
      throw new LlmRateLimitError(
        Number.isFinite(esperarMs) ? esperarMs : null,
      )
    }

    // 5xx é transitório; 4xx é o pedido estando errado. A fronteira é o que
    // decide entre retentar e escalar.
    if (resposta.status >= 500) {
      throw new LlmProviderError(detalhe, resposta.status)
    }

    throw new LlmRecusadoError(resposta.status, detalhe)
  }

  // Corpo 200 que não tem o formato esperado é falha de provider, não sucesso
  // vazio: devolver `{conteudo:null, chamadas:[]}` faria o orquestrador
  // encerrar o turno em silêncio e o paciente ficaria sem resposta.
  private async interpretar(
    resposta: Response,
    iniciadoEm: number,
  ): Promise<LlmResposta> {
    let json: RespostaBrutaOpenAI
    try {
      json = (await resposta.json()) as RespostaBrutaOpenAI
    } catch {
      throw new LlmProviderError('resposta 200 com corpo ilegível', resposta.status)
    }

    const escolha = json.choices?.[0]
    if (!escolha?.message) {
      throw new LlmProviderError('resposta sem choices[0].message', resposta.status)
    }

    // Chamada sem id ou sem nome é inutilizável: o id amarra o resultado de
    // volta, e sem ele a próxima requisição seria rejeitada inteira. Descartar
    // caladamente esconderia o defeito, então é erro de provider.
    const chamadas: LlmChamadaFerramenta[] = (escolha.message.tool_calls ?? []).map(
      (tc) => {
        if (!tc.id || !tc.function?.name) {
          throw new LlmProviderError(
            `tool_call sem id ou sem nome: ${JSON.stringify(tc).slice(0, 200)}`,
            resposta.status,
          )
        }
        return {
          id: tc.id,
          nome: tc.function.name,
          // Argumentos ficam como STRING CRUA de propósito. Parsear é
          // responsabilidade do orquestrador porque JSON inválido é caso
          // esperado — o modelo erra — e a reação certa é devolver o erro ao
          // modelo, não derrubar o turno aqui.
          argumentosJson: tc.function.arguments ?? '{}',
        }
      },
    )

    return {
      conteudo: escolha.message.content ?? null,
      chamadas,
      uso: {
        // O modelo que RESPONDEU, não o pedido: a OpenAI resolve alias para
        // versão datada, e é a versão que define o preço.
        modelo: json.model ?? 'desconhecido',
        tokensEntrada: json.usage?.prompt_tokens ?? 0,
        tokensSaida: json.usage?.completion_tokens ?? 0,
      },
      motivoParada: paraMotivoParada(escolha.finish_reason),
      latenciaMs: Date.now() - iniciadoEm,
    }
  }
}

// Instância única. O provider não guarda estado entre chamadas — a
// configuração já é memoizada em `modelo.ts` — então não há motivo para
// construir um por requisição.
export const openAiProvider = new OpenAIProvider()
