// Classificação de status por mês do histórico de Previsão de Receitas —
// extraído de HistoricoReceitasShell pra ser reaproveitado por
// EvolucaoReceitasChart (marcar meses não fechados como provisórios no
// gráfico), sem duplicar a regra em dois lugares.

import type { PrevisaoReceitasResumoMes } from "@/services/previsaoReceitasHistoricoResumo.service"

/** Primeiro mês considerado pelo índice — antes disso não há (nem haverá) dado sincronizado suficiente pra calcular nada (ver project_sync_grade_csv_deploy_drift_fix na memória do projeto: csv_grades_profissionais só passou a ter cobertura completa a partir daqui). */
export const MES_INICIO_HISTORICO = { ano: 2026, mes: 6 }

export type StatusMes = "futuro" | "em_desenvolvimento" | "aguardando_fechamento" | "fechado" | "sem_historico"

export function listaChavesMes(inicio: { ano: number; mes: number }, fim: { ano: number; mes: number }): { ano: number; mes: number }[] {
  const lista: { ano: number; mes: number }[] = []
  let ano = inicio.ano, mes = inicio.mes
  while (ano * 12 + mes <= fim.ano * 12 + fim.mes) {
    lista.push({ ano, mes })
    mes += 1
    if (mes > 12) { mes = 1; ano += 1 }
  }
  return lista
}

export function classificarStatusMes(ano: number, mes: number, resumo: PrevisaoReceitasResumoMes | null): StatusMes {
  const hoje = new Date()
  const mesAtual = { ano: hoje.getFullYear(), mes: hoje.getMonth() + 1 }
  const chaveAtual = mesAtual.ano * 12 + mesAtual.mes
  const chave = ano * 12 + mes

  if (chave > chaveAtual) return "futuro"
  if (chave === chaveAtual) return "em_desenvolvimento"
  if (resumo?.status === "fechado") return "fechado"
  if (resumo?.status === "parcial") return "aguardando_fechamento"
  return "sem_historico"
}
