"use client"

// Evolução mensal de Ocupação Clínica e Dashboard de Pacientes — mesmo padrão
// de useResumoHistoricoReceitas: hidrata do cache de forma síncrona para não
// piscar o carregando ao trocar de aba. `linhas === null` = tabela ainda não
// existe no banco (a tela não mostra o gráfico).

import { useEffect, useState } from "react"
import { historicoOcupacao, historicoPacientes } from "@/services/evolucaoIndicadoresHistorico.service"

function criarHook<T>(leitor: { peek: () => T[] | null | undefined; buscar: () => Promise<T[] | null> }) {
  return function useHistorico() {
    const [linhas, setLinhas] = useState<T[] | null | undefined>(() => leitor.peek())
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
      if (linhas !== undefined) return
      let cancelado = false
      leitor.buscar()
        .then(r => { if (!cancelado) setLinhas(r) })
        .catch(e => { if (!cancelado) { setError(String(e?.message ?? e)); setLinhas(null) } })
      return () => { cancelado = true }
    }, [linhas])

    return { linhas: linhas ?? null, carregando: linhas === undefined, error }
  }
}

export const useOcupacaoClinicaHistorico = criarHook(historicoOcupacao)
export const usePacientesHistorico = criarHook(historicoPacientes)
