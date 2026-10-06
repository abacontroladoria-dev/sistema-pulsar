"use client"

import { useEffect } from "react"
import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { useHeader } from "@/contexts/HeaderContext"
import { ProfissionalDetalhe, type AbaProfissional } from "@/components/cadastros/profissionais/ProfissionalDetalhe"

// Lista fechada: `aba` vem da URL e precisa casar com o type.
const ABAS: AbaProfissional[] = ["cadastro", "terapias", "disponibilidade", "historico"]

export default function ProfissionalDetalhePage() {
  const { id } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const { setHeader, setRightContent } = useHeader()
  const abaParam = searchParams.get("aba") as AbaProfissional | null
  const abaInicial = abaParam && ABAS.includes(abaParam) ? abaParam : undefined

  useEffect(() => {
    setHeader("Ficha do profissional", "Cadastro, terapias e disponibilidade")
    return () => setHeader("", "")
  }, [setHeader])

  useEffect(() => {
    setRightContent(
      <Link
        href="/cadastros/profissionais"
        className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Voltar
      </Link>
    )
    return () => setRightContent(null)
  }, [setRightContent])

  const idProf = Number(id)
  if (!Number.isInteger(idProf) || idProf <= 0) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Endereço inválido para um profissional.
        </div>
      </div>
    )
  }

  return <ProfissionalDetalhe key={idProf} id={idProf} abaInicial={abaInicial} />
}
