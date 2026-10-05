"use client"

import { useEffect } from "react"
import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { useHeader } from "@/contexts/HeaderContext"
import { PacienteDetalhe } from "@/components/cadastros/pacientes/PacienteDetalhe"

export default function PacienteDetalhePage() {
  const { id } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const { setHeader, setRightContent } = useHeader()

  // Deep link vindo de Ocupação de Paciente ("suspensa temporariamente → ver
  // na ficha do paciente"): ?aba=altas&suspensao=123 abre direto na aba e no
  // registro que está causando o bloqueio, em vez de deixar o operador
  // procurar entre Cadastro/Ficha médica/Laudo/Altas e Individualidades.
  //
  // `?aba=escola` vem da listagem de pacientes: o selo de escola no cartão abre
  // direto na aba, para conferir o que a família declarou sem passar por
  // Cadastro. `?aba=disponibilidade` abre a disponibilidade (link do cronograma,
  // no futuro). Lista fechada de propósito — `aba` cru viria de URL e o valor
  // precisa casar com o type `Aba`.
  const abaParam = searchParams.get("aba")
  const abaInicial =
    abaParam === "altas"
      ? "altas"
      : abaParam === "escola"
        ? "escola"
        : abaParam === "disponibilidade"
          ? "disponibilidade"
          : undefined
  const suspensaoIdParam = searchParams.get("suspensao")
  const suspensaoIdInicial = suspensaoIdParam ? Number(suspensaoIdParam) : undefined

  useEffect(() => {
    setHeader("Detalhes do paciente", "Cadastro e ficha médica")
    return () => setHeader("", "")
  }, [setHeader])

  useEffect(() => {
    setRightContent(
      <Link
        href="/cadastros/pacientes"
        className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Voltar
      </Link>
    )
    return () => setRightContent(null)
  }, [setRightContent])

  const idPaciente = Number(id)
  if (!Number.isFinite(idPaciente)) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          Endereço inválido para um paciente.
        </div>
      </div>
    )
  }

  return (
    <PacienteDetalhe
      idPaciente={idPaciente}
      abaInicial={abaInicial}
      suspensaoIdInicial={suspensaoIdInicial}
    />
  )
}
