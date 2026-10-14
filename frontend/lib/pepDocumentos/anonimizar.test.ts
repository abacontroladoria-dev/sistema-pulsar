import { describe, expect, test } from 'vitest'
import { anonimizarDocumento } from './anonimizar'

const nomes = { pacientes: ['João Pedro Silva', 'João Pedro'], profissionais: ['Maria Souza Lima'] }

describe('anonimizarDocumento — o que sai para a IA', () => {
  test('valores de campos de pessoa viram marcador', () => {
    const t = anonimizarDocumento('Responsável: Carla Mendes\nEscola: EMEF Monteiro Lobato\nRepresentante da escola: Ana Paula\nCargo: Coordenadora', nomes)
    expect(t).toBe('Responsável: [NOME PREENCHIDO]\nEscola: [NOME PREENCHIDO]\nRepresentante da escola: [NOME PREENCHIDO]\nCargo: Coordenadora')
  })

  test('paciente e profissional em qualquer lugar do texto', () => {
    const t = anonimizarDocumento('João Pedro Silva chegou com a mãe. João brincou. Maria Souza Lima orientou.', nomes)
    expect(t).not.toMatch(/João|Maria|Souza|Silva/)
    expect(t).toContain('[PACIENTE]')
    expect(t).toContain('[PROFISSIONAL]')
  })

  test('nascimento, CPF, telefone e e-mail', () => {
    const t = anonimizarDocumento('Data de nascimento: 03/02/2019\nCPF 529.982.247-25, tel (11) 98765-4321, carla@ex.com', nomes)
    expect(t).toContain('Data de nascimento: [DATA PREENCHIDA]')
    expect(t).not.toMatch(/529|98765|carla@/)
  })

  test('valor que é o modelo continua visível (a IA precisa apontar)', () => {
    expect(anonimizarDocumento('Paciente: nome do paciente\nResponsável: ______\nEscola: [nome da escola]', nomes))
      .toBe('Paciente: nome do paciente\nResponsável: ______\nEscola: [nome da escola]')
  })

  test('data do encontro não é mascarada (a régua confere)', () => {
    expect(anonimizarDocumento('Data da reunião: 15/09/2026', nomes)).toBe('Data da reunião: 15/09/2026')
  })
})
