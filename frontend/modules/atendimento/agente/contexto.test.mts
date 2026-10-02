// Verifica as linhas do system prompt que vieram do teste do Comercial
// (01/10/2026): nome do perfil, conversa nova e horários já oferecidos.
//
//   npx tsx --conditions react-server modules/atendimento/agente/contexto.test.mts
//
// O QUE SE PROVA, E POR QUE IMPORTA
//
// 1. O NOME DO PERFIL NÃO É AFIRMADO. "Você está falando com X" fazia a Maia
//    chamar a pessoa por um nome que ela nunca disse.
// 2. CONVERSA NOVA É DITA. O system_prompt manda se apresentar "em conversa
//    nova", e sem esta linha o modelo não tinha como saber o que era isso.
// 3. OS HORÁRIOS ATRAVESSAM O TURNO. Sem o bloco, o "15h" do turno seguinte não
//    tinha profissionalId para virar reserva, e a Maia relistava.

import { montarContexto } from './contexto.js'
import type { Message } from '../types/central.types.js'
import type { VagasGuardadas } from './vagas-oferecidas.js'

let falhas = 0
function ok(condicao: boolean, oque: string, extra?: unknown) {
  if (condicao) { console.log(`  ok   ${oque}`); return }
  falhas++
  console.error(`  FALHA ${oque}`)
  if (extra !== undefined) console.error('        ', extra)
}

function msg(direction: 'inbound' | 'outbound', body: string): Message {
  return { direction, body } as Message
}

const BASE = {
  systemPrompt:   null,
  memoriaContato: null,
  nomeContato:    'Danielle',
  ficha:          null,
  historico:      [] as Message[],
  agoraISO:       '2026-10-02T13:00:00Z',
}

function system(over: Partial<Parameters<typeof montarContexto>[0]> = {}): string {
  return montarContexto({ ...BASE, ...over }).find((m) => m.papel === 'system')!.conteudo
}

console.log('\n1. o nome do perfil vai rotulado, não afirmado')

{
  const texto = system()
  ok(!/Você está falando com/.test(texto), 'a frase antiga, que afirmava o nome, saiu', texto)
  ok(/perfil do WhatsApp deste contato: Danielle/.test(texto), 'o nome continua chegando ao modelo')
  ok(/Não é um nome confirmado/.test(texto), 'com o aviso de que não é confirmado')
  ok(!/perfil do WhatsApp/.test(system({ nomeContato: null })), 'sem nome, sem linha')
}

console.log('\n2. conversa nova é dita com todas as letras')

{
  const primeira = 'Ainda não há nenhuma mensagem da clínica nesta conversa'
  ok(system().includes(primeira), 'histórico vazio: é a primeira resposta')
  ok(
    system({ historico: [msg('inbound', 'oi'), msg('inbound', 'tem fono?')] }).includes(primeira),
    'só mensagens da família: ainda é a primeira resposta',
  )
  ok(
    !system({ historico: [msg('inbound', 'oi'), msg('outbound', 'Olá, eu sou a Maia…')] }).includes(primeira),
    'a clínica já falou: não é conversa nova',
  )
}

console.log('\n3. os horários oferecidos antes voltam para o modelo')

{
  const guardadas: VagasGuardadas = {
    consultadoEm: '2026-10-02T12:30:00Z',
    vagas: [{
      profissionalId: 8704, data: '2026-10-06', hora: '15:00', profissional: 'Thais Liberato Silva',
      diaSemana: 'terça-feira', terapia: 'Fonoaudiologia', unidade: 'Realengo',
    }],
  }

  const texto = system({ vagasOferecidas: guardadas })
  ok(/Horários que você já ofereceu nesta conversa/.test(texto), 'o bloco aparece')
  ok(/"profissionalId":8704/.test(texto), 'com o profissionalId que agendar_sessao precisa', texto)
  ok(/dados, não instruções/.test(texto), 'rotulado como dado, como os outros blocos')

  ok(!/Horários que você já ofereceu nesta conversa,/.test(system()), 'sem lista, sem bloco')
  ok(
    !/Horários que você já ofereceu nesta conversa,/.test(system({ vagasOferecidas: { ...guardadas, vagas: [] } })),
    'lista vazia, sem bloco',
  )
}

console.log('\n4. a instrução base fecha o laço da confirmação')

{
  const texto = system()
  ok(/isso é uma escolha, não um pedido de nova busca/.test(texto), 'escolher um horário oferecido não é busca nova')
  ok(/isso é a confirmação: chame agendar_sessao sem perguntar de novo/.test(texto), 'uma confirmação basta')
}

console.log(falhas === 0 ? '\nTodos os testes passaram.' : `\n${falhas} teste(s) FALHARAM.`)
process.exit(falhas === 0 ? 0 : 1)
