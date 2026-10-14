// Pares de documentos parecidos: qual é a relação entre os dois e se o par é
// "errado" ou "atenção". Funções puras (o orquestrador busca e grava).

import { normalizar } from './texto'
import { LIMIAR_ATENCAO, LIMIAR_ERRADO, diceEstimado } from './semelhanca'
import type { Nivel, RelacaoSemelhanca } from './tipos'

export type DocParaPar = {
  sp_id: string
  sha256: string | null
  assinatura: number[] | null
  sigla: string | null
  tipoRegistro: 'GERAL' | 'POR_PACIENTE' | null
  competencia: string | null
  prestadorPastaId: string | null
  pacientePastaId: string | null
  pacienteNome: string | null
}

export type Par = {
  a_sp_id: string
  b_sp_id: string
  tipo: 'identico' | 'parecido'
  similaridade: number
  relacao: RelacaoSemelhanca
  nivel: Nivel
}

/** Semestrais: duas versões do mesmo documento no mesmo mês é versão nova, não cópia de outro. */
const SEMESTRAIS = new Set(['PIC', 'RT', 'OE'])

/** Só compara documentos até 6 meses de distância. */
const JANELA_MESES = 6

const mesesEntre = (a: string | null, b: string | null) => {
  if (!a || !b) return 0
  const [ya, ma] = a.split('-').map(Number)
  const [yb, mb] = b.split('-').map(Number)
  return Math.abs((ya - yb) * 12 + (ma - mb))
}

function mesmoPaciente(a: DocParaPar, b: DocParaPar) {
  if (a.pacientePastaId && b.pacientePastaId && a.pacientePastaId === b.pacientePastaId) return true
  const na = normalizar(a.pacienteNome), nb = normalizar(b.pacienteNome)
  return !!na && na === nb
}

export function relacaoEntre(a: DocParaPar, b: DocParaPar): RelacaoSemelhanca {
  if (a.sigla !== b.sigla) return 'outro_item'
  if (a.prestadorPastaId && b.prestadorPastaId && a.prestadorPastaId !== b.prestadorPastaId) return 'outro_prestador'
  if (a.tipoRegistro === 'POR_PACIENTE') {
    if (!mesmoPaciente(a, b)) return 'outro_paciente'
    return a.competencia === b.competencia ? 'mesmo_mes' : 'mesmo_paciente_outro_mes'
  }
  return a.competencia === b.competencia ? 'mesmo_mes' : 'outro_mes'
}

/**
 * O par entre dois documentos, ou null quando não são parecidos.
 *   • arquivo idêntico (mesmo SHA-256) em dois lugares: errado, qualquer item;
 *   • conteúdo preenchido ≥ 80% igual, mesmo item: errado;
 *   • ≥ 50%: atenção.
 */
export function parEntre(a: DocParaPar, b: DocParaPar): Par | null {
  if (a.sp_id === b.sp_id) return null
  const [x, y] = a.sp_id < b.sp_id ? [a, b] : [b, a]
  if (mesesEntre(a.competencia, b.competencia) > JANELA_MESES) return null
  if (a.sha256 && a.sha256 === b.sha256) {
    return { a_sp_id: x.sp_id, b_sp_id: y.sp_id, tipo: 'identico', similaridade: 1, relacao: relacaoEntre(a, b), nivel: 'errado' }
  }
  if (a.sigla !== b.sigla) return null
  const s = diceEstimado(a.assinatura, b.assinatura)
  if (s < LIMIAR_ATENCAO) return null
  const relacao = relacaoEntre(a, b)
  // PIC/RT/OE do mesmo paciente no mesmo mês, parecidos: versão revisada ou
  // arquivo enviado duas vezes — atenção, não erro (medido em 14/10/2026).
  const versao = relacao === 'mesmo_mes' && SEMESTRAIS.has((a.sigla ?? '').toUpperCase())
  return {
    a_sp_id: x.sp_id, b_sp_id: y.sp_id, tipo: 'parecido', similaridade: Math.round(s * 1000) / 1000,
    relacao, nivel: s >= LIMIAR_ERRADO && !versao ? 'errado' : 'atencao',
  }
}
