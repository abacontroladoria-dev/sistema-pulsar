import { describe, it, expect } from 'vitest'
import { calcularPosicoes, descreverPosicao, type SessaoDoDia } from '../posicaoSessao'

const s = (id: string, hora: string, extra: Partial<SessaoDoDia> = {}): SessaoDoDia => ({
  id,
  paciente_id: 1,
  data: '2026-09-22',
  terapia_nome: 'Aplicador ABA Escola',
  hora_inicial: hora,
  ...extra
})

describe('calcularPosicoes', () => {
  it('ordena pelo horário, não pela ordem em que as linhas chegam', () => {
    const p = calcularPosicoes([s('c', '10:00'), s('a', '08:00'), s('b', '09:00')])
    expect(p.get('a')).toEqual({ ordem: 1, total: 3 })
    expect(p.get('b')).toEqual({ ordem: 2, total: 3 })
    expect(p.get('c')).toEqual({ ordem: 3, total: 3 })
  })

  it('separa por paciente, dia e terapia', () => {
    const p = calcularPosicoes([
      s('a', '08:00'),
      s('b', '09:00', { paciente_id: 2 }),
      s('c', '10:00', { data: '2026-09-23' }),
      s('d', '11:00', { terapia_nome: 'Fonoaudiologia' })
    ])
    for (const id of ['a', 'b', 'c', 'd']) expect(p.get(id)).toEqual({ ordem: 1, total: 1 })
  })

  it('ignora linha sem paciente', () => {
    expect(calcularPosicoes([s('a', '08:00', { paciente_id: null })]).size).toBe(0)
  })
})

describe('descreverPosicao', () => {
  it('nomeia primeira, intermediária, última e única', () => {
    expect(descreverPosicao({ ordem: 1, total: 3 })).toContain('é a primeira do dia')
    expect(descreverPosicao({ ordem: 2, total: 3 })).toContain('NÃO é a primeira nem a última')
    expect(descreverPosicao({ ordem: 3, total: 3 })).toContain('é a última do dia')
    expect(descreverPosicao({ ordem: 1, total: 1 })).toContain('é a primeira e a última')
  })
})
