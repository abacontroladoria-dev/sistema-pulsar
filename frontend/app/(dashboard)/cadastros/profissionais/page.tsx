"use client"

import { useEffect } from "react"
import { useHeader } from "@/contexts/HeaderContext"
import { ProfissionaisCadastro } from "@/components/cadastros/ProfissionaisCadastro"

export default function ProfissionaisPage() {
  const { setHeader } = useHeader()
  useEffect(() => {
    setHeader("Cadastro de Profissionais")
    return () => setHeader("", "")
  }, [setHeader])

  return <ProfissionaisCadastro />
}
