// npx tsx modules/atendimento/agente/espera.test.mts
//
// Sem framework, como o resto dos testes do módulo.

import { tempoDeEspera, esperaCritica } from './espera.js'

let falhas = 0

const AGORA = new Date('2026-09-16T12:00:00Z').getTime()
const atras = (ms: number) => new Date(AGORA - ms).toISOString()

const MIN = 60_000
const H   = 60 * MIN
const D   = 24 * H

function checar(nome: string, obtido: unknown, esperado: unknown) {
  if (obtido === esperado) { console.log(`  ok   ${nome}`); return }
  console.log(`  FALHA ${nome}: esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`)
  falhas++
}

console.log('\ntempoDeEspera')
checar('sem data',            tempoDeEspera(null, AGORA),           '—')
checar('data inválida',       tempoDeEspera('nada', AGORA),         '—')
checar('poucos segundos',     tempoDeEspera(atras(5_000), AGORA),   'agora')
// Relógios discordam — o Postgres pode estar meio segundo à frente do navegador.
// Isso não pode virar número negativo na tela.
checar('futuro por relógio',  tempoDeEspera(atras(-3_000), AGORA),  'agora')
checar('1 minuto',            tempoDeEspera(atras(MIN), AGORA),     '1min')
checar('47 minutos',          tempoDeEspera(atras(47 * MIN), AGORA),'47min')
checar('beira da hora',       tempoDeEspera(atras(H - 1), AGORA),   '59min')
checar('1h em ponto',         tempoDeEspera(atras(H), AGORA),       '1h00')
checar('4h02',                tempoDeEspera(atras(4 * H + 2 * MIN), AGORA), '4h02')
// Acima de 10h o minuto sai: o caso já é grave e o dígito extra só polui.
checar('11h perde o minuto',  tempoDeEspera(atras(11 * H + 30 * MIN), AGORA), '11h')
checar('beira do dia',        tempoDeEspera(atras(D - 1), AGORA),   '23h')
checar('1 dia, singular',     tempoDeEspera(atras(D), AGORA),       '1 dia')
checar('3 dias',              tempoDeEspera(atras(3 * D), AGORA),   '3 dias')

console.log('\nesperaCritica')
checar('sem data não alarma', esperaCritica(null, AGORA),           false)
checar('59min ainda não',     esperaCritica(atras(59 * MIN), AGORA), false)
checar('1h alarma',           esperaCritica(atras(H), AGORA),        true)
checar('2 dias alarma',       esperaCritica(atras(2 * D), AGORA),    true)

console.log(falhas === 0 ? '\nTudo certo.\n' : `\n${falhas} falha(s).\n`)
process.exit(falhas === 0 ? 0 : 1)
