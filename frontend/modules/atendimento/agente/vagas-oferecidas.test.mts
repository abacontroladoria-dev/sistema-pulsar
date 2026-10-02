// Verifica a leitura e a gravação das vagas que atravessam o turno.
//
//   npx tsx modules/atendimento/agente/vagas-oferecidas.test.mts
//
// O QUE SE PROVA, E POR QUE IMPORTA
//
// `conversations.ai_context` é jsonb sem schema: o que sai dele vira argumento
// de `agendar_sessao`. Por isso a leitura é desconfiada — item fora do formato
// some em vez de chegar ao modelo — e a lista tem prazo: uma lista velha
// mostrada como atual faria a Maia oferecer horário que talvez nem exista mais.

import {
  lerVagasGuardadas, paraGuardar, mesclarAiContext,
  CHAVE_AI_CONTEXT, TETO_VAGAS, type VagaOferecida,
} from './vagas-oferecidas.js'

let falhas = 0
function ok(condicao: boolean, oque: string, extra?: unknown) {
  if (condicao) { console.log(`  ok   ${oque}`); return }
  falhas++
  console.error(`  FALHA ${oque}`)
  if (extra !== undefined) console.error('        ', extra)
}

// 02/10/2026, 10h em São Paulo.
const AGORA = '2026-10-02T13:00:00Z'

function vaga(over: Partial<VagaOferecida> = {}): VagaOferecida {
  return {
    profissionalId: 8704, data: '2026-10-06', hora: '15:00',
    profissional: 'Thais Liberato Silva', diaSemana: 'terça-feira',
    terapia: 'Fonoaudiologia', unidade: 'Realengo',
    ...over,
  }
}

function contexto(vagas: unknown[], consultadoEm = '2026-10-02T12:00:00Z'): unknown {
  return { [CHAVE_AI_CONTEXT]: { consultadoEm, vagas } }
}

console.log('\n1. nada guardado, nada lido')

{
  ok(lerVagasGuardadas(null, AGORA) === null, 'ai_context null')
  ok(lerVagasGuardadas({}, AGORA) === null, 'ai_context sem a chave')
  ok(lerVagasGuardadas('texto', AGORA) === null, 'ai_context que não é objeto')
  ok(lerVagasGuardadas([vaga()], AGORA) === null, 'ai_context que é array')
  ok(lerVagasGuardadas({ [CHAVE_AI_CONTEXT]: { vagas: [vaga()] } }, AGORA) === null, 'sem consultadoEm')
}

console.log('\n2. a lista guardada volta igual')

{
  const lida = lerVagasGuardadas(contexto([vaga()]), AGORA)
  ok(lida !== null && lida.vagas.length === 1, 'uma vaga guardada, uma vaga lida', lida)
  ok(lida?.vagas[0]?.profissionalId === 8704, 'com o profissionalId intacto — é ele que vai para agendar_sessao')
  ok(lida?.consultadoEm === '2026-10-02T12:00:00Z', 'e a data da consulta')
}

console.log('\n3. item fora do formato não chega ao modelo')

{
  const lida = lerVagasGuardadas(contexto([
    vaga(),
    vaga({ profissionalId: 1.5 as number }),
    { ...vaga(), profissionalId: '8704' },
    vaga({ data: '06/10/2026' }),
    vaga({ hora: '15h' }),
    'lixo',
    null,
  ]), AGORA)
  ok(lida?.vagas.length === 1, 'só a vaga bem formada sobrevive', lida?.vagas)
}

console.log('\n4. a lista tem prazo')

{
  ok(
    lerVagasGuardadas(contexto([vaga()], '2026-09-30T12:00:00Z'), AGORA) === null,
    'consultada há dois dias: vencida',
  )
  ok(
    lerVagasGuardadas(contexto([vaga()], '2026-10-01T14:00:00Z'), AGORA) !== null,
    'consultada há 23 horas: ainda vale',
  )
}

console.log('\n5. vaga de dia que já passou sai da lista')

{
  const lida = lerVagasGuardadas(contexto([vaga({ data: '2026-10-01' }), vaga()]), AGORA)
  ok(lida?.vagas.length === 1 && lida.vagas[0]!.data === '2026-10-06', 'ontem sai, terça fica', lida?.vagas)
  ok(
    lerVagasGuardadas(contexto([vaga({ data: '2026-10-01' })]), AGORA) === null,
    'se só sobrava vaga passada, não há lista',
  )
}

console.log('\n6. gravar: sem repetidas, sem vaga sem hora, com teto')

{
  const g = paraGuardar([vaga(), vaga({ hora: '' }), vaga()], AGORA)
  ok(g?.vagas.length === 1, 'a mesma vaga consultada duas vezes conta uma; a sem hora some', g?.vagas)

  const muitas = Array.from({ length: TETO_VAGAS + 5 }, (_, i) =>
    vaga({ profissionalId: 10000 + i }))
  const t = paraGuardar(muitas, AGORA)
  ok(t?.vagas.length === TETO_VAGAS, `no máximo ${TETO_VAGAS}`, t?.vagas.length)
  ok(t?.vagas[0]?.profissionalId === 10005, 'ficam as mais recentes', t?.vagas[0])

  ok(paraGuardar([], AGORA) === null, 'lista vazia vira null — o sinal para apagar a chave')
}

console.log('\n7. mesclar preserva o resto do ai_context')

{
  const antes = { outra_coisa: 1, [CHAVE_AI_CONTEXT]: { consultadoEm: AGORA, vagas: [] } }
  const g = paraGuardar([vaga()], AGORA)

  const depois = mesclarAiContext(antes, g)
  ok(depois.outra_coisa === 1, 'a outra chave continua lá')
  ok((depois[CHAVE_AI_CONTEXT] as { vagas: unknown[] }).vagas.length === 1, 'e a de vagas foi trocada')

  const apagado = mesclarAiContext(antes, null)
  ok(!(CHAVE_AI_CONTEXT in apagado) && apagado.outra_coisa === 1, 'null apaga só a chave de vagas')

  ok(Object.keys(mesclarAiContext(null, null)).length === 0, 'ai_context null vira objeto vazio')
}

console.log(falhas === 0 ? '\nTodos os testes passaram.' : `\n${falhas} teste(s) FALHARAM.`)
process.exit(falhas === 0 ? 0 : 1)
