import { describe, expect, test } from 'vitest'
import { situacaoNome } from './nome'

const base = { sigla: 'PIC', competencia: '2026-09', paciente_nome: 'João Silva', padrao: 'ok' as string | null }

describe('situacaoNome — Etapa 1 (nome do arquivo)', () => {
  test('no padrão', () => {
    expect(situacaoNome({ ...base, nome: 'PIC-JOAO SILVA-092026.pdf' })).toMatchObject({ estado: 'ok', esperado: null })
  })
  test('fora do padrão: motivo do banco e nome esperado', () => {
    expect(situacaoNome({ ...base, nome: 'Plano João.docx', padrao: 'fora', padrao_motivo: 'formato_desconhecido' })).toMatchObject({
      estado: 'fora', motivo: 'formato_desconhecido', texto: 'Nome fora do padrão', esperado: 'PIC-JOÃO SILVA-092026',
    })
  })
  test('sem o motivo gravado: recalcula com a mesma regra', () => {
    expect(situacaoNome({ ...base, nome: 'PIC-JOAO SILVA-09-2026.pdf', padrao: 'fora' }).motivo).toBe('mes_com_separador')
  })
  test('Geral leva número; TAP usa o número lido do nome', () => {
    expect(situacaoNome({ ...base, sigla: 'STC', paciente_nome: null, nome: 'supervisao.pdf', padrao: 'fora' }).esperado).toBe('STC-01-092026')
    expect(situacaoNome({ ...base, sigla: 'TAP', nome: 'TAP-02-JOAO-092026 (2).pdf', padrao: 'duplicado', nome_seq: '02' })).toMatchObject({
      estado: 'repetido', esperado: 'TAP-02-JOÃO SILVA-092026',
    })
  })
  test('reprogramação e não conferido', () => {
    expect(situacaoNome({ ...base, nome: 'REP-PIC-JOAO-092026.pdf', padrao: 'rep' }).estado).toBe('rep')
    expect(situacaoNome({ ...base, nome: 'x.pdf', padrao: null }).estado).toBe('sem')
  })
})
