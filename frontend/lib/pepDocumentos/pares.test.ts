import { describe, expect, test } from 'vitest'
import { parEntre, relacaoEntre, type DocParaPar } from './pares'

const base: DocParaPar = {
  sp_id: 'a', sha256: 'h1', assinatura: Array.from({ length: 128 }, (_, i) => i), sigla: 'PIC', tipoRegistro: 'POR_PACIENTE',
  competencia: '2026-09', prestadorPastaId: 'P1', pacientePastaId: 'X1', pacienteNome: 'João Silva',
}
const quase = (iguais: number) => Array.from({ length: 128 }, (_, i) => (i < iguais ? i : 1000 + i))

describe('pares de documentos parecidos', () => {
  test('arquivo idêntico em outro paciente é errado, mesmo de outro item', () => {
    const b = { ...base, sp_id: 'b', sigla: 'TOP', pacientePastaId: 'X2', pacienteNome: 'Lucas' }
    expect(parEntre(base, b)).toMatchObject({ tipo: 'identico', nivel: 'errado', relacao: 'outro_item' })
  })
  test('conteúdo quase igual em outro paciente: errado', () => {
    const b = { ...base, sp_id: 'b', sha256: 'h2', assinatura: quase(110), pacientePastaId: 'X2', pacienteNome: 'Lucas Rocha' }
    expect(parEntre(base, b)).toMatchObject({ tipo: 'parecido', nivel: 'errado', relacao: 'outro_paciente', a_sp_id: 'a', b_sp_id: 'b' })
  })
  test('metade igual: atenção; pouco igual: nada', () => {
    expect(parEntre(base, { ...base, sp_id: 'b', sha256: 'h2', assinatura: quase(55) })?.nivel).toBe('atencao')
    expect(parEntre(base, { ...base, sp_id: 'b', sha256: 'h2', assinatura: quase(20) })).toBeNull()
  })
  test('mais de 6 meses de distância não compara', () => {
    expect(parEntre(base, { ...base, sp_id: 'b', competencia: '2026-01' })).toBeNull()
  })
  test('relações', () => {
    expect(relacaoEntre(base, { ...base, competencia: '2026-08' })).toBe('mesmo_paciente_outro_mes')
    expect(relacaoEntre(base, { ...base })).toBe('mesmo_mes')
    expect(relacaoEntre(base, { ...base, prestadorPastaId: 'P2' })).toBe('outro_prestador')
    const stc = { ...base, sigla: 'STC', tipoRegistro: 'GERAL' as const, pacientePastaId: null, pacienteNome: null }
    expect(relacaoEntre(stc, { ...stc, competencia: '2026-08' })).toBe('outro_mes')
  })
})

describe('calibração (14/10/2026)', () => {
  test('PIC do mesmo paciente no mesmo mês, quase igual: versão nova, atenção', () => {
    const b = { ...base, sp_id: 'b', sha256: 'h2', assinatura: quase(115) }
    expect(parEntre(base, b)).toMatchObject({ relacao: 'mesmo_mes', nivel: 'atencao' })
  })
  test('TAP-01 × TAP-02 do mesmo mês, quase iguais: continua errado', () => {
    const tap = { ...base, sigla: 'TAP' }
    expect(parEntre(tap, { ...tap, sp_id: 'b', sha256: 'h2', assinatura: quase(115) })?.nivel).toBe('errado')
  })
})
