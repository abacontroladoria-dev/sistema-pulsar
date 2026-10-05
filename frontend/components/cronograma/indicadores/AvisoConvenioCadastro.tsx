"use client"

// Faixa âmbar das telas que usam o convênio do cadastro da TiTa (Dashboard de
// Pacientes e Previsão de Receitas) — um componente só para as duas dizerem
// exatamente a mesma coisa quando a TiTa falha. Ver lib/cronograma/convenioCadastro.ts.

import { AlertTriangle } from "lucide-react"
import type { ConvenioCadastroState } from "@/hooks/useConvenioCadastroPacientes"

export function AvisoConvenioCadastro({ cadastro }: { cadastro: ConvenioCadastroState }) {
  const cadastroDisponivel = !!cadastro.mapa
  if (cadastroDisponivel && !cadastro.obsoleto) return null
  return (
    <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span>
        {cadastroDisponivel
          ? "A TiTa não respondeu agora: o convênio vem do último cadastro consultado, que pode estar desatualizado."
          : `Convênio do cadastro TiTa indisponível${cadastro.erro ? ` (${cadastro.erro})` : ""} — exibindo o convênio da agenda.`}
      </span>
    </div>
  )
}
