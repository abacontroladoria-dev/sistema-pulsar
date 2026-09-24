"use client"

import { Suspense, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useHeader } from "@/contexts/HeaderContext"
import { OcupacaoProfShell } from "@/components/cronograma/indicadores/OcupacaoProfShell"
import { UnidadeDashboardShell } from "@/components/cronograma/indicadores/UnidadeDashboardShell"
import { PacientesDashboardShell } from "@/components/cronograma/indicadores/PacientesDashboardShell"
import { PrevisaoReceitasShell } from "@/components/cronograma/indicadores/PrevisaoReceitasShell"
import { HistoricoReceitasShell } from "@/components/cronograma/indicadores/HistoricoReceitasShell"
import { AlimentarBdReceitasShell } from "@/components/cronograma/indicadores/AlimentarBdReceitasShell"
import { ComparativoSessoesShell } from "@/components/cronograma/indicadores/ComparativoSessoesShell"

const TABS = ["profissionais", "unidades", "pacientes", "previsao-receitas", "historico-receitas", "alimentar-bd", "comparativo-sessoes"] as const
type TabKey = (typeof TABS)[number]

const TAB_LABELS: Record<TabKey, string> = {
  profissionais: "Ocupação de Profissionais",
  unidades: "Ocupação Clínica",
  pacientes: "Dashboard de Pacientes",
  "previsao-receitas": "Previsão de Receitas",
  "historico-receitas": "Histórico de Receitas",
  "alimentar-bd": "Preencher Receitas Faturadas",
  "comparativo-sessoes": "Comparativo de Sessões",
}

const TAB_SUBTITLES: Record<TabKey, string> = {
  profissionais: "",
  unidades: "Ocupação agregada de salas por unidade",
  pacientes: "Métricas de pacientes ativos: CH, convênio, unidade",
  "previsao-receitas": "Receita mensal projetada, cruzando sessões com valores cadastrados por convênio",
  "historico-receitas": "Índice mensal do histórico congelado de receita — projetado, deduções e efetivado, mês a mês",
  "alimentar-bd": "Lançamento manual de NF e pagamentos recebidos, por paciente e mês",
  "comparativo-sessoes": "Compara sessões agendadas entre dois períodos: total geral, por unidade e por paciente",
}

function IndicadoresContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { setHeader } = useHeader()
  const rawTab = searchParams.get("tab")
  const activeTab: TabKey = TABS.includes(rawTab as TabKey) ? (rawTab as TabKey) : "profissionais"

  useEffect(() => {
    if (!rawTab) router.replace("/cronograma/indicadores?tab=profissionais")
  }, [rawTab, router])

  // OcupacaoProfShell define seu próprio header (título + período) — as demais
  // abas usam este efeito genérico.
  useEffect(() => {
    if (activeTab === "profissionais") return
    setHeader(TAB_LABELS[activeTab], TAB_SUBTITLES[activeTab])
    return () => setHeader("", "")
  }, [activeTab, setHeader])

  return (
    <div className="flex flex-col gap-4">
      {activeTab === "profissionais" && <OcupacaoProfShell />}
      {activeTab === "unidades" && <UnidadeDashboardShell />}
      {activeTab === "pacientes" && <PacientesDashboardShell />}
      {activeTab === "previsao-receitas" && <PrevisaoReceitasShell />}
      {activeTab === "historico-receitas" && <HistoricoReceitasShell />}
      {activeTab === "alimentar-bd" && <AlimentarBdReceitasShell />}
      {activeTab === "comparativo-sessoes" && <ComparativoSessoesShell />}
    </div>
  )
}

export default function OcupacaoProfPage() {
  return (
    <Suspense fallback={null}>
      <IndicadoresContent />
    </Suspense>
  )
}
