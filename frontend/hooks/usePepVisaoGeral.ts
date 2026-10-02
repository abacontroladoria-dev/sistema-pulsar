import { useEffect, useState } from "react"
import {
  apurarESalvarPEP, getApuracaoCompetencia, limparRecalculo, listarRecalculosDeOutrosMeses, listarRecalculosPendentes,
  reapurarMesFechado, type PepApuracaoLinhaCompetencia,
} from "@/services/pepApuracao.service"
import { getIndicesRobo } from "@/services/roboSharepoint.service"
import type { AnalistaDaGrade } from "@/lib/remuneracao/visaoGeralPep"
import type { PepIndicesRobo } from "@/types/roboSharepoint"

// Linhas de pep_apuracao_mensal de UMA competência, de todos os prestadores —
// para a visão geral de Entregas PEP. Diferente de usePepApuracao, NÃO apura
// quem nunca foi aberto ("não apurado" continua sendo a ausência de linha).
//
// Exceção (20261002100000): o robô SharePoint entrega de madrugada, quando
// ninguém está com a tela aberta. Ele deixa o analista em
// pep_apuracao_recalcular; aqui, antes de ler, esses analistas são reapurados
// (só eles) — senão a visão geral mostraria o valor de antes da entrega.
//
// Desde 20261003100000 a entrega também acompanha a pasta: evidência apagada
// do SharePoint tira a unidade de qualquer mês aberto, não só do que está na
// tela. Depois de mostrar o mês da tela, os outros meses da fila são
// reapurados em segundo plano com os pacientes e o V que cada um já tinha.
//
// O resultado fica guardado junto com a competência que o pediu: enquanto a
// resposta do mês ATUAL não chega, `loading` é verdadeiro e `linhas` vem vazio
// — nada de mostrar os números do mês anterior com o rótulo do novo.
export function usePepVisaoGeral(
  competencia: string | null,
  analistas: AnalistaDaGrade[] = [],
  valorPorPaciente = 0,
) {
  const [estado, setEstado] = useState<{
    competencia: string
    linhas: PepApuracaoLinhaCompetencia[]
    indices: PepIndicesRobo[]
    erro: string | null
  } | null>(null)

  useEffect(() => {
    if (!competencia) return
    let cancelado = false
    ;(async () => {
      const pendentes = await listarRecalculosPendentes(competencia)
      for (const nome of pendentes) {
        if (cancelado) return
        // Só analistas da Grade (o par de teste nunca está aqui e não é apurado).
        const a = analistas.find(x => x.nome === nome)
        if (!a || valorPorPaciente <= 0) continue
        await apurarESalvarPEP({
          prestadorNome: nome, competencia, valorMensalPorPaciente: valorPorPaciente,
          pacientes: a.pacientes.map(p => ({ nome: p })),
        })
        await limparRecalculo(nome, competencia)
      }
      const [{ data, error }, indices] = await Promise.all([
        getApuracaoCompetencia(competencia),
        getIndicesRobo(competencia),
      ])
      if (cancelado) return
      setEstado({
        competencia,
        linhas: data,
        indices,
        erro: error ? "Não foi possível ler a apuração da PEP deste mês." : null,
      })

      // Os outros meses, depois de a tela já estar de pé.
      for (const r of await listarRecalculosDeOutrosMeses(competencia)) {
        if (cancelado) return
        if (await reapurarMesFechado(r.prestadorNome, r.competencia)) await limparRecalculo(r.prestadorNome, r.competencia)
      }
    })()
    return () => { cancelado = true }
  }, [competencia, analistas, valorPorPaciente])

  const atual = estado && estado.competencia === competencia ? estado : null
  return {
    linhas: atual?.linhas ?? [],
    indices: atual?.indices ?? [],
    erro: atual?.erro ?? null,
    loading: !!competencia && !atual,
  }
}
