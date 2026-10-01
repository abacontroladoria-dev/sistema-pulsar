import { useCallback, useEffect, useMemo, useState } from "react"
import { apurarESalvarPEP, liberarFaturamento, limparRecalculo, reabrirFaturamento, type ResultadoApuracaoPaciente } from "@/services/pepApuracao.service"

// Roda o motor de cálculo da PEP (calculoPEP.ts) contra os dados reais
// registrados em pep_registros_entrega/pep_planejamento_semestral e persiste
// o resultado em pep_apuracao_mensal. Base do indicador "potencial ×
// alcançado" — tanto o resumo desta tela quanto o dashboard histórico leem
// dali.
export function usePepApuracao(
  prestadorNome: string,
  competencia: string,
  pacientes: Array<{ nome: string; cpf?: string | null }>,
  valorMensalPorPaciente: number
) {
  const [resultados, setResultados] = useState<ResultadoApuracaoPaciente[]>([])
  const [totalPrestador, setTotalPrestador] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const recalcular = useCallback(async () => {
    if (!prestadorNome || !competencia || pacientes.length === 0 || valorMensalPorPaciente <= 0) {
      setResultados([])
      setTotalPrestador(0)
      return
    }
    setLoading(true)
    setError(null)
    const { resultados: novosResultados, totalPrestador: novoTotal, error: apuracaoError } = await apurarESalvarPEP({
      prestadorNome, competencia, pacientes, valorMensalPorPaciente,
    })
    if (apuracaoError) setError("Não foi possível apurar a PEP deste prestador.")
    // Recalculado agora: a pendência deixada pelo robô SharePoint está resolvida.
    else void limparRecalculo(prestadorNome, competencia)
    setResultados(novosResultados)
    setTotalPrestador(novoTotal)
    setLoading(false)
  }, [prestadorNome, competencia, pacientes, valorMensalPorPaciente])

  useEffect(() => { recalcular() }, [recalcular])

  const resultadoDe = useCallback(
    (pacienteNome: string) => resultados.find(r => r.paciente_nome === pacienteNome) ?? null,
    [resultados]
  )

  // PRD Seção 11 — competência com Faturamento Liberado fica congelada.
  const liberado = useMemo(
    () => resultados.length > 0 && resultados.every(r => r.estado === "liberado"),
    [resultados]
  )

  const liberar = useCallback(async () => {
    const { ok } = await liberarFaturamento(prestadorNome, competencia)
    if (ok) await recalcular()
    return ok
  }, [prestadorNome, competencia, recalcular])

  const reabrir = useCallback(async (motivo: string) => {
    const { ok } = await reabrirFaturamento(prestadorNome, competencia, motivo)
    if (ok) await recalcular()
    return ok
  }, [prestadorNome, competencia, recalcular])

  return { resultados, totalPrestador, loading, error, recalcular, resultadoDe, liberado, liberar, reabrir }
}
