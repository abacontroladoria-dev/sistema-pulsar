"use client"

import { Suspense, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { useHeader } from "@/contexts/HeaderContext"
import { AcompanhamentoLaudosShell } from "@/components/acompanhamento/laudos/AcompanhamentoLaudosShell"

// `useSearchParams` exige um limite de Suspense (regra do App Router) — mesmo
// padrão de app/(dashboard)/cronograma/indicadores/page.tsx.
function AcompanhamentoLaudosContent() {
  const { setHeader } = useHeader()
  const searchParams = useSearchParams()

  useEffect(() => {
    setHeader(
      "Acompanhamento de Laudos",
      "Laudos do Órbita e o registro do aviso ao responsável",
    )
    return () => setHeader("", "")
  }, [setHeader])

  // `?busca=` é o link direto de cronograma/ocupacao-paciente (Área "Status do
  // Laudo") — abre já buscando pelo ID Favorecido do paciente selecionado lá.
  return <AcompanhamentoLaudosShell buscaInicial={searchParams.get("busca") ?? ""} />
}

export default function AcompanhamentoLaudosPage() {
  return (
    <Suspense fallback={null}>
      <AcompanhamentoLaudosContent />
    </Suspense>
  )
}
