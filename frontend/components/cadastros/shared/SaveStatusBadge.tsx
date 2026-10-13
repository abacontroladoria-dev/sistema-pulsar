"use client"

import { Check, Loader2, AlertCircle } from "lucide-react"
import type { SaveStatus } from "@/hooks/useDraftRow"

export function SaveStatusBadge({ status, errorMessage }: { status: SaveStatus; errorMessage?: string | null }) {
  if (status === "idle") return <span className="inline-block w-16" />
  if (status === "dirty") {
    return <span className="text-[10px] font-semibold text-[var(--status-atencao)] w-16 inline-block">não salvo</span>
  }
  if (status === "saving") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-sky-600 dark:text-sky-400 w-16">
        <Loader2 size={10} className="animate-spin" /> salvando
      </span>
    )
  }
  if (status === "saved") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-[var(--status-ok)] w-16 animate-in fade-in duration-200">
        <Check size={10} /> salvo
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-rose-600 dark:text-rose-400 w-16" title={errorMessage || "Erro ao salvar. Tente editar o campo novamente."}>
      <AlertCircle size={10} /> erro
    </span>
  )
}
