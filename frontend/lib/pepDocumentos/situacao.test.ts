import { describe, expect, test } from 'vitest'
import { VERSAO_ANALISE, desatualizado, precisaAuditar, situacaoDoDocumento } from './situacao'

const base = { extracao_status: 'ok', analise_status: 'concluida', analise_versao: VERSAO_ANALISE, ia_status: 'concluida', ia_regua: 'PIC@v1', veredito: 'bom' }

describe('situação do documento na Auditoria de Documentos PEP', () => {
  test('cada estado', () => {
    expect(situacaoDoDocumento({ ...base, extracao_status: 'sem_texto' })).toBe('ilegivel')
    expect(situacaoDoDocumento({ ...base, analise_status: 'aguardando', veredito: null })).toBe('nao_auditado')
    expect(situacaoDoDocumento({ ...base, analise_status: 'pendente' })).toBe('na_fila')
    expect(situacaoDoDocumento({ ...base, analise_status: 'erro' })).toBe('falhou')
    expect(situacaoDoDocumento({ ...base, veredito: 'errado' })).toBe('errado')
  })
  test('desatualizado: régua nova ou conferências novas', () => {
    expect(desatualizado(base, 'PIC@v1')).toBe(false)
    expect(desatualizado(base, 'PIC@v2')).toBe(true)
    expect(desatualizado({ ...base, analise_versao: '2026-10-14.2' }, 'PIC@v1')).toBe(true)
    expect(desatualizado({ ...base, ia_regua: null, ia_status: 'nao_se_aplica' }, null)).toBe(false)
  })
  test('precisa auditar: não auditado, falhou ou desatualizado; nunca ilegível ou já na fila', () => {
    expect(precisaAuditar({ ...base, analise_status: 'aguardando' }, 'PIC@v1')).toBe(true)
    expect(precisaAuditar({ ...base, analise_status: 'erro' }, 'PIC@v1')).toBe(true)
    expect(precisaAuditar(base, 'PIC@v2')).toBe(true)
    expect(precisaAuditar(base, 'PIC@v1')).toBe(false)
    expect(precisaAuditar({ ...base, analise_status: 'pendente' }, 'PIC@v2')).toBe(false)
    expect(precisaAuditar({ ...base, extracao_status: 'protegido', analise_status: 'aguardando' }, null)).toBe(false)
  })
})
