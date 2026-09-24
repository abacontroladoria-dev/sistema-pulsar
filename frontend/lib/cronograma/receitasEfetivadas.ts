import type { PrevisaoReceitaPacienteAgregado } from "@/lib/cronograma/faturamentoProjecao"

// Cruza o projetado (líquido de faltas, já calculado por
// agregarPrevisaoPorPaciente/agregarSegmentoHistorico) com o "Efetivado"
// real — lançamentos manuais de pagamento/NF em
// previsao_receitas_faturamento (ver
// frontend/services/previsaoReceitasFaturamento.service.ts) — pra apurar
// "Indefinido (Glosa ou Receita)".
//
// Sem coluna de status do pagamento nos lançamentos (removida por pedido do
// usuário): Efetivado é a soma simples de valor_pago, sem filtro nenhum.

export interface FaturamentoManualRow {
  id: number
  pacienteId: number
  competencia: string // "YYYY-MM"
  valorPago: number
}

/** Soma valor_pago por paciente+competência. Chave: `${pacienteId}::${competencia}`. */
export function somarEfetivadoPorPacienteMes(rows: FaturamentoManualRow[]): Map<string, number> {
  const mapa = new Map<string, number>()
  for (const r of rows) {
    const chave = `${r.pacienteId}::${r.competencia}`
    mapa.set(chave, (mapa.get(chave) ?? 0) + r.valorPago)
  }
  return mapa
}

export interface PrevisaoReceitaPacienteAgregadoComEfetivado extends PrevisaoReceitaPacienteAgregado {
  efetivado: number
  /** max(valorComDeducao − efetivado, 0) — nunca negativo. */
  indefinido: number
}

/**
 * Acrescenta `efetivado`/`indefinido` a cada paciente agregado de UM mês.
 *
 * `indefinido = max(projetado − efetivado, 0)`: se nada foi lançado ainda
 * pra aquele paciente+mês, todo o projetado vira Indefinido (caso do
 * convênio ASSIM, sem nenhum pagamento registrado na planilha de
 * referência). Se o efetivado ultrapassar o projetado (pagamento
 * adiantado, ajuste retroativo), o excedente fica só implícito no
 * `efetivado` — não gera indefinido negativo.
 *
 * Pacientes sem `pacienteId` (fallback por nome em agregarPrevisaoPorPaciente,
 * quando a sessão não tem paciente_id) nunca casam com um lançamento manual
 * — que exige paciente_id — e ficam com efetivado 0 / indefinido = projetado.
 */
export function enriquecerComEfetivado(
  pacientesAgregados: PrevisaoReceitaPacienteAgregado[],
  competencia: string,
  faturamentoRows: FaturamentoManualRow[],
): PrevisaoReceitaPacienteAgregadoComEfetivado[] {
  const efetivadoPorChave = somarEfetivadoPorPacienteMes(faturamentoRows)
  return pacientesAgregados.map(p => {
    const efetivado = p.pacienteId !== null
      ? efetivadoPorChave.get(`${p.pacienteId}::${competencia}`) ?? 0
      : 0
    return {
      ...p,
      efetivado,
      indefinido: Math.max(p.valorComDeducao - efetivado, 0),
    }
  })
}

/** Totais da clínica pro card de índice mensal — sem precisar de join por paciente. */
export function calcularIndefinidoTotalMes(
  receitaComDeducaoTotal: number,
  faturamentoRowsDoMes: FaturamentoManualRow[],
): { efetivadoTotal: number; indefinidoTotal: number } {
  const efetivadoTotal = faturamentoRowsDoMes.reduce((soma, r) => soma + r.valorPago, 0)
  return {
    efetivadoTotal,
    indefinidoTotal: Math.max(receitaComDeducaoTotal - efetivadoTotal, 0),
  }
}
