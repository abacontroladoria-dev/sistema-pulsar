"use client"

import { Suspense, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { useHeader } from "@/contexts/HeaderContext"
import { StatusContratosShell } from "@/components/acompanhamento/contratos/StatusContratosShell"

// `useSearchParams` exige um limite de Suspense (regra do App Router) — mesmo
// padrão de acompanhamento/laudos/page.tsx.
function StatusContratosContent() {
  const { setHeader } = useHeader()
  const searchParams = useSearchParams()

  useEffect(() => {
    setHeader("Status Contratos", "Assinatura e vigência dos contratos dos pacientes")
    return () => setHeader("", "")
  }, [setHeader])

  // `?busca=` abre a tela já buscando (nome ou ID do paciente).
  return <StatusContratosShell buscaInicial={searchParams.get("busca") ?? ""} />
}

export default function StatusContratosPage() {
  return (
    <Suspense fallback={null}>
      <StatusContratosContent />
    </Suspense>
  )
}
