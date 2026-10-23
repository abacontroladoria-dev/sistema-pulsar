// ============================================================================
// LLMProvider — a fronteira entre o Pulsar e o provedor de linguagem
//
// Por que esta camada existe:
//   O orquestrador precisa conversar com um modelo, executar ferramentas e
//   contar tokens. Nada disso é específico da OpenAI. O que É específico —
//   nomes de campo, formato de tool call, forma do objeto de uso, códigos de
//   erro — fica confinado em OpenAIProvider (Fase 2).
//
//   A regra que dá valor ao arquivo: NENHUM tipo do SDK aparece aqui. Se um dia
//   `openai` for importado neste arquivo, a fronteira vazou. O teste é
//   mecânico: `grep -rn "from 'openai'" frontend/` deve retornar exatamente um
//   arquivo, e não é este.
//
//   O antecessor deste desenho fazia o contrário: o nina-orchestrator montava o
//   corpo HTTP do gateway da Lovable inline, no meio da lógica de conversa. O
//   resultado é que trocar de provedor virou reescrever o orquestrador — que é
//   exatamente a situação que estamos desfazendo.
//
// Vocabulário: os tipos são nomeados em português como o resto do módulo
// atendimento/, e os papéis das mensagens em inglês porque são termos do
// protocolo, não do domínio da clínica.
// ============================================================================

// ----------------------------------------------------------------------------
// Mensagens
//
// A união é discriminada por `papel` de propósito: cada papel carrega campos
// diferentes e obrigatórios em momentos diferentes. Um único tipo com tudo
// opcional deixaria passar `{ papel: 'tool' }` sem `chamadaId`, que é a forma
// mais fácil de quebrar um loop de tool calling — a API rejeita o turno inteiro
// e o erro chega longe da origem.
// ----------------------------------------------------------------------------

// Instruções do sistema. É a ÚNICA origem de instrução, e nada vindo do canal
// (WhatsApp) pode ser montado com este papel — ver contexto.ts na Fase 4.
export interface LlmMensagemSistema {
  papel:     'system'
  conteudo:  string
}

// Turno do responsável. Conteúdo NÃO CONFIÁVEL por definição.
export interface LlmMensagemUsuario {
  papel:     'user'
  conteudo:  string
}

// Turno do modelo. Pode vir só com texto, só com chamadas de ferramenta, ou com
// os dois — e pode vir sem nenhum dos dois quando a resposta é truncada.
export interface LlmMensagemAssistente {
  papel:     'assistant'
  conteudo:  string | null
  chamadas?: LlmChamadaFerramenta[]
}

// Resultado de uma ferramenta, devolvido ao modelo. `chamadaId` amarra o
// resultado à chamada que o modelo fez; sem ele a API não sabe o que é resposta
// de quê.
export interface LlmMensagemFerramenta {
  papel:      'tool'
  chamadaId:  string
  nome:       string
  // JSON serializado do ResultadoFerramenta. String, não objeto: é o que a API
  // aceita, e serializar num lugar só evita divergência de formato.
  conteudo:   string
}

export type LlmMensagem =
  | LlmMensagemSistema
  | LlmMensagemUsuario
  | LlmMensagemAssistente
  | LlmMensagemFerramenta

// ----------------------------------------------------------------------------
// Ferramentas
// ----------------------------------------------------------------------------

// Definição no formato que o provider traduz para a API. É intencionalmente o
// mesmo shape de DEFINICOES_FERRAMENTAS em agente/ferramentas.ts, para as
// definições existentes passarem sem conversão.
export interface LlmFerramenta {
  type:     'function'
  function: {
    name:        string
    description: string
    // JSON Schema. `unknown` e não um tipo estrutural porque validar JSON
    // Schema em TypeScript custa mais do que entrega: quem valida de verdade é
    // a API, e o strict mode reclama alto quando o schema está errado.
    parameters:  Record<string, unknown>
    // Strict mode: a API garante que os argumentos obedecem ao schema. Exige
    // `additionalProperties: false` e todas as chaves em `required` — opcional
    // se expressa como tipo nullable. Ver ferramentas.ts.
    strict?:     boolean
  }
}

// Chamada que o modelo pediu. `argumentosJson` é string crua porque é assim que
// chega, e porque parsear é o ponto onde o modelo erra: JSON inválido é caso
// esperado, não exceção. Quem consome decide o que fazer com a falha de parse.
export interface LlmChamadaFerramenta {
  id:             string
  nome:           string
  argumentosJson: string
}

// ----------------------------------------------------------------------------
// Uso e custo
//
// Contabilidade de token não é opcional e não é responsabilidade de quem chama
// lembrar: `uso` é campo obrigatório de LlmResposta. A Fase 6 grava isso em
// central.llm_usage e aplica teto ANTES da chamada seguinte.
// ----------------------------------------------------------------------------

export interface LlmUso {
  // Modelo que efetivamente respondeu — não o que foi pedido. A API pode
  // resolver um alias para uma versão datada, e é a versão que define o preço.
  modelo:         string
  tokensEntrada:  number
  tokensSaida:    number
}

// Por que a resposta parou. `length` e `content_filter` são os dois que mudam a
// decisão do orquestrador: truncada pede retomada ou recusa, filtrada pede
// escalada ao humano. Achatá-los em "deu erro" perde essa distinção.
export type LlmMotivoParada =
  | 'stop'
  | 'tool_calls'
  | 'length'
  | 'content_filter'
  | 'other'

export interface LlmResposta {
  conteudo:      string | null
  chamadas:      LlmChamadaFerramenta[]
  uso:           LlmUso
  motivoParada:  LlmMotivoParada
  // Tempo de parede da chamada. Entra em central.llm_usage na Fase 6 — é o que
  // permite distinguir "o modelo está lento" de "a fila está entupida".
  latenciaMs:    number
}

// ----------------------------------------------------------------------------
// Requisição
// ----------------------------------------------------------------------------

export interface LlmRequisicao {
  mensagens:       LlmMensagem[]
  ferramentas?:    LlmFerramenta[]
  // Obriga o modelo a chamar ESTA ferramenta (pelo nome), em vez de deixá-lo
  // escolher. Ausente = ele decide. Usado pela classificação (agente/
  // classificacao.ts): opcional, a Maia não classificava nunca.
  escolhaFerramenta?: string
  // Teto de tokens de saída. Obrigatório na prática: sem ele uma resposta longa
  // custa o que quiser. O provider aplica um padrão se vier ausente.
  maxTokensSaida?: number
  temperatura?:    number
  // Rótulo curto do que originou a chamada ('turno', 'sintese', 'transcricao').
  // Só para observabilidade e para agrupar custo por etapa — nunca vai para o
  // modelo.
  etapa?:          string
}

// ----------------------------------------------------------------------------
// A interface
//
// Um método só, por enquanto. `chatStream()` entra quando houver consumidor:
// interface com método que ninguém implementa é promessa que o TypeScript cobra
// e o runtime não cumpre. A transcrição ganhou consumidor (o áudio do inbox) e
// mora numa interface própria logo abaixo — quem só conversa não precisa
// implementá-la.
// ----------------------------------------------------------------------------

export interface LLMProvider {
  // Nome do provedor, para log e para central.llm_usage.
  readonly nome: string

  // Uma ida ao modelo. NÃO executa ferramenta e NÃO decide iterar: devolve o
  // que o modelo disse, inclusive quando o que ele disse foi "chame estas
  // ferramentas". O loop é do orquestrador (Fase 3), porque é lá que moram os
  // tetos de iteração e a detecção de repetição.
  chat(requisicao: LlmRequisicao): Promise<LlmResposta>
}

// ----------------------------------------------------------------------------
// Transcrição de áudio
//
// Recebe os BYTES, não uma URL: o arquivo está num bucket privado e a URL
// assinada seria mais um segredo viajando para fora. Quem chama já tem os bytes
// (acabou de baixá-los da Meta/Evolution ou do bucket).
// ----------------------------------------------------------------------------

export interface TranscricaoRequisicao {
  bytes:    ArrayBuffer
  // MIME como veio ('audio/ogg; codecs=opus'). O provider deriva dele o nome
  // do arquivo — a OpenAI decide o formato pela extensão.
  mimeType: string
  // Teto da chamada. O worker passa um menor que o padrão: ele divide 60s de
  // tique com a entrega de mensagens.
  timeoutMs?: number
}

export interface TranscricaoResposta {
  // Pode ser '' — áudio só com ruído, ou um "hum" que o modelo descarta.
  texto:      string
  // O modelo que respondeu. Mesma regra de LlmUso.modelo.
  modelo:     string
  latenciaMs: number
}

export interface TranscricaoProvider {
  readonly nome: string
  transcrever(requisicao: TranscricaoRequisicao): Promise<TranscricaoResposta>
}
