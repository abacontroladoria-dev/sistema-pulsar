"use client"

// SalasCardsGrid — a visão geral em cards. Só posiciona e delega: a derivação
// vive em `resumoCardSala` (camada 1) e o desenho em `SalaCard`.

import { useMemo } from "react"
import { DoorOpen } from "lucide-react"
import { useStatusLabels } from "@/hooks/useStatusLabels"
import { resumoCardSala } from "@/lib/cronograma/salasView"
import { SalaCard } from "./SalaCard"
import type { SalaComOcupacao } from "@/lib/cronograma/salasTypes"

interface SalasCardsGridProps {
  salas: SalaComOcupacao[]
  salasComExclusividade: Set<string>
  /** Rótulos dos filtros ativos, para o vazio dizer o que exatamente escondeu as salas. */
  filtrosAtivos?: string[]
  onVerDetalhes: (salaId: string) => void
  onEditarSala: (salaId: string) => void
}

export function SalasCardsGrid({ salas, salasComExclusividade, filtrosAtivos = [], onVerDetalhes, onEditarSala }: SalasCardsGridProps) {
  // Uma chamada para a grade inteira. `useStatusLabels` faz fetch próprio sem
  // cache, então chamá-lo dentro do card seria um fetch POR CARD — é o que
  // acontece hoje nas células de SalasGridView/SalasHeatmapView.
  const { labels: statusLabels, loading: statusCarregando } = useStatusLabels()

  // Um único useMemo para todos os resumos, não um por card: N useMemo custam
  // mais em bookkeeping do React do que a derivação em si.
  const resumos = useMemo(() => salas.map(resumoCardSala), [salas])

  if (resumos.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-center">
        <DoorOpen size={22} className="text-muted-foreground" />
        <p className="text-sm font-semibold text-foreground">Nenhuma sala neste recorte</p>
        {/* Dizer QUAIS filtros escondem as salas: "limpe algum filtro" obriga o
            usuário a caçar o culpado, e a lista já está calculada. */}
        <p className="max-w-sm text-xs text-muted-foreground">
          {filtrosAtivos.length > 0
            ? `Filtros ativos: ${filtrosAtivos.join(" · ")}. Remova um deles nos chips acima para ver mais salas.`
            : "Nenhuma sala cadastrada ainda."}
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {resumos.map(resumo => (
        <SalaCard
          key={resumo.sala.id}
          resumo={resumo}
          temExclusividade={salasComExclusividade.has(resumo.sala.id)}
          statusLabel={statusLabels[resumo.sala.status]}
          statusCarregando={statusCarregando}
          onVerDetalhes={onVerDetalhes}
          onEditarSala={onEditarSala}
        />
      ))}
    </div>
  )
}
