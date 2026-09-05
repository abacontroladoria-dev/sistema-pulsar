import 'server-only'

import { DEFINICOES_FERRAMENTAS, type FerramentasAgente } from './ferramentas'
import {
  LlmRateLimitError,
  LlmTimeoutError,
  LlmRecusadoError,
  LlmConfiguracaoError,
  LlmBudgetExceededError,
  LlmProviderError,
  ToolLoopDetectedError,
} from '../llm/erros'
import type {
  LLMProvider,
  LlmMensagem,
  LlmUso,
  LlmChamadaFerramenta,
} from '../llm/tipos'

// ============================================================================
// Orquestrador — o laço de tool calling de um turno de conversa
//
// Divisão de responsabilidade, e ela é a razão deste arquivo existir separado:
//
//   LLMProvider.chat()   — uma ida ao modelo. Não itera, não executa nada.
//   FerramentasAgente    — executa uma ferramenta. NUNCA lança.
//   orquestrador (aqui)  — decide QUANTAS vezes ir, quando parar, e o que fazer
//                          quando algo dá errado.
//
// A regra que governa o arquivo inteiro: UM TURNO NUNCA TERMINA EM SILÊNCIO.
// Do outro lado há um responsável esperando no WhatsApp. Toda saída deste
// módulo é um dos três resultados abaixo, e cada um tem uma consequência
// visível — inclusive `escalar`, que precisa produzir nota interna e atribuição
// a humano. Item que morre em `failed` sem ninguém ver é o defeito que as
// migrations de fila (Bloco A) existiram para eliminar; reintroduzi-lo aqui
// desfaria aquele trabalho.
// ============================================================================

// Teto de idas ao modelo. Um fluxo completo — consultar especialidades,
// consultar horários, agendar, confirmar — cabe em 4. O teto de 6 dá margem
// para uma correção de rota ("esse horário não serve, e o de quarta?") sem
// permitir que o modelo gire indefinidamente cobrando por volta.
const MAX_ITERACOES = 6

// Uma retentativa para timeout, e só. Timeout costuma ser transitório; insistir
// além disso é gastar o tempo do responsável esperando no WhatsApp.
const RETENTATIVAS_TIMEOUT = 1

export interface EntradaTurno {
  orgId:          string
  conversationId: string
  contactId:      string
  // Já agrupadas pelo debounce de 15s da message_grouping_queue. Chegam
  // separadas porque a pessoa manda "oi", "queria marcar", "pra terça" em três
  // mensagens; viram um único turno de usuário.
  textosDoUsuario: string[]
}

export interface DepsTurno {
  provider:    LLMProvider
  ferramentas: FerramentasAgente
  // Mensagens de contexto já montadas (system prompt + memória + histórico).
  // Vêm prontas de `contexto.ts` porque montá-las exige banco, e manter esse
  // acesso fora daqui é o que torna este laço testável sem stack.
  contexto:    LlmMensagem[]
  // Interruptor de `agent_settings.ai_scheduling_enabled`. Falso: o modelo
  // conversa mas não recebe ferramenta nenhuma, logo não pode escrever na
  // agenda. É o botão de pânico da entrega.
  agendamentoHabilitado: boolean
  // Rastro opcional das chamadas de ferramenta.
  //
  // Existe porque "a IA ofereceu horário da unidade errada" era
  // indiagnosticável: as tool calls viviam só no array `mensagens` deste laço e
  // morriam no return. Não havia como responder, por SQL, se o modelo passou
  // `unidade: 'Padre Miguel'` e o banco devolveu vazio (defeito de dados) ou se
  // ele passou `unidade: null` e filtrou de cabeça (defeito de prompt) — que
  // são consertos em lugares completamente diferentes.
  //
  // Opcional DE PROPÓSITO: este laço não pode depender de banco, é isso que o
  // mantém testável sem stack (orquestrador.test.mts roda em memória). Quem
  // fornece o callback é o worker, que já tem o cliente service role.
  //
  // Nunca lança para este laço — falha de rastro não derruba o turno.
  aoChamarFerramenta?: (registro: RegistroChamadaFerramenta) => void
}

// O que se grava de uma chamada de ferramenta. Deliberadamente magro: ver a
// allowlist de campos em `argumentosLogaveis`.
export interface RegistroChamadaFerramenta {
  iteracao:   number
  nome:       string
  // Argumentos JÁ FILTRADOS pela allowlist — só chaves e parâmetros de recorte.
  argumentos: Record<string, unknown>
  ok:         boolean
  motivo:     string | null
  // Quantos itens o resultado trouxe. É o número que responde "ele consultou
  // Padre Miguel e voltou vazio?" sem gravar os horários em si.
  qtdItens:   number | null
  duracaoMs:  number
}

export type ResultadoTurno =
  | { tipo: 'responder'; texto: string; usos: LlmUso[] }
  | {
      tipo: 'escalar'
      motivo: 'loop' | 'filtrado' | 'erro_provider' | 'sem_texto'
      detalhe: string
      usos: LlmUso[]
    }
  // Distinto de 'escalar': aqui não há falha nem nada a fazer. Retentar é que
  // seria o erro — o item deve sair da fila como concluído.
  | { tipo: 'aguardar'; esperarMs: number | null; detalhe: string }

// Resposta a uma chamada cujos argumentos não são JSON válido. Vai de volta ao
// modelo no MESMO formato das ferramentas reais ({ok:false,motivo,mensagem}),
// porque é assim que ele já sabe ler uma recusa — e reformular é o que
// queremos que ele faça.
const ARGUMENTOS_INVALIDOS = JSON.stringify({
  ok: false,
  motivo: 'argumentos_invalidos',
  mensagem:
    'Os argumentos não são JSON válido. Reenvie a chamada com JSON bem formado.',
})

// Assinatura de uma chamada, para detectar repetição. Nome + argumentos crus:
// a mesma ferramenta com argumentos diferentes é progresso legítimo (consultar
// terça, depois quarta); a mesma com os mesmos argumentos é o modelo travado.
function assinatura(c: LlmChamadaFerramenta): string {
  return `${c.nome}::${c.argumentosJson}`
}

// Os únicos argumentos que vão para o rastro.
//
// ALLOWLIST, jamais denylist: uma ferramenta nova ganha um parâmetro e um
// denylist o vaza por omissão — e o parâmetro novo pode ser texto livre digitado
// pelo responsável. Precedente da mesma decisão em ferramentas.ts, no guard de
// contexto: "O valor NÃO é logado: pode conter dado de paciente".
//
// Todos os campos aqui são chave ou parâmetro de RECORTE. Ficam fora, de
// propósito: `observacao` e `motivo` (texto livre do responsável),
// `agendamentoId`, e o conteúdo do resultado.
//
// Isso é magro e é suficiente: para responder "por que ofereceu Realengo?", o
// que se precisa saber é `{unidade: null}` — e isso já é a resposta inteira.
const ARGUMENTOS_LOGAVEIS = new Set([
  // `terapia` é o nome que o modelo passa desde 05/09/2026; `terapiaId` fica na
  // lista porque o rastro histórico o tem e porque a rota HTTP ainda o usa —
  // remover só apagaria a coluna nas consultas de diagnóstico antigas.
  'terapia', 'terapiaId', 'unidade', 'dataInicio', 'dataFim', 'limite', 'profissionalId', 'tipo',
])

function argumentosLogaveis(args: Record<string, unknown>): Record<string, unknown> {
  const saida: Record<string, unknown> = {}
  for (const [chave, valor] of Object.entries(args)) {
    if (ARGUMENTOS_LOGAVEIS.has(chave)) saida[chave] = valor
  }
  return saida
}

// Quantos itens o resultado trouxe, sem saber o formato de cada ferramenta:
// procura o primeiro array no objeto (`horarios`, `especialidades`,
// `agendamentos`). Devolve null quando não há array — uma recusa ou uma
// confirmação de agendamento não têm contagem, e forçar 0 ali faria "recusou"
// e "achou zero" parecerem a mesma coisa no rastro.
function contarItens(resultado: unknown): number | null {
  if (resultado === null || typeof resultado !== 'object') return null
  for (const valor of Object.values(resultado as Record<string, unknown>)) {
    if (Array.isArray(valor)) return valor.length
  }
  return null
}

// Entrega o registro ao callback, se houver. Engole qualquer falha: um rastro
// que derruba o turno é pior que rastro nenhum — o paciente ficaria sem
// resposta no WhatsApp por causa de um insert de auditoria.
function registrar(deps: DepsTurno, registro: RegistroChamadaFerramenta): void {
  if (!deps.aoChamarFerramenta) return
  try {
    deps.aoChamarFerramenta(registro)
  } catch (err) {
    console.warn('[executarTurno] rastro de tool call falhou (turno segue):', err)
  }
}

/**
 * Executa um turno completo: manda ao modelo, executa as ferramentas que ele
 * pedir, repete até haver texto para responder ou até um teto ser atingido.
 *
 * Não lança para o chamador em caso de falha esperada — devolve `escalar` ou
 * `aguardar`. Exceção só escapa daqui se for defeito de programação, e nesse
 * caso o worker deve deixar o item ir para `failed` mesmo.
 */
export async function executarTurno(
  entrada: EntradaTurno,
  deps: DepsTurno,
): Promise<ResultadoTurno> {
  const usos: LlmUso[] = []

  // O histórico do turno. Começa com o contexto montado e a fala do usuário;
  // cresce a cada volta com o que o modelo disse e o que as ferramentas
  // responderam.
  const mensagens: LlmMensagem[] = [
    ...deps.contexto,
    { papel: 'user', conteudo: entrada.textosDoUsuario.join('\n').trim() },
  ]

  // Ferramentas ausentes quando o agendamento está desligado. `undefined` e não
  // `[]`: o provider omite a chave `tools` inteira, e o modelo nem sabe que
  // poderia agendar — não há o que recusar.
  const ferramentas = deps.agendamentoHabilitado ? DEFINICOES_FERRAMENTAS : undefined

  const jaChamadas = new Set<string>()

  for (let iteracao = 1; iteracao <= MAX_ITERACOES; iteracao++) {
    let resposta
    try {
      resposta = await irAoModelo(deps.provider, {
        mensagens,
        ferramentas: ferramentas as never,
        etapa: 'turno',
      })
    } catch (err) {
      return traduzirFalhaDoProvider(err, usos)
    }

    usos.push(resposta.uso)

    // content_filter: o modelo se recusou. Não adianta insistir com o mesmo
    // contexto, e mandar o texto parcial de uma resposta filtrada ao paciente
    // seria pior que não responder.
    if (resposta.motivoParada === 'content_filter') {
      return {
        tipo: 'escalar',
        motivo: 'filtrado',
        detalhe: 'A resposta foi bloqueada pelo filtro de conteúdo da OpenAI.',
        usos,
      }
    }

    // Sem chamadas: o modelo terminou de falar. É a saída normal do laço.
    if (resposta.chamadas.length === 0) {
      const texto = (resposta.conteudo ?? '').trim()
      if (texto) return { tipo: 'responder', texto, usos }

      // Truncado antes de emitir qualquer texto. Sem retomada automática — não
      // cabe no escopo, e uma retomada mal feita duplica mensagem.
      return {
        tipo: 'escalar',
        motivo: 'sem_texto',
        detalhe:
          resposta.motivoParada === 'length'
            ? 'A resposta foi truncada pelo limite de tokens antes de produzir texto.'
            : 'O modelo encerrou o turno sem texto e sem chamar ferramenta.',
        usos,
      }
    }

    // Repetição exata: a segunda ocorrência já é laço. Não esperamos o teto
    // porque cada volta extra custa dinheiro e tempo de quem espera.
    for (const chamada of resposta.chamadas) {
      if (jaChamadas.has(assinatura(chamada))) {
        const laco = new ToolLoopDetectedError(chamada.nome, iteracao)
        return { tipo: 'escalar', motivo: 'loop', detalhe: laco.message, usos }
      }
      jaChamadas.add(assinatura(chamada))
    }

    // O turno do assistente entra no histórico ANTES dos resultados: a API
    // exige que cada `tool` responda a um `tool_call` que já esteja lá.
    mensagens.push({
      papel: 'assistant',
      conteudo: resposta.conteudo,
      chamadas: resposta.chamadas,
    })

    // Ferramentas em paralelo. São independentes entre si (consultar duas
    // especialidades, por exemplo) e `executar` nunca lança, então não há
    // rejeição para tratar aqui.
    const resultados = await Promise.all(
      resposta.chamadas.map(async (chamada) => {
        const args = parsearArgumentos(chamada.argumentosJson)
        if (args === null) {
          registrar(deps, {
            iteracao,
            nome:       chamada.nome,
            argumentos: {},
            ok:         false,
            motivo:     'argumentos_invalidos',
            qtdItens:   null,
            duracaoMs:  0,
          })
          return { chamada, conteudo: ARGUMENTOS_INVALIDOS }
        }

        const comecou = Date.now()
        const resultado = await deps.ferramentas.executar(chamada.nome, args)
        const r = resultado as { ok?: unknown; motivo?: unknown }

        registrar(deps, {
          iteracao,
          nome:       chamada.nome,
          argumentos: argumentosLogaveis(args),
          ok:         r.ok === true,
          motivo:     typeof r.motivo === 'string' ? r.motivo : null,
          qtdItens:   contarItens(resultado),
          duracaoMs:  Date.now() - comecou,
        })

        return { chamada, conteudo: JSON.stringify(resultado) }
      }),
    )

    for (const { chamada, conteudo } of resultados) {
      mensagens.push({
        papel: 'tool',
        chamadaId: chamada.id,
        nome: chamada.nome,
        conteudo,
      })
    }
  }

  // Estourou o teto ainda pedindo ferramenta.
  const laco = new ToolLoopDetectedError('(teto de iterações)', MAX_ITERACOES)
  return { tipo: 'escalar', motivo: 'loop', detalhe: laco.message, usos }
}

// ----------------------------------------------------------------------------
// Uma ida ao modelo, com a única retentativa de timeout embutida.
//
// Só timeout é retentado aqui dentro. Rate limit precisa devolver o item à fila
// (o worker sabe adiar `process_after`; este laço não), e os demais erros não
// melhoram com repetição.
// ----------------------------------------------------------------------------
async function irAoModelo(
  provider: LLMProvider,
  requisicao: Parameters<LLMProvider['chat']>[0],
) {
  let ultimoTimeout: unknown = null

  for (let tentativa = 0; tentativa <= RETENTATIVAS_TIMEOUT; tentativa++) {
    try {
      return await provider.chat(requisicao)
    } catch (err) {
      if (err instanceof LlmTimeoutError) {
        ultimoTimeout = err
        continue
      }
      throw err
    }
  }

  throw ultimoTimeout
}

// Cada classe de erro tem uma reação diferente — é para isso que `erros.ts` as
// separa. Achatar tudo em "deu erro" faria o sistema esperar quando devia
// escalar, e escalar quando bastava esperar.
function traduzirFalhaDoProvider(err: unknown, usos: LlmUso[]): ResultadoTurno {
  // Esperar É a resposta certa. Não é falha: o item volta para a fila.
  if (err instanceof LlmRateLimitError) {
    return {
      tipo: 'aguardar',
      esperarMs: err.esperarMs,
      detalhe: err.message,
    }
  }

  // Timeout que sobreviveu à retentativa de `irAoModelo`.
  if (err instanceof LlmTimeoutError) {
    return { tipo: 'escalar', motivo: 'erro_provider', detalhe: err.message, usos }
  }

  // Nenhum destes melhora com repetição: credencial errada, env ausente, teto
  // de gasto. Retentar reproduz o mesmo erro — e no caso do orçamento,
  // transformaria o teto em decoração.
  if (
    err instanceof LlmRecusadoError ||
    err instanceof LlmConfiguracaoError ||
    err instanceof LlmBudgetExceededError
  ) {
    return { tipo: 'escalar', motivo: 'erro_provider', detalhe: err.message, usos }
  }

  if (err instanceof LlmProviderError) {
    return { tipo: 'escalar', motivo: 'erro_provider', detalhe: err.message, usos }
  }

  // Desconhecido. Escala em vez de propagar: o responsável precisa de
  // atendimento mesmo quando a causa é uma que não previmos.
  return {
    tipo: 'escalar',
    motivo: 'erro_provider',
    detalhe: err instanceof Error ? err.message : String(err),
    usos,
  }
}

// `null` sinaliza JSON inválido. Não lança: argumento malformado é caso
// ESPERADO — o modelo erra — e a reação certa é devolver o erro a ele para que
// reformule, não derrubar o turno.
function parsearArgumentos(json: string): Record<string, unknown> | null {
  try {
    const valor = JSON.parse(json) as unknown
    // `"texto"` e `[1,2]` são JSON válido mas não são argumentos. As
    // ferramentas indexam por chave; um não-objeto viraria `undefined` em todo
    // campo e a recusa sairia confusa ("faltam profissionalId, data ou hora").
    if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
      return null
    }
    return valor as Record<string, unknown>
  } catch {
    return null
  }
}

// Exportado para teste: o teto é a garantia de custo do turno, e um teste que
// repete o número mágico deixa de proteger quando alguém muda a constante.
export const __MAX_ITERACOES = MAX_ITERACOES
