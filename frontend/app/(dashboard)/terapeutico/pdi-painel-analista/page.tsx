"use client"

import { useEffect } from "react"
import { useHeader } from "@/contexts/HeaderContext"
import { PainelAnalistaShell } from "@/components/terapeutico/pdi/PainelAnalistaShell"

export default function PdiPainelAnalistaPage() {
  const { setHeader } = useHeader()
  useEffect(() => {
    setHeader("PDI — Painel por Analista", "Priorize os casos que precisam da sua atenção")
    return () => setHeader("", "")
  }, [setHeader])

  return <PainelAnalistaShell />
}
