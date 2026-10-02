// Reproduz o laço de agendamento de 21/09/2026 e prova que a recusa nova o
// quebra.
//
//   npx tsx --conditions react-server modules/atendimento/agente/agendar-vaga-oferecida.test.mts
//
// O INCIDENTE, COMO ELE ACONTECEU
//
// O responsável pediu fono em Realengo. A Maia listou duas vagas para terça:
// 10:00 com Germana (profissionalId 14497) e 10:40 com Thais (8704). Ele
// escolheu 10:40 e disse "sim". Então:
//
//   15:21:04  agendar_sessao {"tipo":"triagem","profissionalId":1} -> vaga_inexistente
//   15:21:07  consultar_horarios_disponiveis                       -> ok (mesma lista)
//   15:21:57  agendar_sessao {"tipo":"triagem","profissionalId":1} -> vaga_inexistente
//   15:21:59  consultar_horarios_disponiveis                       -> ok (mesma lista)
//
// Nunca foi agendado. O detector de laço do orquestrador não pega isto: ele
// compara assinaturas DENTRO de um turno, e cada tentativa veio num turno
// diferente, separada por uma mensagem do responsável.
//
// A causa não foi o modelo "desobedecer": a recusa antiga dizia "consulte os
// horários novamente e use exatamente um deles" — exatamente o que ele
// acreditava estar fazendo. Uma recusa que não diz QUAL campo está errado não é
// acionável, e mandar repetir a ação que falhou alimenta o laço.

import { FerramentasAgente } from './ferramentas.js'
import type { VagaOferecida } from './vagas-oferecidas.js'

let falhas = 0
function ok(condicao: boolean, oque: string, extra?: unknown) {
  if (condicao) { console.log(`  ok   ${oque}`); return }
  falhas++
  console.error(`  FALHA ${oque}`)
  if (extra !== undefined) console.error('        ', extra)
}

// As duas vagas reais daquele dia, conferidas contra a RPC em produção.
const VAGAS = [
  { data: '2026-09-22', hora_inicial: '10:00:00', hora_final: '10:40:00', profissional_id: 14497,
    profissional_nome: 'Germana Santos da Silva', terapia_id: 1, terapia_nome: 'Fonoaudiologia',
    dia_semana: 'terça-feira', sala_nome: 'REA 01', unidade: 'Realengo',
    unidade_id: 280, unidade_nome: 'CLÍNICA UNIVERSO ABA' },
  { data: '2026-09-22', hora_inicial: '10:40:00', hora_final: '11:20:00', profissional_id: 8704,
    profissional_nome: 'Thais Liberato Silva', terapia_id: 1, terapia_nome: 'Fonoaudiologia',
    dia_semana: 'terça-feira', sala_nome: 'REA 02', unidade: 'Realengo',
    unidade_id: 280, unidade_nome: 'CLÍNICA UNIVERSO ABA' },
]

let agendouDeVerdade = 0

function montar(vagasAnteriores: VagaOferecida[] = []) {
  agendouDeVerdade = 0
  const service = {
    listarVagas: async () => VAGAS,
    listarNomesDeTerapiaComVaga: async () => ['Fonoaudiologia'],
    agendarVaga: async () => {
      agendouDeVerdade++
      return {
        id: 'ag-1', date: '2026-09-22', time: '10:40:00', duration: 40,
        profissional_nome: 'Thais Liberato Silva', terapia_nome: 'Fonoaudiologia',
        sala_nome: 'REA 02',
      }
    },
  }
  return new FerramentasAgente(
    service as never,
    {} as never,
    { orgId: 'o-1', contactId: 'c-1', conversationId: 'cv-1' },
    null, null, null,
    vagasAnteriores,
  )
}

// O que o turno anterior teria guardado em ai_context depois de listar as duas
// vagas de terça (mesmo formato que `estadoDasVagas` devolve).
const GUARDADAS: VagaOferecida[] = [
  { profissionalId: 14497, data: '2026-09-22', hora: '10:00', profissional: 'Germana Santos da Silva',
    diaSemana: 'terça-feira', terapia: 'Fonoaudiologia', unidade: 'Realengo' },
  { profissionalId: 8704, data: '2026-09-22', hora: '10:40', profissional: 'Thais Liberato Silva',
    diaSemana: 'terça-feira', terapia: 'Fonoaudiologia', unidade: 'Realengo' },
]

// Sem `terapia`: o filtro por especialidade passa pelo catálogo (terapia.ts),
// que resolve contra o que a grade real devolve — e o objetivo aqui é a
// conferência de vaga, não a resolução de nome, que já tem teste próprio.
const CONSULTA = {
  terapia: null, unidade: 'Realengo',
  dataInicio: '2026-09-22', dataFim: '2026-09-22', limite: 5,
}

console.log('\n1. o id inventado é recusado ANTES do banco, e a recusa diz o id certo')

{
  const f = montar()
  await f.executar('consultar_horarios_disponiveis', CONSULTA)

  // A chamada exata do incidente.
  const r = await f.executar('agendar_sessao', {
    profissionalId: 1, data: '2026-09-22', hora: '10:40', tipo: 'triagem', observacao: null,
  })

  ok(r.ok === false, 'a chamada com profissionalId 1 é recusada')
  ok(agendouDeVerdade === 0, 'e NÃO chega ao banco — a conferência é local')

  const msg = (r as { mensagem: string }).mensagem
  ok(/8704/.test(msg), 'a recusa diz o profissionalId CERTO (8704)', msg)
  ok(/Thais/.test(msg), 'e o nome de quem atende, para a Maia poder confirmar', msg)

  // O ponto que quebra o laço: a recusa antiga mandava reconsultar, e o modelo
  // reconsultava, via a mesma lista e repetia o erro.
  ok(
    !/consulte os horários disponíveis novamente/i.test(msg),
    'e NÃO manda reconsultar — era isso que realimentava o laço',
    msg,
  )
  ok(/sem consultar os horários outra vez/i.test(msg), 'manda explicitamente NÃO reconsultar', msg)
}

console.log('\n2. a vaga legítima continua passando')

{
  const f = montar()
  await f.executar('consultar_horarios_disponiveis', CONSULTA)

  const r = await f.executar('agendar_sessao', {
    profissionalId: 8704, data: '2026-09-22', hora: '10:40', tipo: 'triagem', observacao: null,
  })

  ok(r.ok === true, 'o id correto agenda', r)
  ok(agendouDeVerdade === 1, 'e chega ao banco uma vez', agendouDeVerdade)
}

console.log('\n3. dia/hora que nunca foram oferecidos: lista o que existe')

{
  const f = montar()
  await f.executar('consultar_horarios_disponiveis', CONSULTA)

  const r = await f.executar('agendar_sessao', {
    profissionalId: 8704, data: '2026-09-25', hora: '15:00', tipo: 'triagem', observacao: null,
  })

  ok(r.ok === false, 'data não oferecida é recusada')
  const msg = (r as { mensagem: string }).mensagem
  ok(/2026-09-22/.test(msg), 'a recusa mostra as vagas que de fato foram oferecidas', msg)
  ok(agendouDeVerdade === 0, 'sem ida ao banco')
}

console.log('\n4. sem consulta no turno, o banco decide (comportamento anterior preservado)')

{
  // Caso legítimo: o responsável escolhe, no turno seguinte, uma vaga listada
  // antes. Sem lista neste turno não há com o que comparar, e barrar aqui
  // recusaria um agendamento válido.
  const f = montar()
  const r = await f.executar('agendar_sessao', {
    profissionalId: 8704, data: '2026-09-22', hora: '10:40', tipo: 'triagem', observacao: null,
  })

  ok(r.ok === true, 'sem consulta prévia, a chamada segue para o banco', r)
  ok(agendouDeVerdade === 1, 'e o banco é quem valida', agendouDeVerdade)
}

console.log('\n5. duas consultas no mesmo turno acumulam')

{
  const f = montar()
  await f.executar('consultar_horarios_disponiveis', CONSULTA)
  await f.executar('consultar_horarios_disponiveis', { ...CONSULTA, dataInicio: '2026-09-23', dataFim: '2026-09-23' })

  // A vaga da PRIMEIRA lista continua válida: o responsável pode voltar atrás e
  // escolher a de terça depois de ver a de quarta.
  const r = await f.executar('agendar_sessao', {
    profissionalId: 8704, data: '2026-09-22', hora: '10:40', tipo: 'triagem', observacao: null,
  })
  ok(r.ok === true, 'a vaga da primeira consulta ainda é aceita na segunda', r)
}

console.log('\n6. a lista do turno anterior confere o id sem reconsulta (teste do Comercial, 01/10)')

{
  // O turno do "15h": o responsável escolheu, e este turno NÃO consultou.
  // Antes, a lista estava vazia e o id inventado ia direto ao banco.
  const f = montar(GUARDADAS)
  const r = await f.executar('agendar_sessao', {
    profissionalId: 1, data: '2026-09-22', hora: '10:40', tipo: 'triagem', observacao: null,
  })
  ok(r.ok === false, 'o id inventado é recusado mesmo sem consulta neste turno')
  ok(agendouDeVerdade === 0, 'sem ida ao banco')
  ok(/8704/.test((r as { mensagem: string }).mensagem), 'e a recusa diz o id certo, vindo da lista guardada', r)

  const certo = await f.executar('agendar_sessao', {
    profissionalId: 8704, data: '2026-09-22', hora: '10:40', tipo: 'triagem', observacao: null,
  })
  ok(certo.ok === true, 'o id da lista guardada agenda direto', certo)
}

console.log('\n7. o estado das vagas diz ao worker o que gravar')

{
  const semMexer = montar(GUARDADAS)
  ok(semMexer.estadoDasVagas().mudou === false, 'turno que não consultou nem reservou não regrava')
  ok(semMexer.estadoDasVagas().vagas.length === 2, 'e a lista guardada continua inteira')

  const consultou = montar()
  await consultou.executar('consultar_horarios_disponiveis', CONSULTA)
  const e1 = consultou.estadoDasVagas()
  ok(e1.mudou && e1.consultouNesteTurno, 'consulta marca mudança e renova a data da consulta')
  ok(e1.vagas.some((v) => v.profissionalId === 8704 && v.unidade === 'Realengo' && v.diaSemana === 'terça-feira'),
    'e guarda unidade e dia da semana, que o modelo usa para reconhecer "o de terça"', e1.vagas)

  const reservou = montar(GUARDADAS)
  await reservou.executar('agendar_sessao', {
    profissionalId: 8704, data: '2026-09-22', hora: '10:40', tipo: 'triagem', observacao: null,
  })
  const e2 = reservou.estadoDasVagas()
  ok(e2.mudou && !e2.consultouNesteTurno, 'reserva marca mudança sem fingir consulta nova')
  ok(!e2.vagas.some((v) => v.profissionalId === 8704), 'a vaga reservada sai da lista', e2.vagas)
  ok(e2.vagas.some((v) => v.profissionalId === 14497), 'e a outra fica', e2.vagas)
}

console.log(falhas === 0 ? '\nTodos os testes passaram.' : `\n${falhas} teste(s) FALHARAM.`)
process.exit(falhas === 0 ? 0 : 1)
