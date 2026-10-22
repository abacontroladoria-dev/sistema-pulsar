"use client"

import { Suspense, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useHeader } from "@/contexts/HeaderContext"
import { OcupacaoProfShell } from "@/components/cronograma/indicadores/OcupacaoProfShell"
import { UnidadeDashboardShell } from "@/components/cronograma/indicadores/UnidadeDashboardShell"
import { PacientesDashboardShell } from "@/components/cronograma/indicadores/PacientesDashboardShell"
import { PrevisaoReceitasShell } from "@/components/cronograma/indicadores/PrevisaoReceitasShell"
import { ComparativoSessoesShell } from "@/components/cronograma/indicadores/ComparativoSessoesShell"
import { EntradaConvenioShell } from "@/components/cronograma/indicadores/entrada-convenio/EntradaConvenioShell"

// "alimentar-bd" (Preencher Receitas Faturadas) saiu em 22/10/2026: ninguém usava.
// AlimentarBdReceitasShell ficou no repositório, caso volte.
const TABS = ["profissionais", "unidades", "pacientes", "previsao-receitas", "comparativo-sessoes", "entrada-convenio"] as const
type TabKey = (typeof TABS)[number]

const TAB_LABELS: Record<TabKey, string> = {
  profissionais: "Ocupação de Profissionais",
  unidades: "Ocupação Clínica",
  pacientes: "Dashboard de Pacientes",
  "previsao-receitas": "Previsão de Receitas",
  "comparativo-sessoes": "Comparativo de Sessões",
  "entrada-convenio": "Entrada de Pacientes (Convênio)",
}

const TAB_SUBTITLES: Record<TabKey, string> = {
  profissionais: "",
  unidades: "Quanto do espaço de cada unidade tem profissional e paciente",
  pacientes: "Métricas de pacientes ativos: CH, convênio, unidade",
  "previsao-receitas": "Receita mensal projetada, cruzando sessões com valores cadastrados por convênio",
  "comparativo-sessoes": "Compara sessões agendadas entre dois períodos: total geral, por unidade e por paciente",
  "entrada-convenio": "Leve, ASSIM e FUSEx: quem precisa agir em cada paciente, do pedido à 1ª sessão",
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
      {activeTab === "comparativo-sessoes" && <ComparativoSessoesShell />}
      {activeTab === "entrada-convenio" && <EntradaConvenioShell />}
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
