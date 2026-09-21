// Config única das métricas do histórico de Previsão de Receitas — fonte de
// verdade compartilhada por HistoricoReceitasShell (cards) e
// EvolucaoReceitasChart (gráfico), pra não duplicar label/cor/formatação em
// dois lugares que precisam ficar em sincronia.

import type { ComponentType, SVGProps } from "react"
import { AlertTriangle, TrendingUp, Users, Wallet } from "lucide-react"
import type { Tone } from "@/components/cronograma/ui/tones"
import { fmtReal } from "@/lib/cronograma/helpers"
import type { PrevisaoReceitasResumoMes } from "@/services/previsaoReceitasHistoricoResumo.service"

export type MetricaReceitaKey =
  | "receitaSemDeducao"
  | "deducaoFalta"
  | "receitaComDeducao"
  | "sessoesMes"
  | "faltasMes"
  | "pacientesUnicos"

export interface MetricaReceitaConfig {
  key: MetricaReceitaKey
  label: string
  labelCurto: string
  tone: Tone
  formato: "moeda" | "inteiro"
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>
  acessor: (r: PrevisaoReceitasResumoMes) => number
}

export const METRICAS_RECEITAS: Record<MetricaReceitaKey, MetricaReceitaConfig> = {
  receitaSemDeducao: {
    key: "receitaSemDeducao",
    label: "Projetado Sem Deduções",
    labelCurto: "Projetado",
    tone: "amber",
    formato: "moeda",
    icon: Wallet,
    acessor: r => r.receitaSemDeducao,
  },
  deducaoFalta: {
    key: "deducaoFalta",
    label: "Deduções por Falta",
    labelCurto: "Deduções",
    tone: "red",
    formato: "moeda",
    icon: AlertTriangle,
    acessor: r => r.deducaoFalta,
  },
  receitaComDeducao: {
    key: "receitaComDeducao",
    label: "Efetivado Com Deduções",
    labelCurto: "Efetivado",
    tone: "green",
    formato: "moeda",
    icon: Wallet,
    acessor: r => r.receitaComDeducao,
  },
  sessoesMes: {
    key: "sessoesMes",
    label: "Sessões no mês",
    labelCurto: "Sessões",
    tone: "slate",
    formato: "inteiro",
    icon: TrendingUp,
    acessor: r => r.sessoesMes,
  },
  faltasMes: {
    key: "faltasMes",
    label: "Faltas no mês",
    labelCurto: "Faltas",
    tone: "slate",
    formato: "inteiro",
    icon: Users,
    acessor: r => r.faltasMes,
  },
  pacientesUnicos: {
    key: "pacientesUnicos",
    label: "Pacientes atendidos",
    labelCurto: "Pacientes",
    tone: "slate",
    formato: "inteiro",
    icon: Users,
    acessor: r => r.pacientesUnicos,
  },
}

export const ORDEM_METRICAS_PADRAO: MetricaReceitaKey[] = [
  "receitaComDeducao",
  "receitaSemDeducao",
  "deducaoFalta",
  "sessoesMes",
  "faltasMes",
  "pacientesUnicos",
]

export function formatarMetrica(config: MetricaReceitaConfig, v: number): string {
  return config.formato === "moeda" ? fmtReal(v) : v.toLocaleString("pt-BR")
}
