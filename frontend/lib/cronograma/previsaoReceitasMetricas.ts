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
  | "efetivadoReal"
  | "indefinido"
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
  efetivadoReal: {
    key: "efetivadoReal",
    label: "Efetivado (Recebido)",
    labelCurto: "Efetivado",
    tone: "green",
    formato: "moeda",
    icon: Wallet,
    acessor: r => r.efetivadoReal ?? 0,
  },
  indefinido: {
    key: "indefinido",
    label: "Indefinido (Glosa ou Receita)",
    labelCurto: "Indefinido",
    tone: "amber",
    formato: "moeda",
    icon: AlertTriangle,
    acessor: r => r.indefinido ?? 0,
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

// Projetado (receitaSemDeducao) = Efetivado (efetivadoReal) + Deduções por
// Falta (deducaoFalta) + Indefinido (indefinido) — decisão do usuário
// (2026-09-23): só essas 4 categorias, sem nenhum "Projetado com deduções"
// intermediário. O campo `receitaComDeducao` (previsao_receitas_historico_resumo)
// continua existindo no banco/tipo PrevisaoReceitasResumoMes só como valor
// intermediário pro cálculo de Indefinido — nunca é exibido como métrica.
export const ORDEM_METRICAS_PADRAO: MetricaReceitaKey[] = [
  "receitaSemDeducao",
  "efetivadoReal",
  "deducaoFalta",
  "indefinido",
  "sessoesMes",
  "faltasMes",
  "pacientesUnicos",
]

export function formatarMetrica(config: MetricaReceitaConfig, v: number): string {
  return config.formato === "moeda" ? fmtReal(v) : v.toLocaleString("pt-BR")
}
