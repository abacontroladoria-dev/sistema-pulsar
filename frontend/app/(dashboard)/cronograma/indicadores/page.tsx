"use client"

import { Suspense, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useHeader } from "@/contexts/HeaderContext"
import { OcupacaoProfShell } from "@/components/cronograma/indicadores/OcupacaoProfShell"
import { UnidadeDashboardShell } from "@/components/cronograma/indicadores/UnidadeDashboardShell"
import { PacientesDashboardShell } from "@/components/cronograma/indicadores/PacientesDashboardShell"
import { PrevisaoReceitasShell } from "@/components/cronograma/indicadores/PrevisaoReceitasShell"
import { AlimentarBdReceitasShell } from "@/components/cronograma/indicadores/AlimentarBdReceitasShell"
import { ComparativoSessoesShell } from "@/components/cronograma/indicadores/ComparativoSessoesShell"
import { EntradaConvenioShell } from "@/components/cronograma/indicadores/entrada-convenio/EntradaConvenioShell"

const TABS = ["profissionais", "unidades", "pacientes", "previsao-receitas", "alimentar-bd", "comparativo-sessoes", "entrada-convenio"] as const
type TabKey = (typeof TABS)[number]

const TAB_LABELS: Record<TabKey, string> = {
  profissionais: "Ocupação de Profissionais",
  unidades: "Ocupação Clínica",
  pacientes: "Dashboard de Pacientes",
  "previsao-receitas": "Previsão de Receitas",
  "alimentar-bd": "Preencher Receitas Faturadas",
  "comparativo-sessoes": "Comparativo de Sessões (Tratamento Multidisciplinar)",
  "entrada-convenio": "Entrada de Pacientes (Convênio)",
}

const TAB_SUBTITLES: Record<TabKey, string> = {
  profissionais: "",
  unidades: "Quanto do espaço de cada unidade tem profissional e paciente",
  pacientes: "Métricas de pacientes ativos: CH, convênio, unidade",
  "previsao-receitas": "Receita mensal projetada, cruzando sessões com valores cadastrados por convênio",
  "alimentar-bd": "Lançamento manual de NF e pagamentos recebidos, por paciente e mês",
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
      {activeTab === "alimentar-bd" && <AlimentarBdReceitasShell />}
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
