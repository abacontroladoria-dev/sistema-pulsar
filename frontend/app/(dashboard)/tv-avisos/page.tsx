"use client"

import { useEffect } from "react"
import { useHeader } from "@/contexts/HeaderContext"
import { GestaoAvisosTV } from "@/components/tv-avisos/GestaoAvisosTV"

export default function AvisosTVPage() {
  const { setHeader } = useHeader()
  useEffect(() => {
    setHeader(
      "Avisos da TV",
      "Imagens exibidas na TV da recepção enquanto ninguém está sendo chamado"
    )
    return () => setHeader("", "")
  }, [setHeader])

  return <GestaoAvisosTV />
}
