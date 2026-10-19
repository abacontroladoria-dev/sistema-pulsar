"use client"

import { memo } from "react"
import { ChevronRight } from "lucide-react"
import { StatusChip } from "@/components/ui/tones"
import { formatarData, formatarHorario } from "@/lib/exportarEvolucoes/formato"
import type { EvolucaoItem } from "@/types/exportarEvolucoes"

// Um atendimento evoluído. A caixa de seleção é um alvo próprio de 44 px; o resto
// do card abre o painel com o texto.
//
// A origem (TiTa/Pulsar) aparece SÓ aqui, na tela — o arquivo exportado não a
// mostra (regra R7).

export const ROTULO_ORIGEM = { tita: "TiTa", pulsar: "Pulsar" } as const

export const CardEvolucao = memo(function CardEvolucao({
  item,
  marcada,
  onMarcar,
  onAbrir,
}: {
  item: EvolucaoItem
  marcada: boolean
  onMarcar: (chave: string) => void
  onAbrir: (item: EvolucaoItem) => void
}) {
  const quando = `${formatarData(item.data)} · ${formatarHorario(item.hora_inicio, item.hora_fim).replace(" às ", "–")}`
  return (
    <li
      className={`flex items-stretch overflow-hidden rounded-xl border bg-card transition-colors ${
        marcada ? "border-sky-300 bg-sky-50/40 dark:border-sky-700 dark:bg-sky-950/20" : "border-border"
      }`}
    >
      <label className="flex min-h-11 w-12 shrink-0 cursor-pointer items-start justify-center pt-3.5">
        <input
          type="checkbox"
          checked={marcada}
          onChange={() => onMarcar(item.chave)}
          className="h-4 w-4 cursor-pointer accent-sky-700"
          aria-label={`Selecionar evolução de ${item.paciente_nome} em ${quando}`}
        />
      </label>
      <button
        type="button"
        onClick={() => onAbrir(item)}
        className="flex min-w-0 flex-1 items-center gap-2 py-2.5 pr-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[14px] font-semibold tabular-nums text-foreground">{quando}</span>
            <StatusChip tone="gray" dense>{ROTULO_ORIGEM[item.origem]}</StatusChip>
            {item.substituicao && <StatusChip tone="blue" dense>substituição</StatusChip>}
            {item.agendamento_id && (
              <span className="text-[12px] tabular-nums text-muted-foreground">ID {item.agendamento_id}</span>
            )}
          </div>
          <div className="text-[14px] font-semibold text-[oklch(0.48_0.092_217)] dark:text-sky-300">{item.terapia}</div>
          {/* Nomes inteiros: quebram linha em vez de virar "…". */}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
            <span>
              Paciente: <span className="text-foreground">{item.paciente_nome}</span>
            </span>
            <span>
              Profissional: <span className="text-foreground">{item.profissional_nome}</span>
            </span>
            {item.convenio && (
              <span>
                Convênio: <span className="text-foreground">{item.convenio}</span>
              </span>
            )}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    </li>
  )
})
