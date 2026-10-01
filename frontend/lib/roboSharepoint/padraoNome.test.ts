import { describe, expect, test } from 'vitest'
import { lerNomePadrao, nomesCompativeis } from './padraoNome'

// Os mesmos casos testados contra a função SQL (scratchpad/pg/t1.mjs).
describe('lerNomePadrao — igual a sp_pep_ler_nome_padrao', () => {
  test('exemplos do usuário seguem o padrão', () => {
    expect(lerNomePadrao('STC-01-092026.pdf', 'STC', 'GERAL')).toMatchObject({ ok: true, seq: '01', competencia: '2026-09' })
    expect(lerNomePadrao('TAP-02-JOAO SILVA-092026.pdf', 'TAP', 'POR_PACIENTE')).toMatchObject({ ok: true, seq: '02', paciente: 'JOAO SILVA' })
    expect(lerNomePadrao('PIC-JOAO SILVA-092026.docx', 'PIC', 'POR_PACIENTE')).toMatchObject({ ok: true, paciente: 'JOAO SILVA' })
    expect(lerNomePadrao('TOP - Adrian Costa - 092026.pdf', 'TOP', 'POR_PACIENTE').ok).toBe(true)
  })
  test('caso Adrian: os 4 arquivos do PIC ferem o padrão', () => {
    for (const n of ['Relatorio.pdf', 'PIC Adrian.docx', 'avaliacao.pdf', 'PIC-ADRIAN-092026 (2).pdf']) {
      expect(lerNomePadrao(n, 'PIC', 'POR_PACIENTE').ok).toBe(false)
    }
  })
  test('motivos', () => {
    expect(lerNomePadrao('ETC-092026.pdf', 'ETC', 'GERAL').erro).toBe('geral_sem_sequencial')
    expect(lerNomePadrao('TAP-JOAO-092026.pdf', 'TAP', 'POR_PACIENTE').erro).toBe('tap_sem_sequencial')
    expect(lerNomePadrao('TOP-JOAO-092026.pdf', 'PIC', 'POR_PACIENTE').erro).toBe('sigla_diferente_da_pasta')
    expect(lerNomePadrao('PIC-JOAO.pdf', 'PIC', 'POR_PACIENTE').erro).toBe('sem_competencia')
  })
  test('REP é reprogramação, não entrega', () => {
    expect(lerNomePadrao('REP-PIC-JOAO SILVA-092026.pdf', 'PIC', 'POR_PACIENTE')).toMatchObject({ ok: false, rep: true })
  })
})

describe('nomesCompativeis — igual a sp_pep_nomes_compativeis', () => {
  test('abreviado e sem acento valem; 1º nome diferente não', () => {
    expect(nomesCompativeis('JOAO SILVA', 'João Silva Santos')).toBe(true)
    expect(nomesCompativeis('ADRIAN', 'Adrian Costa')).toBe(true)
    expect(nomesCompativeis('PEDRO', 'Joao Silva Santos')).toBe(false)
  })
})
