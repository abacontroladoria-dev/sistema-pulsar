import { describe, expect, it } from 'vitest'
import { dataBR, papelPrecisaDeSegundoFator, situacaoExigencia } from './segundoFator'

// A exigência do app autenticador liga por data (NEXT_PUBLIC_MFA_OBRIGATORIO_DESDE).
// O que não pode acontecer: alguém trancado sem aviso, ou a data valendo um dia
// antes/depois por causa do fuso (a virada é meia-noite de Brasília, não UTC).

describe('situacaoExigencia', () => {
  const desde = '2026-11-03'

  it('sem data (ou data inválida), ninguém é obrigado', () => {
    expect(situacaoExigencia(new Date('2026-11-10T12:00:00Z'), undefined).tipo).toBe('desligada')
    expect(situacaoExigencia(new Date('2026-11-10T12:00:00Z'), '03/11/2026').tipo).toBe('desligada')
  })

  it('mais de 7 dias antes: só registra a data, sem aviso', () => {
    expect(situacaoExigencia(new Date('2026-10-20T12:00:00Z'), desde).tipo).toBe('futura')
  })

  it('nos 7 dias antes: aviso com a contagem', () => {
    const s = situacaoExigencia(new Date('2026-10-27T12:00:00Z'), desde)
    expect(s).toEqual({ tipo: 'aviso', desde, dias: 7 })
    expect(situacaoExigencia(new Date('2026-11-02T12:00:00Z'), desde)).toEqual({ tipo: 'aviso', desde, dias: 1 })
  })

  it('a partir da data, em Brasília: obrigatória', () => {
    // 03/11 01:00 UTC ainda é 02/11 22:00 em Brasília.
    expect(situacaoExigencia(new Date('2026-11-03T01:00:00Z'), desde).tipo).toBe('aviso')
    // 03/11 03:00 UTC = 00:00 em Brasília.
    expect(situacaoExigencia(new Date('2026-11-03T03:00:00Z'), desde).tipo).toBe('obrigatoria')
    expect(situacaoExigencia(new Date('2027-01-01T12:00:00Z'), desde).tipo).toBe('obrigatoria')
  })
})

describe('papelPrecisaDeSegundoFator', () => {
  it('só admin e diretoria', () => {
    expect(papelPrecisaDeSegundoFator('admin')).toBe(true)
    expect(papelPrecisaDeSegundoFator('diretoria')).toBe(true)
    expect(papelPrecisaDeSegundoFator('recepcao')).toBe(false)
    expect(papelPrecisaDeSegundoFator(null)).toBe(false)
  })
})

it('dataBR', () => {
  expect(dataBR('2026-11-03')).toBe('03/11/2026')
})
