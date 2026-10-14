import { describe, expect, test } from 'vitest'
import { conferirNome, lerNomePadrao, nomeDoArquivo, nomesCompativeis } from './padraoNome'

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
  test('motivos precisos (20261014100000) — a regra não muda, só o motivo', () => {
    expect(lerNomePadrao('TOP-01-JOAO SILVA-092026.pdf', 'TOP', 'POR_PACIENTE').erro).toBe('sequencial_nao_esperado')
    expect(lerNomePadrao('PIC-1-JOAO-092026.pdf', 'PIC', 'POR_PACIENTE').erro).toBe('sequencial_nao_esperado')
    expect(lerNomePadrao('TAP-1-JOAO-092026.pdf', 'TAP', 'POR_PACIENTE').erro).toBe('sequencial_com_dois_digitos')
    expect(lerNomePadrao('STC-1-092026.pdf', 'STC', 'GERAL').erro).toBe('sequencial_com_dois_digitos')
    expect(lerNomePadrao('PIC-ADRIAN-092026 (2).pdf', 'PIC', 'POR_PACIENTE').erro).toBe('copia_com_sufixo')
    expect(lerNomePadrao('PIC-ADRIAN-092026 - Cópia.docx', 'PIC', 'POR_PACIENTE').erro).toBe('copia_com_sufixo')
    expect(lerNomePadrao('PIC-ADRIAN-09-2026.pdf', 'PIC', 'POR_PACIENTE').erro).toBe('mes_com_separador')
    expect(lerNomePadrao('STC-01-09_2026.pdf', 'STC', 'GERAL').erro).toBe('mes_com_separador')
    // TOP com número na pasta de outra sigla continua "sigla diferente".
    expect(lerNomePadrao('TOP-01-JOAO-092026.pdf', 'PIC', 'POR_PACIENTE').erro).toBe('sigla_diferente_da_pasta')
    // Nada que seguia o padrão deixou de seguir.
    expect(lerNomePadrao('TAP-01-JOAO SILVA-092026.pdf', 'TAP', 'POR_PACIENTE').ok).toBe(true)
    expect(lerNomePadrao('OE-JOAO SILVA-092026.pdf', 'OE', 'POR_PACIENTE').ok).toBe(true)
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

describe('conferirNome — formato + paciente do registro', () => {
  test('ok, rep e fora', () => {
    expect(conferirNome('PIC-JOAO SILVA-092026.pdf', 'PIC', 'POR_PACIENTE', 'João Silva Santos')).toEqual({ situacao: 'ok' })
    expect(conferirNome('PIC-PEDRO-092026.pdf', 'PIC', 'POR_PACIENTE', 'João Silva')).toEqual({ situacao: 'fora', motivo: 'paciente_diferente_da_pasta' })
    expect(conferirNome('REP-PIC-JOAO-092026.pdf', 'PIC', 'POR_PACIENTE', 'João')).toEqual({ situacao: 'rep' })
    expect(conferirNome('Relatorio.pdf', 'STC', 'GERAL', null)).toEqual({ situacao: 'fora', motivo: 'formato_desconhecido' })
  })
  test('nomeDoArquivo tira a pasta e decodifica', () => {
    expect(nomeDoArquivo('https://x.sharepoint.com/sites/a/Pacientes/PIC-JOAO%20SILVA-092026.pdf?web=1')).toBe('PIC-JOAO SILVA-092026.pdf')
    expect(nomeDoArquivo('SharePoint\\Pacientes\\STC-01-082026.pdf')).toBe('STC-01-082026.pdf')
  })
})
