import { describe, it, expect } from 'vitest'
import { mascararNome, restaurarMarcadores, MARCADOR_PACIENTE as P } from '../auditorEngine'

describe('mascararNome', () => {
  it('mascara nome com acento, que o \\b do JS deixava passar', () => {
    expect(mascararNome('Eloá entrou bem.', 'Eloá Souza', P)).toBe(`${P} entrou bem.`)
  })

  it('mascara o nome completo sem deixar o sobrenome vazar', () => {
    expect(mascararNome('Gael Silva chegou; Gael saiu.', 'Gael Silva', P)).toBe(`${P} chegou; ${P} saiu.`)
  })

  it('não mascara pedaço de outra palavra', () => {
    expect(mascararNome('Ana trabalhou a banana.', 'Ana', P)).toBe(`${P} trabalhou a banana.`)
  })

  it('não quebra com caractere especial de regex no nome', () => {
    expect(mascararNome('João (Jr) chegou.', 'João (Jr)', P)).toBe(`${P} chegou.`)
  })
})

describe('restaurarMarcadores', () => {
  it('não deixa marcador no texto que vai para o prontuário', () => {
    expect(restaurarMarcadores(`O ${P} chegou com o [TERAPEUTA].`)).toBe('O paciente chegou com o terapeuta.')
  })
})
