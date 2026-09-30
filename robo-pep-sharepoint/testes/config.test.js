const test = require('node:test')
const assert = require('node:assert/strict')
const { proximaExecucao, lerHorarios } = require('../lib/config')

const H = lerHorarios('04:00,12:00,15:00')

test('próxima execução em Brasília (UTC-3)', () => {
  // 30/09 10:00 BRT = 13:00 UTC → próxima 12:00 BRT = 15:00 UTC
  assert.equal(proximaExecucao(H, new Date('2026-09-30T13:00:00Z')).toISOString(), '2026-09-30T15:00:00.000Z')
  // 15:30 BRT → amanhã 04:00 BRT = 07:00 UTC
  assert.equal(proximaExecucao(H, new Date('2026-09-30T18:30:00Z')).toISOString(), '2026-10-01T07:00:00.000Z')
  // exatamente 04:00 BRT já passou → 12:00
  assert.equal(proximaExecucao(H, new Date('2026-10-01T07:00:00Z')).toISOString(), '2026-10-01T15:00:00.000Z')
})

test('virada de mês e de ano', () => {
  assert.equal(proximaExecucao(H, new Date('2026-12-31T20:00:00Z')).toISOString(), '2027-01-01T07:00:00.000Z')
})

test('horário inválido derruba na partida', () => {
  assert.throws(() => lerHorarios('25:00'), /HORARIOS/)
})

test('padrão: uma vez por dia, 03:00 de Brasília', () => {
  const padrao = lerHorarios(undefined)
  assert.deepEqual(padrao, [{ h: 3, m: 0 }])
  // 30/09 10:00 BRT → amanhã 03:00 BRT = 06:00 UTC
  assert.equal(proximaExecucao(padrao, new Date('2026-09-30T13:00:00Z')).toISOString(), '2026-10-01T06:00:00.000Z')
})
