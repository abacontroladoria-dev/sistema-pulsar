"use client"

// Hook compartilhado por HistoricoReceitasShell e PrevisaoReceitasShell —
// busca o índice mensal leve (previsao_receitas_historico_resumo) uma única
// vez e reaproveita o cache do service ao trocar de tab/mês. Estado inicial
// hidrata do cache de forma síncrona pra evitar flash de loading quando o
// dado já foi buscado por outra tab na mesma sessão.

import { useEffect, useState } from "react"
import {
  buscarResumoHistoricoReceitas,
  peekResumoHistoricoReceitasCache,
  type PrevisaoReceitasResumoMes,
} from "@/services/previsaoReceitasHistoricoResumo.service"

export function useResumoHistoricoReceitas() {
  const [resumos, setResumos] = useState<PrevisaoReceitasResumoMes[] | null>(() => peekResumoHistoricoReceitasCache())
  const [loading, setLoading] = useState(resumos === null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (resumos !== null) return

    let cancelled = false
    buscarResumoHistoricoReceitas()
      .then(r => { if (!cancelled) { setResumos(r); setLoading(false) } })
      .catch(err => { if (!cancelled) { setError(String(err?.message ?? err)); setLoading(false) } })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { resumos: resumos ?? [], loading, error }
}
