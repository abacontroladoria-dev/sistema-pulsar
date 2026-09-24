"use client"

// Combina o resumo mensal (previsao_receitas_historico_resumo, via
// useResumoHistoricoReceitas) com os lançamentos manuais de
// previsao_receitas_faturamento (via useReceitasFaturamento), calculando
// efetivadoReal/indefinido por competência — ver
// lib/cronograma/receitasEfetivadas.ts.
//
// Único ponto que faz esse cruzamento pra TODOS os meses de uma vez: usado
// tanto pelo índice mensal (HistoricoReceitasShell) quanto pelo gráfico
// compacto de Previsão de Receitas (PrevisaoReceitasShell) — ambos consomem
// o MESMO gráfico (EvolucaoReceitasChart), que só sabe ler os campos que já
// vierem prontos no objeto `resumo`. Passar o resumo cru (sem esse merge)
// faz o gráfico mostrar Efetivado/Indefinido sempre zerado, mesmo com
// lançamentos reais gravados — bug já visto em produção (2026-09-23).

import { useMemo } from "react"
import { useResumoHistoricoReceitas } from "./useResumoHistoricoReceitas"
import { useReceitasFaturamento } from "./useReceitasFaturamento"
import { calcularIndefinidoTotalMes } from "@/lib/cronograma/receitasEfetivadas"
import type { PrevisaoReceitasResumoMes } from "@/services/previsaoReceitasHistoricoResumo.service"

export function useResumoHistoricoReceitasComEfetivado() {
  const { resumos, loading, error } = useResumoHistoricoReceitas()
  // Sem filtro de competência: poucas linhas (lançamento manual), mais
  // barato buscar tudo de uma vez e agrupar por mês no cliente.
  const { rows: faturamentoRows } = useReceitasFaturamento()

  const resumosComEfetivado = useMemo<PrevisaoReceitasResumoMes[]>(() => {
    return resumos.map(r => {
      const { efetivadoTotal, indefinidoTotal } = calcularIndefinidoTotalMes(
        r.receitaComDeducao,
        faturamentoRows.filter(f => f.competencia === r.competencia),
      )
      return { ...r, efetivadoReal: efetivadoTotal, indefinido: indefinidoTotal }
    })
  }, [resumos, faturamentoRows])

  return { resumos: resumosComEfetivado, loading, error }
}
