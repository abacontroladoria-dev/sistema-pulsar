// ============================================================================
// Cliente das rotas de configuração do agente e de voz.
//
// Mesma razão de existir do services/connect/agendamentos.ts: o schema central
// não é exposto ao PostgREST em produção, então o browser não fala com o banco —
// fala com as rotas, que já vão autenticadas pelo cookie de sessão.
//
// A barra final é obrigatória: next.config.ts usa trailingSlash: true, e sem ela
// cada chamada custa um 308 e uma segunda viagem.
// ============================================================================

const BASE_CONFIG = '/api/central/agent-settings/'
const BASE_VOZ    = '/api/central/voz/'
const BASE_LLM    = '/api/central/llm/'

// Autonomia do agente. Não há campo de modelo: o modelo do LLM é OPENAI_MODEL,
// variável de runtime do servidor, e nunca deve chegar ao browser.
export type AiMode = 'off' | 'assisted' | 'autonomous'

export interface ConfiguracaoAgente {
  id:                 string
  aiMode:             AiMode
  agendamentoPorIa:   boolean
  systemPrompt:       string | null
  ttsAtivo:           boolean
  vozId:              string | null
  modeloVoz:          string
  stability:          number
  similarityBoost:    number
  style:              number
  speed:              number
  speakerBoost:       boolean
  // A chave nunca chega inteira ao browser — só a confirmação de que existe e
  // os quatro últimos caracteres, para o admin reconhecer qual está gravada.
  chaveConfigurada:   boolean
  chaveMascarada:     string | null
  atualizadoEm:       string | null
  // 'prompt': quem tem usuarios.pode_editar_prompt_maia sem ser admin/diretoria
  // — a API só grava o systemPrompt dessa pessoa.
  acesso?:            'total' | 'prompt'
}

// Estado da integração com a OpenAI. Diferente de tudo o mais neste arquivo,
// não é configuração editável: vem de variável de ambiente do servidor. A tela
// só relata — não há PATCH correspondente, de propósito.
export interface StatusOpenAI {
  configurada: boolean
  // Motivo do "não configurada", já em português e dizendo qual variável falta.
  motivo:      string | null
  // Id do modelo ativo. Não é a chave — essa nunca sai do servidor, nem em
  // máscara.
  modelo:      string | null
  modelosPermitidos: string[]
}

export interface VozDaConta {
  voiceId:    string
  nome:       string
  categoria:  string | null
  idioma:     string | null
  descricao:  string | null
  previewUrl: string | null
}

export interface ContaElevenLabs {
  tier:             string | null
  caracteresUsados: number | null
  caracteresLimite: number | null
}

export interface VozesDisponiveis {
  vozes: VozDaConta[]
  conta: ContaElevenLabs
}

export interface ResultadoTeste {
  audioBase64: string
  contentType: string
  tamanhoKb:   number
  geracaoMs:   number
  caracteres:  number
}

export interface SalvarConfiguracaoInput {
  chaveApi?:           string
  removerChave?:       boolean
  vozId?:              string | null
  modeloVoz?:          string | null
  stability?:          number
  similarityBoost?:    number
  style?:              number
  speed?:              number
  speakerBoost?:       boolean
  ttsAtivo?:           boolean
  systemPrompt?:       string | null
  aiMode?:             AiMode
  agendamentoPorIa?:   boolean
}

// Preserva o código de domínio da API. A tela precisa distinguir quatro coisas
// que a mensagem genérica "erro ao gerar áudio" achatava numa só:
//   TTS_NOT_CONFIGURED  → falta salvar a chave ou escolher a voz (ação nossa)
//   TTS_KEY_REJECTED    → a ElevenLabs recusou a credencial (chave errada/truncada)
//   TTS_QUOTA_EXCEEDED  → a chave está certa, os caracteres acabaram
//   TTS_PROVIDER_ERROR  → outro motivo, com a mensagem original da ElevenLabs
export class VozApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'VozApiError'
  }

  get faltaConfigurar(): boolean { return this.code === 'TTS_NOT_CONFIGURED' }
  get chaveRejeitada():  boolean { return this.code === 'TTS_KEY_REJECTED' }
  get cotaEsgotada():    boolean { return this.code === 'TTS_QUOTA_EXCEEDED' }
  get semPermissao():    boolean { return this.status === 403 }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })

  const body = await resp.json().catch(() => null)

  if (!resp.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error
    throw new VozApiError(
      err?.code ?? 'UNKNOWN',
      err?.message ?? `Falha na requisição (HTTP ${resp.status})`,
      resp.status,
    )
  }

  return (body as { data: T }).data
}

export function obterConfiguracao(): Promise<ConfiguracaoAgente> {
  return request<ConfiguracaoAgente>(BASE_CONFIG)
}

export function salvarConfiguracao(input: SalvarConfiguracaoInput): Promise<ConfiguracaoAgente> {
  return request<ConfiguracaoAgente>(BASE_CONFIG, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function obterStatusOpenAI(): Promise<StatusOpenAI> {
  return request<StatusOpenAI>(`${BASE_LLM}status/`)
}

// Também é a verificação da chave: se responde, a credencial é válida.
export function listarVozesDaConta(): Promise<VozesDisponiveis> {
  return request<VozesDisponiveis>(`${BASE_VOZ}vozes/`)
}

export function testarVoz(texto: string): Promise<ResultadoTeste> {
  return request<ResultadoTeste>(`${BASE_VOZ}testar/`, {
    method: 'POST',
    body: JSON.stringify({ texto }),
  })
}

// base64 → URL tocável no <audio>. Fica aqui porque é o par natural de
// testarVoz(): quem chama um sempre precisa do outro.
export function audioParaUrl(resultado: ResultadoTeste): string {
  const binario = atob(resultado.audioBase64)
  const bytes = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type: resultado.contentType || 'audio/mpeg' }))
}
