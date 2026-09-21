// Verifica o laço de tool calling com provider e ferramentas dublês. Não gasta
// token, não toca banco:
//
//   npx tsx --conditions react-server modules/atendimento/agente/orquestrador.test.mts
//
// (a flag é necessária porque o orquestrador importa 'server-only', cujo
// index.js lança por design; sob a condição react-server ele resolve para um
// módulo vazio, que é o que o Next usa no bundle do servidor.)
//
// O que se prova, e por que:
//
//   1. O CAMINHO FELIZ de ponta a ponta, incluindo a ordem exigida pela API
//      (assistant com tool_calls ANTES das mensagens tool que os respondem).
//   2. OS TETOS — repetição e MAX_ITERACOES. São a garantia de custo do turno:
//      sem eles um modelo travado gira cobrando por volta.
//   3. JSON INVÁLIDO não derruba o turno, volta ao modelo como recusa.
//   4. CADA CLASSE DE ERRO produz a reação certa. Rate limit virando 'escalar'
//      faria o sistema desistir quando bastava esperar; recusa virando
//      'aguardar' faria retentar contra credencial que não vai melhorar.
//   5. NENHUM CAMINHO TERMINA EM SILÊNCIO — a regra do arquivo.
//   6. O INTERRUPTOR de agendamento realmente impede o modelo de escrever.
//
// Sem framework, como os outros testes do módulo.

import { executarTurno, __MAX_ITERACOES, type DepsTurno, type RegistroChamadaFerramenta } from './orquestrador.js'
import type { FerramentasAgente, ResultadoFerramenta } from './ferramentas.js'
import {
  LlmRateLimitError,
  LlmTimeoutError,
  LlmRecusadoError,
  LlmConfiguracaoError,
  LlmBudgetExceededError,
  LlmProviderError,
} from '../llm/erros.js'
import type { LLMProvider, LlmResposta, LlmRequisicao, LlmMensagem } from '../llm/tipos.js'

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

const USO = { modelo: 'gpt-4o-mini', tokensEntrada: 10, tokensSaida: 5 }

function resposta(parcial: Partial<LlmResposta>): LlmResposta {
  return {
    conteudo: null,
    chamadas: [],
    uso: USO,
    motivoParada: 'stop',
    latenciaMs: 1,
    ...parcial,
  }
}

// Provider dublê: devolve o roteiro em ordem; se acabar, repete o último.
// Guarda as requisições para inspeção.
function providerDe(roteiro: (LlmResposta | Error)[]): {
  provider: LLMProvider
  requisicoes: LlmRequisicao[]
} {
  const requisicoes: LlmRequisicao[] = []
  let i = 0
  return {
    requisicoes,
    provider: {
      nome: 'duble',
      async chat(req) {
        requisicoes.push(req)
        const passo = roteiro[Math.min(i, roteiro.length - 1)]
        i++
        if (passo instanceof Error) throw passo
        return passo
      },
    },
  }
}

// Ferramentas dublê: registra o que foi executado.
function ferramentasDe(
  resultado: ResultadoFerramenta = { ok: true, horarios: [] },
): { ferramentas: FerramentasAgente; executadas: { nome: string; args: unknown }[] } {
  const executadas: { nome: string; args: unknown }[] = []
  return {
    executadas,
    ferramentas: {
      async executar(nome: string, args: unknown) {
        executadas.push({ nome, args })
        return resultado
      },
    } as unknown as FerramentasAgente,
  }
}

const CONTEXTO: LlmMensagem[] = [{ papel: 'system', conteudo: 'Você é a atendente.' }]

function deps(parcial: Partial<DepsTurno>): DepsTurno {
  return {
    provider: providerDe([resposta({ conteudo: 'oi' })]).provider,
    ferramentas: ferramentasDe().ferramentas,
    contexto: CONTEXTO,
    agendamentoHabilitado: true,
    ...parcial,
  }
}

const ENTRADA = {
  orgId: 'org-1',
  conversationId: 'conv-1',
  contactId: 'cont-1',
  textosDoUsuario: ['oi', 'queria marcar'],
}

// ----------------------------------------------------------------------------
console.log('\n1. caminho feliz: uma ida, texto de volta')

{
  const { provider, requisicoes } = providerDe([resposta({ conteudo: 'Bom dia! Como posso ajudar?' })])
  const r = await executarTurno(ENTRADA, deps({ provider }))

  checar(r.tipo === 'responder', 'devolve responder', r)
  checar(r.tipo === 'responder' && r.texto === 'Bom dia! Como posso ajudar?', 'texto preservado')
  checar(r.tipo === 'responder' && r.usos.length === 1, 'contabiliza 1 uso')

  const msgs = requisicoes[0]!.mensagens
  checar(msgs[0]?.papel === 'system', 'contexto vem primeiro')
  checar(
    msgs[1]?.papel === 'user' && msgs[1].conteudo === 'oi\nqueria marcar',
    'as mensagens agrupadas viram UM turno de usuário',
    msgs[1],
  )
}

// ----------------------------------------------------------------------------
console.log('\n2. tool calling: executa e volta ao modelo')

{
  const { provider, requisicoes } = providerDe([
    resposta({
      motivoParada: 'tool_calls',
      chamadas: [{ id: 'c1', nome: 'consultar_horarios_disponiveis', argumentosJson: '{"terapiaId":3}' }],
    }),
    resposta({ conteudo: 'Tenho terça às 9h.' }),
  ])
  const { ferramentas, executadas } = ferramentasDe({ ok: true, horarios: [{ data: '2026-09-01' }] })
  const r = await executarTurno(ENTRADA, deps({ provider, ferramentas }))

  checar(r.tipo === 'responder' && r.texto === 'Tenho terça às 9h.', 'responde após a ferramenta', r)
  checar(executadas.length === 1, 'a ferramenta foi executada uma vez')
  checar(executadas[0]?.nome === 'consultar_horarios_disponiveis', 'nome correto')
  checar(
    JSON.stringify(executadas[0]?.args) === '{"terapiaId":3}',
    'argumentos chegam PARSEADOS ao executor',
    executadas[0]?.args,
  )
  checar(r.tipo === 'responder' && r.usos.length === 2, 'contabiliza os 2 usos (as duas idas custam)')

  // Ordem exigida pela API: o tool_call precisa existir antes do tool result.
  const segunda = requisicoes[1]!.mensagens
  const iAssist = segunda.findIndex((m) => m.papel === 'assistant')
  const iTool = segunda.findIndex((m) => m.papel === 'tool')
  checar(iAssist >= 0 && iTool > iAssist,
    'assistant com tool_calls vem ANTES do resultado (senão a API rejeita o turno)',
    segunda.map((m) => m.papel))
  const tool = segunda[iTool] as { chamadaId?: string; conteudo?: string }
  checar(tool.chamadaId === 'c1', 'o resultado carrega o id da chamada')
  checar(String(tool.conteudo).includes('"ok":true'), 'o resultado da ferramenta é serializado como JSON')
}

// ----------------------------------------------------------------------------
console.log('\n3. teto: repetição exata é laço na SEGUNDA ocorrência')

{
  const mesma = {
    motivoParada: 'tool_calls' as const,
    chamadas: [{ id: 'x', nome: 'consultar_horarios_disponiveis', argumentosJson: '{"terapiaId":3}' }],
  }
  const { provider, requisicoes } = providerDe([resposta(mesma), resposta(mesma)])
  const r = await executarTurno(ENTRADA, deps({ provider }))

  checar(r.tipo === 'escalar' && r.motivo === 'loop', 'repetição vira escalar/loop', r)
  checar(requisicoes.length === 2,
    'para na 2ª ida, não espera o teto de iterações (cada volta extra custa)',
    requisicoes.length)
}

{
  // Mesma ferramenta, argumentos DIFERENTES = progresso legítimo, não laço.
  const { provider } = providerDe([
    resposta({ motivoParada: 'tool_calls', chamadas: [{ id: 'a', nome: 'f', argumentosJson: '{"dia":"terca"}' }] }),
    resposta({ motivoParada: 'tool_calls', chamadas: [{ id: 'b', nome: 'f', argumentosJson: '{"dia":"quarta"}' }] }),
    resposta({ conteudo: 'Quarta tem vaga.' }),
  ])
  const r = await executarTurno(ENTRADA, deps({ provider }))
  checar(r.tipo === 'responder',
    'mesma ferramenta com argumentos diferentes NÃO é laço (consultar terça e depois quarta é progresso)', r)
}

// ----------------------------------------------------------------------------
console.log('\n4. teto de iterações')

{
  // Argumentos sempre novos, para escapar da detecção de repetição e bater no teto.
  let n = 0
  const provider: LLMProvider = {
    nome: 'duble',
    async chat() {
      n++
      return resposta({
        motivoParada: 'tool_calls',
        chamadas: [{ id: `c${n}`, nome: 'f', argumentosJson: `{"n":${n}}` }],
      })
    },
  }
  const r = await executarTurno(ENTRADA, deps({ provider }))

  checar(r.tipo === 'escalar' && r.motivo === 'loop', 'estourar o teto vira escalar/loop', r)
  checar(n === __MAX_ITERACOES, `foi ao modelo exatamente ${__MAX_ITERACOES} vezes`, n)
  checar(r.tipo === 'escalar' && r.usos.length === __MAX_ITERACOES, 'todos os usos foram contabilizados')
}

// ----------------------------------------------------------------------------
console.log('\n5. JSON inválido nos argumentos volta ao modelo, não derruba o turno')

{
  const { provider, requisicoes } = providerDe([
    resposta({ motivoParada: 'tool_calls', chamadas: [{ id: 'c1', nome: 'f', argumentosJson: '{isto nao e json' }] }),
    resposta({ conteudo: 'Desculpe, pode repetir?' }),
  ])
  const { ferramentas, executadas } = ferramentasDe()
  const r = await executarTurno(ENTRADA, deps({ provider, ferramentas }))

  checar(r.tipo === 'responder', 'o turno continua e responde', r)
  checar(executadas.length === 0, 'a ferramenta NÃO foi executada com lixo')
  const tool = requisicoes[1]!.mensagens.find((m) => m.papel === 'tool') as { conteudo?: string }
  checar(String(tool?.conteudo).includes('argumentos_invalidos'),
    'o modelo recebe a recusa no mesmo formato das ferramentas reais, para reformular',
    tool?.conteudo)
}

{
  // JSON válido que não é objeto: as ferramentas indexam por chave.
  const { provider } = providerDe([
    resposta({ motivoParada: 'tool_calls', chamadas: [{ id: 'c1', nome: 'f', argumentosJson: '"texto"' }] }),
    resposta({ conteudo: 'ok' }),
  ])
  const { ferramentas, executadas } = ferramentasDe()
  await executarTurno(ENTRADA, deps({ provider, ferramentas }))
  checar(executadas.length === 0, 'JSON válido mas não-objeto ("texto") também é recusado')
}

// ----------------------------------------------------------------------------
console.log('\n6. classificação de erro do provider')

{
  const { provider } = providerDe([new LlmRateLimitError(30_000)])
  const r = await executarTurno(ENTRADA, deps({ provider }))
  checar(r.tipo === 'aguardar', 'rate limit → aguardar (esperar É a reação certa, não é falha)', r)
  checar(r.tipo === 'aguardar' && r.esperarMs === 30_000, 'esperarMs repassado ao worker')
}

{
  const { provider, requisicoes } = providerDe([new LlmTimeoutError(60_000)])
  const r = await executarTurno(ENTRADA, deps({ provider }))
  checar(requisicoes.length === 2, 'timeout é retentado UMA vez', requisicoes.length)
  checar(r.tipo === 'escalar' && r.motivo === 'erro_provider', 'timeout persistente → escalar', r)
}

{
  // Timeout que passa na segunda: prova que a retentativa serve para algo.
  const { provider } = providerDe([new LlmTimeoutError(60_000), resposta({ conteudo: 'consegui' })])
  const r = await executarTurno(ENTRADA, deps({ provider }))
  checar(r.tipo === 'responder' && r.texto === 'consegui', 'timeout que passa na 2ª tentativa responde normalmente', r)
}

for (const [nome, erro] of [
  ['LlmRecusadoError', new LlmRecusadoError(401, 'chave inválida')],
  ['LlmConfiguracaoError', new LlmConfiguracaoError('falta env', 'OPENAI_API_KEY')],
  ['LlmBudgetExceededError', new LlmBudgetExceededError('conversa', 'teto atingido')],
  ['LlmProviderError', new LlmProviderError('502 bad gateway', 502)],
  ['erro desconhecido', new Error('algo imprevisto')],
] as const) {
  const { provider, requisicoes } = providerDe([erro as Error])
  const r = await executarTurno(ENTRADA, deps({ provider }))
  checar(r.tipo === 'escalar', `${nome} → escalar`, r)
  checar(requisicoes.length === 1, `${nome} NÃO é retentado`, requisicoes.length)
}

// ----------------------------------------------------------------------------
console.log('\n7. nenhum caminho termina em silêncio')

{
  const { provider } = providerDe([resposta({ motivoParada: 'content_filter', conteudo: 'parcial' })])
  const r = await executarTurno(ENTRADA, deps({ provider }))
  checar(r.tipo === 'escalar' && r.motivo === 'filtrado',
    'content_filter → escalar (não manda o parcial filtrado ao paciente)', r)
}

{
  const { provider } = providerDe([resposta({ conteudo: null })])
  const r = await executarTurno(ENTRADA, deps({ provider }))
  checar(r.tipo === 'escalar' && r.motivo === 'sem_texto', 'conteúdo null sem chamadas → escalar', r)
}

{
  const { provider } = providerDe([resposta({ conteudo: '   ' })])
  const r = await executarTurno(ENTRADA, deps({ provider }))
  checar(r.tipo === 'escalar' && r.motivo === 'sem_texto',
    'texto só de espaços → escalar (nunca enviar mensagem vazia)', r)
}

{
  const { provider } = providerDe([resposta({ motivoParada: 'length', conteudo: null })])
  const r = await executarTurno(ENTRADA, deps({ provider }))
  checar(r.tipo === 'escalar' && String(r.detalhe).includes('truncada'),
    'truncado sem texto → escalar dizendo que foi truncado', r)
}

// ----------------------------------------------------------------------------
console.log('\n8. interruptor de agendamento')

// O nome de cada função que chegou ao provider.
const nomesEnviados = (req: { ferramentas?: unknown } | undefined): string[] =>
  ((req?.ferramentas ?? []) as { function: { name: string } }[]).map(f => f.function.name)

{
  const { provider, requisicoes } = providerDe([resposta({ conteudo: 'oi' })])
  await executarTurno(ENTRADA, deps({ provider, agendamentoHabilitado: true }))
  const nomes = nomesEnviados(requisicoes[0])
  checar(nomes.length === 7, 'habilitado: as 6 de agenda + escalar_para_humano', nomes.length)
  checar(nomes.includes('agendar_sessao'), 'habilitado: a agenda está lá', nomes)
  checar(nomes.includes('escalar_para_humano'), 'habilitado: e chamar gente também', nomes)
}

{
  const { provider, requisicoes } = providerDe([resposta({ conteudo: 'oi' })])
  await executarTurno(ENTRADA, deps({ provider, agendamentoHabilitado: false }))
  const nomes = nomesEnviados(requisicoes[0])

  // O BOTÃO DE PÂNICO CONTINUA SENDO O PONTO. Antes isto afirmava
  // `ferramentas === undefined`; agora a lista nunca é vazia, então o que precisa
  // ser provado é mais específico e não mais frouxo: NENHUMA ferramenta de agenda
  // chega ao modelo. Se a asserção virasse só "tem uma ferramenta", uma de agenda
  // vazando para este ramo passaria despercebida.
  checar(
    nomes.every(n => !/agendar|reagendar|cancelar|horarios|especialidades|agendamentos/.test(n)),
    'desligado: NENHUMA ferramenta de agenda vai ao modelo (botão de pânico)',
    nomes,
  )
  // E a de chamar gente sobrevive ao interruptor: é justamente com o agendamento
  // desligado que a Maia mais precisa passar a conversa adiante.
  checar(nomes.length === 1 && nomes[0] === 'escalar_para_humano',
    'desligado: sobra só escalar_para_humano', nomes)
}

// ----------------------------------------------------------------------------
console.log('\n9. rastro das tool calls')

// O rastro existe porque "a IA ofereceu horário da unidade errada" era
// indiagnosticável: as tool calls morriam no array local deste laço. O que se
// precisa saber para consertar é O ARGUMENTO que o modelo passou — `unidade:
// null` é defeito de prompt, `unidade: 'Padre Miguel'` com resultado vazio é
// defeito de dados, e são consertos em lugares diferentes.

{
  const { provider } = providerDe([
    resposta({
      motivoParada: 'tool_calls',
      chamadas: [{
        id: 'c1',
        nome: 'consultar_horarios_disponiveis',
        // `observacao` é texto livre: entra aqui de propósito para provar que
        // NÃO chega ao rastro.
        argumentosJson: '{"terapiaId":3,"unidade":"Padre Miguel","limite":20,"observacao":"filho do Marcos, TEA nivel 2"}',
      }],
    }),
    resposta({ conteudo: 'Tenho terça às 9h em Padre Miguel.' }),
  ])
  const { ferramentas } = ferramentasDe({ ok: true, horarios: [{ data: '2026-09-01' }, { data: '2026-09-02' }] })

  const registros: RegistroChamadaFerramenta[] = []
  const r = await executarTurno(ENTRADA, deps({
    provider,
    ferramentas,
    aoChamarFerramenta: (reg) => registros.push(reg),
  }))

  checar(r.tipo === 'responder', 'o turno segue normalmente com rastro ligado', r)
  checar(registros.length === 1, 'uma chamada, um registro', registros.length)

  const reg = registros[0]!
  checar(reg.nome === 'consultar_horarios_disponiveis', 'grava o nome da ferramenta', reg.nome)
  checar(reg.iteracao === 1, 'grava a iteração', reg.iteracao)
  checar(reg.ok === true, 'grava o ok', reg.ok)
  checar(reg.motivo === null, 'sem motivo quando ok', reg.motivo)
  checar(reg.qtdItens === 2, 'conta os itens do resultado (2 horários)', reg.qtdItens)
  checar(typeof reg.duracaoMs === 'number', 'grava a duração', reg.duracaoMs)

  // O campo que responde a pergunta que motivou tudo isso.
  checar(reg.argumentos.unidade === 'Padre Miguel',
    'grava a unidade pedida — é o campo que distingue defeito de prompt de defeito de dados',
    reg.argumentos)
  checar(reg.argumentos.terapiaId === 3, 'grava terapiaId', reg.argumentos)
  checar(reg.argumentos.limite === 20, 'grava limite', reg.argumentos)

  // A allowlist. Texto livre digitado pelo responsável não pode ir para uma
  // tabela de auditoria append-only sem retenção.
  checar(!('observacao' in reg.argumentos),
    'observacao NÃO é gravada (allowlist: texto livre pode ter dado de paciente)',
    reg.argumentos)
}

{
  // Recusa: o rastro precisa mostrar o motivo, senão "não achou" e "recusou"
  // ficam indistinguíveis.
  const { provider } = providerDe([
    resposta({
      motivoParada: 'tool_calls',
      chamadas: [{ id: 'c1', nome: 'consultar_horarios_disponiveis', argumentosJson: '{"unidade":"Realengo"}' }],
    }),
    resposta({ conteudo: 'Não temos vaga em Realengo.' }),
  ])
  const { ferramentas } = ferramentasDe({ ok: false, motivo: 'sem_vaga', mensagem: 'Nada livre.' })

  const registros: RegistroChamadaFerramenta[] = []
  await executarTurno(ENTRADA, deps({ provider, ferramentas, aoChamarFerramenta: (r) => registros.push(r) }))

  checar(registros[0]?.ok === false, 'recusa grava ok false', registros[0])
  checar(registros[0]?.motivo === 'sem_vaga', 'recusa grava o motivo', registros[0]?.motivo)
  // Sem array no resultado: null, não 0. Forçar 0 faria "recusou" parecer
  // "achou zero", que é justamente a distinção que se quer no diagnóstico.
  checar(registros[0]?.qtdItens === null, 'recusa não inventa contagem (null, não 0)', registros[0]?.qtdItens)
}

{
  // Falha no rastro NÃO derruba o turno. O paciente não pode ficar sem
  // resposta no WhatsApp por causa de um insert de auditoria.
  const { provider } = providerDe([
    resposta({
      motivoParada: 'tool_calls',
      chamadas: [{ id: 'c1', nome: 'consultar_horarios_disponiveis', argumentosJson: '{}' }],
    }),
    resposta({ conteudo: 'Tenho terça às 9h.' }),
  ])
  const { ferramentas } = ferramentasDe({ ok: true, horarios: [] })

  const r = await executarTurno(ENTRADA, deps({
    provider,
    ferramentas,
    aoChamarFerramenta: () => { throw new Error('banco fora do ar') },
  }))

  checar(r.tipo === 'responder' && r.texto === 'Tenho terça às 9h.',
    'callback que lança não derruba o turno', r)
}

{
  // Argumentos inválidos também deixam rastro: é o caso em que o modelo mandou
  // JSON quebrado, e sem registro ele fica invisível no diagnóstico.
  const { provider } = providerDe([
    resposta({
      motivoParada: 'tool_calls',
      chamadas: [{ id: 'c1', nome: 'consultar_horarios_disponiveis', argumentosJson: '{quebrado' }],
    }),
    resposta({ conteudo: 'Deixa eu verificar.' }),
  ])

  const registros: RegistroChamadaFerramenta[] = []
  await executarTurno(ENTRADA, deps({ provider, aoChamarFerramenta: (r) => registros.push(r) }))

  checar(registros[0]?.motivo === 'argumentos_invalidos',
    'JSON inválido é registrado como tal', registros[0])
  checar(registros[0]?.ok === false, 'JSON inválido grava ok false', registros[0]?.ok)
}

{
  // Sem callback, nada muda: é o caminho de todo teste existente e de qualquer
  // chamador que não queira rastro.
  const { provider } = providerDe([resposta({ conteudo: 'oi' })])
  const r = await executarTurno(ENTRADA, deps({ provider }))
  checar(r.tipo === 'responder', 'sem callback o turno funciona igual', r)
}

// ----------------------------------------------------------------------------
console.log(
  falhas === 0
    ? '\nTodas as asserções passaram.\n'
    : `\n${falhas} asserção(ões) falharam.\n`,
)
process.exit(falhas === 0 ? 0 : 1)
