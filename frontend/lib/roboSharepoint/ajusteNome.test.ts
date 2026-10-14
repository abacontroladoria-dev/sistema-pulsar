import { describe, expect, test } from 'vitest'
import { ajusteDaEvidencia, contarAjustes } from './ajusteNome'

const pic = { sigla: 'PIC', tipoRegistro: 'POR_PACIENTE' as const, pacienteNome: 'João Silva', competencia: '2026-09' }
const stc = { sigla: 'STC', tipoRegistro: 'GERAL' as const, pacienteNome: null, competencia: '2026-09' }

describe('ajusteDaEvidencia — selo "Ajustar nomenclatura"', () => {
  test('arquivo do robô: vale o que o banco decidiu', () => {
    const spPorId = new Map([
      ['a', { padrao: 'fora', padrao_motivo: 'copia_com_sufixo' }],
      ['b', { padrao: 'ok', padrao_motivo: null }],
      ['c', { padrao: 'duplicado', padrao_motivo: 'repetido' }],
    ])
    expect(ajusteDaEvidencia({ sp_id: 'a', nome: 'qualquer' }, { ...pic, spPorId })).toMatchObject({
      motivo: 'copia_com_sufixo', nomeEsperado: 'PIC-JOÃO SILVA-092026',
    })
    expect(ajusteDaEvidencia({ sp_id: 'b', nome: 'Relatorio.pdf' }, { ...pic, spPorId })).toBeNull()
    expect(ajusteDaEvidencia({ sp_id: 'c' }, { ...pic, spPorId })?.motivo).toBe('repetido')
  })

  test('caminho digitado: a regra em TS sobre o nome do arquivo', () => {
    expect(ajusteDaEvidencia({ caminho: 'SharePoint/Geral/STC-01-092026.pdf' }, stc)).toBeNull()
    expect(ajusteDaEvidencia({ caminho: 'SharePoint/Geral/supervisao setembro.pdf' }, stc, 2)).toMatchObject({
      motivo: 'formato_desconhecido', nomeEsperado: 'STC-03-092026',
    })
    expect(ajusteDaEvidencia({ caminho: 'x/PIC-PEDRO-092026.pdf' }, pic)?.motivo).toBe('paciente_diferente_da_pasta')
  })

  test('sp_id que a tela não conhece cai na regra do nome', () => {
    expect(ajusteDaEvidencia({ sp_id: 'z', nome: 'PIC-JOAO SILVA-092026.pdf' }, { ...pic, spPorId: new Map() })).toBeNull()
  })

  test('contarAjustes ignora unidade sem caminho', () => {
    expect(contarAjustes([
      { caminho: 'a/STC-01-092026.pdf' },
      { caminho: '' },
      { caminho: 'a/STC-092026.pdf' },
    ], stc)).toBe(1)
  })
})
