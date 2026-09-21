// Verifica o contrato que as ferramentas expõem à OpenAI. Não toca banco, não
// chama LLM: é tudo em memória, então roda sem stack local.
//
//   npx tsx modules/atendimento/agente/contrato-openai.test.mts
//
// Duas garantias da Fase 1 são provadas aqui:
//
//   1. Os 6 schemas obedecem ao strict mode. Se a API recusar um schema, o
//      turno inteiro morre — e o sintoma chega como "a atendente não respondeu",
//      longe da causa. Barato provar antes.
//
//   2. Identificador de contexto vindo do modelo NÃO chega ao serviço. Esta é a
//      defesa que impede uma mensagem de WhatsApp de operar sobre outra
//      organização, e ela precisa de teste porque o caminho do agente roda com
//      service role, sem RLS para segurar o erro.
//
// Sem framework, como os outros testes do módulo: sai com código 1 na primeira
// asserção falha.

import { DEFINICOES_FERRAMENTAS, FERRAMENTAS_SEMPRE, FerramentasAgente } from './ferramentas.js'
import { UNIDADES } from './unidade.js'
import type { AppointmentService } from '../services/appointment.service.js'
import type { AppointmentRepository } from '../repositories/appointment.repository.js'

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

const ORG_REAL     = 'a0000000-0000-0000-0000-000000000001'
const ORG_INVASORA = 'ffffffff-ffff-ffff-ffff-ffffffffffff'

// ----------------------------------------------------------------------------
console.log('\n1. os 7 schemas são válidos em strict mode')

checar(DEFINICOES_FERRAMENTAS.length === 6, 'são 6 ferramentas de agenda', DEFINICOES_FERRAMENTAS.length)
checar(FERRAMENTAS_SEMPRE.length === 1, 'e 1 que não depende do interruptor', FERRAMENTAS_SEMPRE.length)

// Os DOIS arrays passam pelo mesmo crivo. Validar só as de agenda deixaria a
// ferramenta que sempre vai ao modelo sem nenhuma verificação de strict mode — e
// um schema inválido derruba o turno INTEIRO, inclusive as chamadas que nada têm
// a ver com ela.
const TODAS_AS_FERRAMENTAS = [...DEFINICOES_FERRAMENTAS, ...FERRAMENTAS_SEMPRE]

// Nome repetido entre os dois arrays faria a OpenAI recusar a requisição inteira,
// e o sintoma chegaria como "a atendente parou de responder".
{
  const nomes = TODAS_AS_FERRAMENTAS.map(d => d.function.name)
  checar(new Set(nomes).size === nomes.length, 'nenhum nome de ferramenta repetido', nomes)
}

for (const definicao of TODAS_AS_FERRAMENTAS) {
  const fn = definicao.function
  const params = fn.parameters as {
    type: string
    properties: Record<string, unknown>
    required: readonly string[]
    additionalProperties?: boolean
  }

  checar(fn.strict === true, `${fn.name}: strict: true`)
  checar(
    params.additionalProperties === false,
    `${fn.name}: additionalProperties: false`,
    params.additionalProperties,
  )

  // A regra que mais pega: em strict mode TODA propriedade precisa estar em
  // `required`. O opcional se expressa como tipo anulável, não como ausência.
  const propriedades = Object.keys(params.properties).sort()
  const obrigatorias = [...params.required].sort()
  checar(
    JSON.stringify(propriedades) === JSON.stringify(obrigatorias),
    `${fn.name}: toda propriedade está em required`,
    { propriedades, obrigatorias },
  )

  // Nenhum schema pode declarar identificador de contexto: é o que faz a API
  // recusar o argumento antes de ele chegar ao runtime.
  const proibidas = propriedades.filter(p =>
    /^(org|organization|contact|conversation|actor)/i.test(p) || /paciente_?id$/i.test(p),
  )
  checar(
    proibidas.length === 0,
    `${fn.name}: não declara identificador de contexto`,
    proibidas,
  )
}

// ----------------------------------------------------------------------------
console.log('\n2. identificador de contexto vindo do modelo é descartado')

// Stub que registra com que orgId o serviço foi chamado. Só os métodos que as
// ferramentas exercitam neste teste.
const chamadas: { orgId: string; input: Record<string, unknown> }[] = []

const servicoFalso = {
  async agendarVaga(orgId: string, input: Record<string, unknown>) {
    chamadas.push({ orgId, input })
    return {
      id: 'agendamento-1',
      date: '2026-09-01',
      time: '09:00:00',
      duration: 40,
      profissional_nome: 'Fulano',
      terapia_nome: 'Fonoaudiologia',
      sala_nome: 'Sala 1',
    }
  },
} as unknown as AppointmentService

const repoFalso = {} as AppointmentRepository

const ferramentas = new FerramentasAgente(servicoFalso, repoFalso, {
  orgId:          ORG_REAL,
  contactId:      'contato-real',
  conversationId: 'conversa-real',
  titaPacienteId: 12345,
})

// O modelo tenta injetar contexto de outra organização junto dos argumentos
// legítimos — exatamente o que uma mensagem maliciosa no WhatsApp tentaria
// induzir.
const resultado = await ferramentas.executar('agendar_sessao', {
  profissionalId: 2270,
  data:           '2026-09-01',
  hora:           '09:00',
  tipo:           'triagem',
  observacao:     null,
  // injeção:
  orgId:           ORG_INVASORA,
  organization_id: ORG_INVASORA,
  contactId:       'contato-invasor',
  conversationId:  'conversa-invasora',
  titaPacienteId:  99999,
  criadoPorIa:     false,
})

checar(resultado.ok === true, 'a ferramenta executou', resultado)
checar(chamadas.length === 1, 'o serviço foi chamado uma vez', chamadas.length)

const chamada = chamadas[0]
checar(chamada?.orgId === ORG_REAL, 'orgId veio do runtime, não do modelo', chamada?.orgId)
checar(
  chamada?.input.contactId === 'contato-real',
  'contactId veio do runtime',
  chamada?.input.contactId,
)
checar(
  chamada?.input.conversationId === 'conversa-real',
  'conversationId veio do runtime',
  chamada?.input.conversationId,
)
checar(
  chamada?.input.titaPacienteId === 12345,
  'titaPacienteId veio do runtime',
  chamada?.input.titaPacienteId,
)
// O modelo mandou criadoPorIa: false tentando se disfarçar de operador humano.
checar(
  chamada?.input.criadoPorIa === true,
  'criadoPorIa continua true — o modelo não consegue forjar procedência',
  chamada?.input.criadoPorIa,
)
// Os argumentos legítimos precisam sobreviver ao filtro.
checar(chamada?.input.profissionalId === 2270, 'argumento legítimo preservado')
checar(chamada?.input.data === '2026-09-01', 'data legítima preservada')

// ----------------------------------------------------------------------------
console.log('\n3. null explícito do strict mode é tratado como ausência')

// Em strict mode o modelo manda `null` em vez de omitir. O executor precisa
// tratar os dois do mesmo jeito, senão cada campo opcional vira um erro.
chamadas.length = 0
const comNulos = await ferramentas.executar('agendar_sessao', {
  profissionalId: 2270,
  data:           '2026-09-01',
  hora:           '09:00',
  tipo:           null,
  observacao:     null,
})

checar(comNulos.ok === true, 'tipo e observacao nulos não quebram', comNulos)
checar(chamadas[0]?.input.tipo === 'other', "tipo null vira 'other'", chamadas[0]?.input.tipo)
checar(chamadas[0]?.input.descricao === null, 'observacao null vira descricao null')

// ----------------------------------------------------------------------------
console.log('\n4. o enum de unidade é o mesmo vocabulário que o banco valida')

// Desde 20260904100100 o `p_unidade` da RPC LANÇA (22023) em valor
// desconhecido. Se o enum daqui divergir dos três literais de UNIDADES, o
// modelo passa um valor que o banco recusa — e o sintoma chega como erro de
// servidor numa conversa de WhatsApp, longe da causa. O enum é declarado como
// [...UNIDADES, null] exatamente para não poder divergir; este check é o que
// prova que ninguém voltou a escrever os literais à mão.
const horariosFn = DEFINICOES_FERRAMENTAS
  .find(d => d.function.name === 'consultar_horarios_disponiveis')?.function

const unidadeSchema = (horariosFn?.parameters as {
  properties?: Record<string, { enum?: unknown[] }>
} | undefined)?.properties?.unidade

checar(unidadeSchema !== undefined, 'consultar_horarios_disponiveis declara `unidade`')
checar(
  JSON.stringify(unidadeSchema?.enum) === JSON.stringify([...UNIDADES, null]),
  'o enum de unidade é exatamente [...UNIDADES, null]',
  { schema: unidadeSchema?.enum, esperado: [...UNIDADES, null] },
)

// O null tem que estar DENTRO do array de enum: em strict mode com tipo
// anulável é assim que "buscar nas três" fica representável. Sem ele o modelo
// não tem como dizer "sem preferência de unidade" e passa uma unidade
// arbitrária.
checar(
  unidadeSchema?.enum?.includes(null) === true,
  'null está dentro do enum (é como o modelo diz "sem preferência")',
  unidadeSchema?.enum,
)

// ----------------------------------------------------------------------------
if (falhas > 0) {
  console.error(`\n${falhas} ASSERÇÃO(ÕES) FALHARAM`)
  process.exit(1)
}
console.log('\nTODOS OS TESTES PASSARAM')
