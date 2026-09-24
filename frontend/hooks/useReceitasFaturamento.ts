"use client"

// Lançamentos manuais de previsao_receitas_faturamento, usados por
// PrevisaoReceitasShell (drilldown por paciente, filtra por competência) e
// HistoricoReceitasShell (totais por competência, sem filtro). Sem cache
// como useResumoHistoricoReceitas: é dado editável na hora pela aba
// "Preencher Receitas Faturadas", então cada montagem busca de novo.

import { useEffect, useState } from "react"
import {
  listarFaturamento,
  type FiltroFaturamento,
  type RegistroFaturamento,
} from "@/services/previsaoReceitasFaturamento.service"
import type { FaturamentoManualRow } from "@/lib/cronograma/receitasEfetivadas"

function paraLinhaCalculo(r: RegistroFaturamento): FaturamentoManualRow {
  return { id: r.id, pacienteId: r.paciente_id, competencia: r.competencia, valorPago: Number(r.valor_pago) }
}

export function useReceitasFaturamento(filtro: FiltroFaturamento = {}) {
  const [rows, setRows] = useState<FaturamentoManualRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listarFaturamento(filtro)
      .then(({ data, error }) => {
        if (cancelled) return
        setRows(data.map(paraLinhaCalculo))
        setError(error)
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(String(err?.message ?? err))
        setLoading(false)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro.competencia, filtro.pacienteId])

  return { rows, loading, error }
}
