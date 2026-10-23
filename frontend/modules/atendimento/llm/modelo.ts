import 'server-only'

import { LlmConfiguracaoError } from './erros'

// ============================================================================
// Resolução do modelo e da credencial da OpenAI
//
// Duas regras que este arquivo existe para impor:
//
// 1. O MODELO VEM DO AMBIENTE, NÃO DO BANCO.
//    A coluna `agent_settings.ai_model_mode` guardava 'gpt-4o' e nenhum
//    consumidor OpenAI jamais a leu — o único que existiu traduzia aquele valor
//    para modelos Gemini, e 'gpt-4o' caía no `default:` do switch. Modelo é
//    decisão de instalação, versionada junto do código que sabe conversar com
//    ele, então mora em OPENAI_MODEL. A migration 20260811100000 removeu a
//    coluna para não haver uma segunda fonte de verdade.
//
// 2. NÃO EXISTE FALLBACK SILENCIOSO.
//    Valor ausente ou fora da allowlist LANÇA. A alternativa — cair num modelo
//    padrão — é exatamente o defeito que estamos removendo: alguém escreve
//    'gpt4o-mini' com um typo, o sistema usa outro modelo, a conta chega
//    diferente do esperado e nada no log diz por quê.
//
// Por que a validação é PREGUIÇOSA e não no import:
//    OPENAI_API_KEY é segredo de runtime, injetado pelo Coolify, e
//    deliberadamente NÃO é ARG do Dockerfile (ARG vaza no log de build e no
//    `docker history`). Validar no topo do módulo faria `next build` falhar
//    dentro do container, onde a variável legitimamente não existe. Então a
//    checagem acontece no primeiro uso, e o resultado é memoizado.
// ============================================================================

// ----------------------------------------------------------------------------
// Allowlist
//
// Lista fechada, e é assim de propósito: um id de modelo é um compromisso de
// custo e de comportamento, e trocá-lo merece passar por revisão de código em
// vez de por edição de variável de ambiente em produção.
//
// PARA ADICIONAR UM MODELO: confira o catálogo e o preço atuais em
// https://platform.openai.com/docs/models e https://openai.com/api/pricing/,
// acrescente o id aqui, e acrescente o preço correspondente em `precos.ts`
// (Fase 6) — teto de gasto calculado com preço errado não é teto.
//
// Os ids abaixo são o ponto de partida acordado para a migração. O catálogo da
// OpenAI muda com frequência; esta lista não se atualiza sozinha, e é bom que
// não se atualize.
// ----------------------------------------------------------------------------
export const MODELOS_PERMITIDOS = [
  'gpt-4o-mini',
  'gpt-4o',
] as const

export type ModeloPermitido = typeof MODELOS_PERMITIDOS[number]

export function isModeloPermitido(valor: unknown): valor is ModeloPermitido {
  return typeof valor === 'string'
    && (MODELOS_PERMITIDOS as readonly string[]).includes(valor)
}

// ----------------------------------------------------------------------------
// Tetos padrão
//
// Aplicados quando a requisição não especifica. Existem para que nenhuma
// chamada saia sem limite de saída: sem `max_tokens` uma resposta longa custa o
// que o modelo quiser gerar, e o primeiro laço de erro cobra a conta.
//
// 700 tokens é folgado para uma mensagem de WhatsApp — que raramente passa de
// 100 — e ainda cabe uma resposta que enumera três horários com explicação.
// ----------------------------------------------------------------------------
export const MAX_TOKENS_SAIDA_PADRAO = 700

// Temperatura baixa: a atendente lida com horário, data e nome de profissional.
// Variação criativa aqui não é charme, é risco de inventar dado.
export const TEMPERATURA_PADRAO = 0.3

// ----------------------------------------------------------------------------
// Modelo de transcrição
//
// Constante, e não variável de ambiente: pela mesma regra da allowlist acima,
// trocar de modelo é compromisso de custo e passa por revisão de código. Não
// segue OPENAI_MODEL porque é outra família — os modelos de chat não
// transcrevem e vice-versa.
//
// gpt-4o-mini-transcribe: ~US$ 0,003/min de áudio (metade do whisper-1) e erra
// menos que ele em português com ruído de fundo. Um mês de áudios da clínica
// fica na casa de centavos a poucos dólares.
//
// Idioma fixo em português: os contatos são todos daqui, e áudio curto ("oi,
// tudo bem?") é exatamente onde a detecção automática erra o idioma e devolve
// tradução em vez de transcrição.
// ----------------------------------------------------------------------------
export const MODELO_TRANSCRICAO = 'gpt-4o-mini-transcribe'
export const IDIOMA_TRANSCRICAO = 'pt'

// Só a chave. A transcrição não depende de OPENAI_MODEL: exigir a variável do
// chat aqui faria um typo no modelo da Maia derrubar também a transcrição.
export function resolverChaveOpenAI(): string {
  const chaveApi = (process.env.OPENAI_API_KEY ?? '').trim()
  if (!chaveApi) {
    throw new LlmConfiguracaoError(
      'OPENAI_API_KEY não está definida. Defina-a como variável de RUNTIME no '
      + 'Coolify (nunca como ARG do Dockerfile, que a gravaria na imagem).',
      'OPENAI_API_KEY',
    )
  }
  return chaveApi
}

// ----------------------------------------------------------------------------

interface ConfiguracaoOpenAI {
  chaveApi: string
  modelo:   ModeloPermitido
}

let cache: ConfiguracaoOpenAI | null = null

// Resolve e valida a configuração da OpenAI a partir do ambiente.
//
// Memoizado porque é chamada por requisição e o resultado não muda em processo
// vivo. O cache guarda só o caso de sucesso: se a configuração está errada,
// toda chamada deve reclamar de novo, e não uma única vez no primeiro boot.
export function resolverConfiguracaoOpenAI(): ConfiguracaoOpenAI {
  if (cache) return cache

  const chaveApi = resolverChaveOpenAI()
  const modeloBruto = (process.env.OPENAI_MODEL ?? '').trim()

  if (!modeloBruto) {
    throw new LlmConfiguracaoError(
      `OPENAI_MODEL não está definida. Use um de: ${MODELOS_PERMITIDOS.join(', ')}.`,
      'OPENAI_MODEL',
    )
  }

  if (!isModeloPermitido(modeloBruto)) {
    throw new LlmConfiguracaoError(
      `OPENAI_MODEL='${modeloBruto}' não está na allowlist. Permitidos: `
      + `${MODELOS_PERMITIDOS.join(', ')}. Para liberar outro modelo, acrescente `
      + 'o id em modules/atendimento/llm/modelo.ts e o preço em precos.ts.',
      'OPENAI_MODEL',
    )
  }

  cache = { chaveApi, modelo: modeloBruto }
  return cache
}

// Diz se a integração está configurada, SEM lançar e SEM revelar a chave.
//
// Serve para a tela e para /api/central/health responderem "a IA está
// configurada?" — pergunta que não deveria custar uma exceção nem uma chamada à
// OpenAI.
export function openAiEstaConfigurada(): { configurada: boolean; motivo: string | null } {
  try {
    resolverConfiguracaoOpenAI()
    return { configurada: true, motivo: null }
  } catch (err) {
    return {
      configurada: false,
      motivo: err instanceof LlmConfiguracaoError ? err.message : 'configuração inválida',
    }
  }
}

// Só para teste: descarta a memoização.
export function __limparCacheConfiguracao(): void {
  cache = null
}
