// Situação de cada documento na Auditoria de Documentos PEP (15/10/2026).
// Sem dependência de servidor: a tela e a rota "Auditar" contam igual.
//
//   ilegivel      o robô não conseguiu ler o texto ("Não foi possível ler")
//   nao_auditado  lido, ninguém pediu auditoria ainda (analise_status 'aguardando')
//   na_fila       auditoria pedida, esperando a vez ('pendente')
//   falhou        a auditoria deu erro (texto expirou, falha do servidor)
//   bom / pode_conter_erros / errado — o veredito da auditoria
//
// "Desatualizado": auditado com conferências ou régua mais antigas que as
// vigentes — o botão "Auditar" oferece de novo.

import type { Veredito } from './tipos'

/** Muda quando as conferências fixas mudam (o documento guarda com qual foi auditado). */
export const VERSAO_ANALISE = '2026-10-15.1'

export type SituacaoAuditoria = 'nao_auditado' | 'na_fila' | 'falhou' | 'ilegivel' | Exclude<Veredito, 'ilegivel'>

export type DocParaSituacao = {
  extracao_status: string
  analise_status: string
  analise_versao?: string | null
  ia_status?: string | null
  ia_regua?: string | null
  veredito?: string | null
}

export function situacaoDoDocumento(d: DocParaSituacao): SituacaoAuditoria {
  if (d.extracao_status !== 'ok') return 'ilegivel'
  if (d.analise_status === 'pendente') return 'na_fila'
  if (d.analise_status === 'erro') return 'falhou'
  if (d.analise_status !== 'concluida' || !d.veredito || d.veredito === 'ilegivel') return 'nao_auditado'
  return d.veredito as SituacaoAuditoria
}

/**
 * Auditado com regra velha? `reguaVigente` = "PIC@v2" da sigla do documento,
 * ou null quando a sigla não tem régua.
 */
export function desatualizado(d: DocParaSituacao, reguaVigente: string | null): boolean {
  if (d.extracao_status !== 'ok' || d.analise_status !== 'concluida') return false
  if (d.analise_versao !== VERSAO_ANALISE) return true
  if (reguaVigente) return d.ia_regua !== reguaVigente
  return false
}

/** Entra no "Auditar N"? Não auditado, falhou, ou auditado com regra velha. */
export function precisaAuditar(d: DocParaSituacao, reguaVigente: string | null): boolean {
  if (d.extracao_status !== 'ok' || d.analise_status === 'pendente') return false
  return d.analise_status === 'aguardando' || d.analise_status === 'erro' || desatualizado(d, reguaVigente)
}
