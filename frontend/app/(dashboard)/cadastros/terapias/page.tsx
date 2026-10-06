"use client"

import { useEffect } from "react"
import { useHeader } from "@/contexts/HeaderContext"
import { TerapiasCadastro } from "@/components/cadastros/TerapiasCadastro"

export default function TerapiasPage() {
  const { setHeader } = useHeader()
  useEffect(() => {
    setHeader("Cadastro de Terapias")
    return () => setHeader("", "")
  }, [setHeader])

  return <TerapiasCadastro />
}
