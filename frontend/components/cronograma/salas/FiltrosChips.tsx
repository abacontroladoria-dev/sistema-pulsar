"use client"

// FiltrosChips — o que está filtrado AGORA, sempre visível.
//
// Existe por causa do risco de esconder filtros atrás de "Mais filtros": um
// filtro ativo e invisível faz o usuário concluir que a sala sumiu do sistema.
// Cada chip diz o que está ativo e some com um clique.
//
// A lista de chips vem de `chipsDeFiltro` (camada 1) — este componente não
// decide o que é um chip, só desenha.

import { X } from "lucide-react"
import type { ChipFiltro } from "@/lib/cronograma/salasView"

interface FiltrosChipsProps {
  chips: ChipFiltro[]
  onRemover: (chip: ChipFiltro) => void
  onLimparTudo: () => void
}

export function FiltrosChips({ chips, onRemover, onLimparTudo }: FiltrosChipsProps) {
  if (chips.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map(chip => (
        <button
          key={`${chip.campo}-${chip.valor ?? ""}`}
          type="button"
          onClick={() => onRemover(chip)}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Remover filtro ${chip.label}`}
        >
          {chip.label}
          <X size={11} className="text-muted-foreground" aria-hidden />
        </button>
      ))}
      {chips.length > 1 && (
        <button
          type="button"
          onClick={onLimparTudo}
          className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Limpar tudo
        </button>
      )}
    </div>
  )
}
