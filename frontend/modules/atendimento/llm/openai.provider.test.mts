// Verifica o OpenAIProvider contra o wire da OpenAI, com `fetch` trocado por um
// dublê. Não gasta token, não precisa de chave real, não toca banco:
//
//   npx tsx --conditions react-server modules/atendimento/llm/openai.provider.test.mts
//
// A flag `--conditions react-server` NÃO é decorativa. O provider importa
// 'server-only', cujo `index.js` LANÇA por design — é um marcador que existe
// para quebrar quando alguém o importa de um Client Component. O pacote resolve
// para um `empty.js` inofensivo sob a condição de exportação `react-server`, que
// é exatamente a que o Next usa ao montar o bundle do servidor. Sem a flag, o
// teste morre no import com uma mensagem que fala de Client Component e não tem
// nada a ver com o que se está testando.
//
// O que se prova aqui, e por que cada item merece teste:
//
//   1. TRADUÇÃO DE IDA — os 4 papéis de LlmMensagem viram o shape que a API
//      aceita. `tool` sem `tool_call_id` faz a API rejeitar o TURNO INTEIRO, e o
//      sintoma chega como "a atendente não respondeu".
//
//   2. TRADUÇÃO DE VOLTA — tool_calls, uso e finish_reason. `argumentosJson`
//      precisa chegar como STRING CRUA: se este provider parsear, o orquestrador
//      perde a chance de devolver "JSON inválido" ao modelo.
//
//   3. CLASSIFICAÇÃO DE ERRO — cada classe de erro pede uma reação diferente
//      (erros.ts). Se 429 virar LlmProviderError, o worker deixa de esperar e
//      passa a escalar; se 401 virar retentável, o sistema queima tentativas
//      contra uma credencial que não vai melhorar.
//
//   4. CORPO 200 MALFORMADO — não pode virar "sucesso vazio". Turno encerrado em
//      silêncio é paciente sem resposta.
//
// Sem framework, como os outros testes do módulo: sai com 1 na primeira falha.

import { OpenAIProvider } from './openai.provider.js'
import { __limparCacheConfiguracao } from './modelo.js'
import {
  LlmRateLimitError,
  LlmTimeoutError,
  LlmRecusadoError,
  LlmProviderError,
  LlmConfiguracaoError,
  LlmBudgetExceededError,
} from './erros.js'
import type { LlmMensagem, LlmFerramenta } from './tipos.js'

let falhas = 0
function checar(condicao: boolean, descricao: string, extra?: unknown) {
  if (condicao) {
    console.log(`  ok   ${descricao}`)
  } else {
    falhas++
    console.error(`  FALHA ${descricao}`)
    if (extra !== undefined) console.error('        ', extra)
  }
}

async function capturar(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn()
    return null
  } catch (err) {
    return err
  }
}

// ----------------------------------------------------------------------------
// Dublê de fetch. Guarda o que foi enviado para as asserções de ida.
// ----------------------------------------------------------------------------
const fetchOriginal = globalThis.fetch
// O tipo é anotado explicitamente e lido por `corpoEnviado()`: sem isso o
// TypeScript estreita a variável para `never` a partir do `= null` inicial,
// porque só enxerga a atribuição feita dentro do dublê de fetch.
let ultimoCorpoEnviado: Record<string, unknown> | null = null

function corpoEnviado(): Record<string, unknown> {
  if (!ultimoCorpoEnviado) throw new Error('nenhuma requisição foi capturada')
  return ultimoCorpoEnviado
}

function fingirResposta(
  status: number,
  corpo: unknown,
  headers: Record<string, string> = {},
) {
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    ultimoCorpoEnviado = JSON.parse(String(init?.body)) as Record<string, unknown>
    const texto = typeof corpo === 'string' ? corpo : JSON.stringify(corpo)
    return new Response(texto, {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    })
  }) as typeof globalThis.fetch
}

function fingirFalhaDeRede(erro: Error) {
  globalThis.fetch = (async () => {
    throw erro
  }) as typeof globalThis.fetch
}

// Config válida para todos os casos, menos o que testa a ausência dela.
process.env.OPENAI_API_KEY = 'sk-teste-nao-real'
process.env.OPENAI_MODEL = 'gpt-4o-mini'
__limparCacheConfiguracao()

const provider = new OpenAIProvider()

const RESPOSTA_SIMPLES = {
  model: 'gpt-4o-mini-2024-07-18',
  choices: [{ finish_reason: 'stop', message: { content: 'Bom dia!' } }],
  usage: { prompt_tokens: 120, completion_tokens: 8 },
}

// ----------------------------------------------------------------------------
console.log('\n1. tradução de ida: os 4 papéis viram o shape do wire')

const mensagens: LlmMensagem[] = [
  { papel: 'system', conteudo: 'Você é a atendente.' },
  { papel: 'user', conteudo: 'quero agendar' },
  {
    papel: 'assistant',
    conteudo: null,
    chamadas: [{ id: 'call_1', nome: 'consultar_horarios_disponiveis', argumentosJson: '{"terapiaId":3}' }],
  },
  { papel: 'tool', chamadaId: 'call_1', nome: 'consultar_horarios_disponiveis', conteudo: '{"ok":true}' },
]

fingirResposta(200, RESPOSTA_SIMPLES)
await provider.chat({ mensagens })

const enviadas = (corpoEnviado().messages ?? []) as Record<string, unknown>[]

checar(enviadas.length === 4, 'as 4 mensagens foram enviadas', enviadas.length)
checar(enviadas[0]?.role === 'system', 'system → role:system')
checar(enviadas[1]?.role === 'user', 'user → role:user')

const assistente = enviadas[2] as { role?: string; content?: unknown; tool_calls?: unknown[] }
checar(assistente.role === 'assistant', 'assistant → role:assistant')
checar(assistente.content === null, 'assistant com conteudo null preserva o null')
checar(Array.isArray(assistente.tool_calls) && assistente.tool_calls.length === 1,
  'assistant carrega tool_calls')
const tc = (assistente.tool_calls?.[0] ?? {}) as { id?: string; type?: string; function?: { name?: string; arguments?: string } }
checar(tc.id === 'call_1', 'tool_call preserva o id')
checar(tc.type === 'function', 'tool_call declara type:function')
checar(tc.function?.arguments === '{"terapiaId":3}',
  'argumentos vão como string, não como objeto', tc.function?.arguments)

const ferramenta = enviadas[3] as { role?: string; tool_call_id?: string; content?: string }
checar(ferramenta.role === 'tool', 'tool → role:tool')
checar(ferramenta.tool_call_id === 'call_1',
  'tool_call_id amarra o resultado à chamada (sem ele a API rejeita o turno)')

// ----------------------------------------------------------------------------
console.log('\n2. assistant sem chamadas OMITE tool_calls')

fingirResposta(200, RESPOSTA_SIMPLES)
await provider.chat({ mensagens: [{ papel: 'assistant', conteudo: 'oi' }] })
const soTexto = ((corpoEnviado().messages ?? []) as Record<string, unknown>[])[0]
checar(!('tool_calls' in (soTexto ?? {})),
  'a chave tool_calls não aparece (array vazio ≠ ausente para a API)',
  Object.keys(soTexto ?? {}))

// ----------------------------------------------------------------------------
console.log('\n3. tetos e ferramentas')

fingirResposta(200, RESPOSTA_SIMPLES)
await provider.chat({ mensagens: [{ papel: 'user', conteudo: 'oi' }] })
checar(corpoEnviado().max_tokens === 700, 'aplica MAX_TOKENS_SAIDA_PADRAO', corpoEnviado().max_tokens)
checar(corpoEnviado().temperature === 0.3, 'aplica TEMPERATURA_PADRAO', corpoEnviado().temperature)
checar(!('tools' in corpoEnviado()),
  'sem ferramentas, a chave tools é omitida (é o interruptor de ai_scheduling_enabled)')

const umaFerramenta: LlmFerramenta = {
  type: 'function',
  function: { name: 'x', description: 'y', parameters: { type: 'object' }, strict: true },
}
fingirResposta(200, RESPOSTA_SIMPLES)
await provider.chat({ mensagens: [{ papel: 'user', conteudo: 'oi' }], ferramentas: [umaFerramenta], maxTokensSaida: 50, temperatura: 0 })
checar(corpoEnviado().tool_choice === 'auto', 'com ferramentas, tool_choice é auto')
checar(corpoEnviado().max_tokens === 50, 'teto explícito vence o padrão')
checar(corpoEnviado().temperature === 0, 'temperatura 0 explícita não cai no padrão (0 é falsy)')

// ----------------------------------------------------------------------------
console.log('\n4. tradução de volta')

fingirResposta(200, {
  model: 'gpt-4o-mini-2024-07-18',
  choices: [{
    finish_reason: 'tool_calls',
    message: {
      content: null,
      tool_calls: [{ id: 'call_9', function: { name: 'agendar_sessao', arguments: '{"data":"2026-09-01"}' } }],
    },
  }],
  usage: { prompt_tokens: 300, completion_tokens: 25 },
})
const comChamada = await provider.chat({ mensagens: [{ papel: 'user', conteudo: 'oi' }] })

checar(comChamada.motivoParada === 'tool_calls', 'finish_reason tool_calls é preservado')
checar(comChamada.chamadas.length === 1, 'uma chamada extraída')
checar(comChamada.chamadas[0]?.nome === 'agendar_sessao', 'nome da ferramenta')
checar(comChamada.chamadas[0]?.argumentosJson === '{"data":"2026-09-01"}',
  'argumentosJson volta como STRING crua (parsear é do orquestrador)')
checar(comChamada.uso.modelo === 'gpt-4o-mini-2024-07-18',
  'uso.modelo é a versão que RESPONDEU, não o alias pedido — é ela que define o preço')
checar(comChamada.uso.tokensEntrada === 300 && comChamada.uso.tokensSaida === 25, 'tokens')
checar(typeof comChamada.latenciaMs === 'number' && comChamada.latenciaMs >= 0, 'latenciaMs preenchida')

fingirResposta(200, { model: 'm', choices: [{ finish_reason: 'inventado_pela_openai', message: { content: 'x' } }], usage: {} })
const motivoNovo = await provider.chat({ mensagens: [{ papel: 'user', conteudo: 'oi' }] })
checar(motivoNovo.motivoParada === 'other',
  'finish_reason desconhecido vira "other" em vez de derrubar um turno já respondido')

fingirResposta(200, { model: 'm', choices: [{ finish_reason: 'stop', message: { content: 'x' } }] })
const semUso = await provider.chat({ mensagens: [{ papel: 'user', conteudo: 'oi' }] })
checar(semUso.uso.tokensEntrada === 0 && semUso.uso.tokensSaida === 0, 'usage ausente não quebra (zera)')

// ----------------------------------------------------------------------------
console.log('\n5. classificação de erro — cada classe pede reação diferente')

fingirResposta(429, { error: { message: 'rate limit' } }, { 'retry-after': '12' })
const e429 = await capturar(() => provider.chat({ mensagens: [{ papel: 'user', conteudo: 'oi' }] }))
checar(e429 instanceof LlmRateLimitError, '429 → LlmRateLimitError (esperar É a reação certa)', e429)
checar((e429 as LlmRateLimitError)?.esperarMs === 12_000, 'retry-after em segundos vira ms', (e429 as LlmRateLimitError)?.esperarMs)

fingirResposta(429, { error: { message: 'rate limit' } })
const e429sem = await capturar(() => provider.chat({ mensagens: [{ papel: 'user', conteudo: 'oi' }] }))
checar((e429sem as LlmRateLimitError)?.esperarMs === null, '429 sem retry-after → esperarMs null')

// O MESMO 429 com significado oposto. Medido em produção 2026-08-31: a conta
// sem crédito devolve 429, e tratá-lo como throttling faria a fila retentar
// para sempre — `aguardar` não consome tentativa, de propósito.
fingirResposta(429, {
  error: {
    message: 'You exceeded your current quota',
    type: 'insufficient_quota',
    code: 'credit_balance_exhausted',
  },
})
const eSaldo = await capturar(() => provider.chat({ mensagens: [{ papel: 'user', conteudo: 'oi' }] }))
checar(eSaldo instanceof LlmBudgetExceededError,
  '429 com insufficient_quota → LlmBudgetExceededError (esperar NUNCA resolve; só crédito na conta)', eSaldo)
checar(!(eSaldo instanceof LlmRateLimitError),
  'saldo esgotado NÃO é rate limit — classificá-lo assim faria a fila girar em silêncio para sempre')

fingirResposta(401, { error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } })
const e401 = await capturar(() => provider.chat({ mensagens: [{ papel: 'user', conteudo: 'oi' }] }))
checar(e401 instanceof LlmRecusadoError, '401 → LlmRecusadoError (NÃO retentável)', e401)
checar(String((e401 as Error).message).includes('invalid_api_key'),
  'o code da OpenAI entra na mensagem — é o que diz ao admin o que corrigir')

fingirResposta(400, { error: { message: 'schema inválido' } })
const e400 = await capturar(() => provider.chat({ mensagens: [{ papel: 'user', conteudo: 'oi' }] }))
checar(e400 instanceof LlmRecusadoError, '400 → LlmRecusadoError')

fingirResposta(503, '<html>Bad Gateway</html>')
const e503 = await capturar(() => provider.chat({ mensagens: [{ papel: 'user', conteudo: 'oi' }] }))
checar(e503 instanceof LlmProviderError, '5xx → LlmProviderError (retentável com teto baixo)', e503)
checar((e503 as LlmProviderError)?.status === 503, 'status preservado')
checar(String((e503 as Error).message).includes('html'), 'corpo não-JSON é recortado, não descartado')

fingirFalhaDeRede(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))
const eTimeout = await capturar(() => provider.chat({ mensagens: [{ papel: 'user', conteudo: 'oi' }] }))
checar(eTimeout instanceof LlmTimeoutError, 'TimeoutError → LlmTimeoutError (uma retentativa, depois escala)', eTimeout)

fingirFalhaDeRede(new Error('ECONNREFUSED'))
const eRede = await capturar(() => provider.chat({ mensagens: [{ papel: 'user', conteudo: 'oi' }] }))
checar(eRede instanceof LlmProviderError, 'falha de rede → LlmProviderError', eRede)
checar((eRede as LlmProviderError)?.status === 0,
  'status 0 = não chegou lá (portanto não foi cobrado)')

// ----------------------------------------------------------------------------
console.log('\n6. corpo 200 malformado NÃO vira sucesso vazio')

fingirResposta(200, { model: 'm', choices: [] })
const semChoices = await capturar(() => provider.chat({ mensagens: [{ papel: 'user', conteudo: 'oi' }] }))
checar(semChoices instanceof LlmProviderError,
  'choices vazio lança em vez de devolver resposta vazia (turno mudo = paciente sem resposta)', semChoices)

fingirResposta(200, 'isto não é json')
const ilegivel = await capturar(() => provider.chat({ mensagens: [{ papel: 'user', conteudo: 'oi' }] }))
checar(ilegivel instanceof LlmProviderError, '200 com corpo ilegível lança', ilegivel)

fingirResposta(200, {
  model: 'm',
  choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ function: { name: 'x', arguments: '{}' } }] } }],
})
const semId = await capturar(() => provider.chat({ mensagens: [{ papel: 'user', conteudo: 'oi' }] }))
checar(semId instanceof LlmProviderError,
  'tool_call sem id lança — descartar caladamente faria a próxima requisição ser rejeitada inteira', semId)

// ----------------------------------------------------------------------------
console.log('\n7. configuração ausente lança antes de tocar a rede')

const chaveSalva = process.env.OPENAI_API_KEY
delete process.env.OPENAI_API_KEY
__limparCacheConfiguracao()
let tocouRede = false
globalThis.fetch = (async () => { tocouRede = true; return new Response('{}') }) as typeof globalThis.fetch

const eConfig = await capturar(() => provider.chat({ mensagens: [{ papel: 'user', conteudo: 'oi' }] }))
checar(eConfig instanceof LlmConfiguracaoError, 'sem OPENAI_API_KEY → LlmConfiguracaoError', eConfig)
checar(!tocouRede, 'não gastou requisição para descobrir que falta env')

process.env.OPENAI_API_KEY = chaveSalva
__limparCacheConfiguracao()
globalThis.fetch = fetchOriginal

// ----------------------------------------------------------------------------
console.log('\n8. transcrição: multipart, nome de arquivo pela extensão, erros')

let urlChamada = ''
let formEnviado: FormData | null = null
function fingirTranscricao(status: number, corpo: unknown) {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    urlChamada = url
    formEnviado = init?.body as FormData
    const texto = typeof corpo === 'string' ? corpo : JSON.stringify(corpo)
    return new Response(texto, { status, headers: { 'Content-Type': 'application/json' } })
  }) as typeof globalThis.fetch
}

const bytesAudio = new Uint8Array([1, 2, 3, 4]).buffer

fingirTranscricao(200, { text: '  Boa tarde, quero remarcar.  ' })
const tr = await provider.transcrever({ bytes: bytesAudio, mimeType: 'audio/ogg; codecs=opus' })
checar(urlChamada.endsWith('/audio/transcriptions'), 'bate em /audio/transcriptions', urlChamada)
checar(tr.texto === 'Boa tarde, quero remarcar.', 'texto vem aparado', tr.texto)
const form = formEnviado as FormData | null
const arquivo = form?.get('file') as File | null
checar(arquivo?.name === 'audio.ogg', 'ogg com codecs vira audio.ogg', arquivo?.name)
checar(form?.get('model') === 'gpt-4o-mini-transcribe', 'modelo de transcrição, não o OPENAI_MODEL')
checar(form?.get('language') === 'pt', 'idioma fixo em português')

fingirTranscricao(200, { text: '' })
checar((await provider.transcrever({ bytes: bytesAudio, mimeType: 'audio/mpeg' })).texto === '',
  'áudio sem fala devolve string vazia, não erro')

fingirTranscricao(200, { outra: 'coisa' })
checar(await capturar(() => provider.transcrever({ bytes: bytesAudio, mimeType: 'audio/ogg' })) instanceof LlmProviderError,
  '200 sem `text` é contrato quebrado, não silêncio')

let tocou = false
globalThis.fetch = (async () => { tocou = true; return new Response('{}') }) as typeof globalThis.fetch
const eAmr = await capturar(() => provider.transcrever({ bytes: bytesAudio, mimeType: 'audio/amr' }))
checar(eAmr instanceof LlmRecusadoError && !tocou, 'AMR recusa antes de gastar requisição', eAmr)

fingirTranscricao(429, { error: { type: 'insufficient_quota', code: 'insufficient_quota', message: 'sem saldo' } })
checar(await capturar(() => provider.transcrever({ bytes: bytesAudio, mimeType: 'audio/ogg' })) instanceof LlmBudgetExceededError,
  '429 sem saldo também é orçamento na transcrição')

// Transcrição não depende de OPENAI_MODEL: um typo no modelo da Maia não pode
// derrubar o texto dos áudios.
const modeloSalvo = process.env.OPENAI_MODEL
process.env.OPENAI_MODEL = 'gpt4o-mini-typo'
__limparCacheConfiguracao()
fingirTranscricao(200, { text: 'oi' })
checar((await capturar(() => provider.transcrever({ bytes: bytesAudio, mimeType: 'audio/ogg' }))) === null,
  'OPENAI_MODEL inválido não afeta a transcrição')
process.env.OPENAI_MODEL = modeloSalvo
__limparCacheConfiguracao()
globalThis.fetch = fetchOriginal

// ----------------------------------------------------------------------------
console.log(
  falhas === 0
    ? '\nTodas as asserções passaram.\n'
    : `\n${falhas} asserção(ões) falharam.\n`,
)
process.exit(falhas === 0 ? 0 : 1)
