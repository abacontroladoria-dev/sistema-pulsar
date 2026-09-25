import { useEffect, useState } from "react"
import { getApuracaoCompetencia, type PepApuracaoLinhaCompetencia } from "@/services/pepApuracao.service"

// Linhas de pep_apuracao_mensal de UMA competência, de todos os prestadores —
// para a visão geral de Entregas PEP. SÓ LEITURA: não apura nem grava
// (diferente de usePepApuracao, que roda apurarESalvarPEP ao abrir o analista).
//
// O resultado fica guardado junto com a competência que o pediu: enquanto a
// resposta do mês ATUAL não chega, `loading` é verdadeiro e `linhas` vem vazio
// — nada de mostrar os números do mês anterior com o rótulo do novo.
export function usePepVisaoGeral(competencia: string | null) {
  const [estado, setEstado] = useState<{ competencia: string; linhas: PepApuracaoLinhaCompetencia[]; erro: string | null } | null>(null)

  useEffect(() => {
    if (!competencia) return
    let cancelado = false
    getApuracaoCompetencia(competencia).then(({ data, error }) => {
      if (cancelado) return
      setEstado({
        competencia,
        linhas: data,
        erro: error ? "Não foi possível ler a apuração da PEP deste mês." : null,
      })
    })
    return () => { cancelado = true }
  }, [competencia])

  const atual = estado && estado.competencia === competencia ? estado : null
  return {
    linhas: atual?.linhas ?? [],
    erro: atual?.erro ?? null,
    loading: !!competencia && !atual,
  }
}
