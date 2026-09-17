import { describe, expect, it } from 'vitest'
import { guiaDoPaciente } from './agruparPacientes'

/*
  A regressão que estes testes trancam (2026-09-17).

  `fdf495f` fez o filtro de guias aceitar DUAS chaves alternativas — matrícula
  OU `paciente_id` —, para resolver a guia que chega sem matrícula. Mas
  `autorizacoes_assim.paciente_id` é carimbado do lado do Pulsar e não sustenta
  identidade: nove ids carregavam de 2 a 5 matrículas distintas, 375 guias desde
  30/07. Com o `||`, o id errado vencia sempre que a matrícula certa dizia não.

  Em tela: o modal do Emanuel Abreu De Andrade (07–11/09) mostrava 15 cartões
  para uma semana de 7 sessões — 8 "Liberada além do agendado" que eram da
  Laura, do Guilherme e do Rodolfo, todas gravadas com o paciente_id 14447.
*/

const EMANUEL = '411008.0000001.01'
const LAURA = '461800.0000001.02'

describe('guiaDoPaciente — a matrícula manda, o id é último recurso', () => {
  it('rejeita guia de outro paciente ainda que o paciente_id seja o do aberto', () => {
    // O caso medido: matrícula da Laura, id carimbado como o do Emanuel.
    const guia = { matricula: LAURA, paciente_id: '14447' }
    expect(guiaDoPaciente(guia, new Set([EMANUEL]), new Set(['14447']))).toBe(false)
  })

  it('aceita pela matrícula, que é a chave boa', () => {
    const guia = { matricula: EMANUEL, paciente_id: '14447' }
    expect(guiaDoPaciente(guia, new Set([EMANUEL]), new Set(['14447']))).toBe(true)
  })

  it('a matrícula decide mesmo quando o id NÃO é do paciente aberto', () => {
    // Simétrico do primeiro: id sujo não pode tirar uma guia legítima.
    const guia = { matricula: EMANUEL, paciente_id: '99999' }
    expect(guiaDoPaciente(guia, new Set([EMANUEL]), new Set(['14447']))).toBe(true)
  })

  it('usa o id quando a guia não tem matrícula — o caso que motivou o fallback', () => {
    const guia = { matricula: null, paciente_id: '14447' }
    expect(guiaDoPaciente(guia, new Set([EMANUEL]), new Set(['14447']))).toBe(true)
  })

  it('sem matrícula e sem id conhecido, não é de ninguém', () => {
    expect(guiaDoPaciente({ matricula: null, paciente_id: null }, new Set([EMANUEL]), new Set(['14447']))).toBe(false)
    expect(guiaDoPaciente({ matricula: '', paciente_id: '77777' }, new Set([EMANUEL]), new Set(['14447']))).toBe(false)
  })

  it('aceita paciente_id numérico, como a linha crua o traz', () => {
    const guia = { matricula: null, paciente_id: 14447 }
    expect(guiaDoPaciente(guia, new Set([EMANUEL]), new Set(['14447']))).toBe(true)
  })
})
