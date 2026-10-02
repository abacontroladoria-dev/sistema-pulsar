"use client"

// Indicador minimalista de dia+turno (5 letras de dia + M/T) — extraído de
// SugestoesContratacaoPanel.tsx pra ser reaproveitado em qualquer card que
// precise mostrar "quando" sem desenhar a grade inteira.

import { DIAS_UTIL } from "@/lib/cronograma/constants"
import { diaCurto, turnoNome } from "@/lib/cronograma/helpers"
import type { Turno } from "@/lib/cronograma/simulacaoNovoPrestador"
import type { Tom } from "@/components/ui/pastel/pecas"

export function IndicadorDiaTurno({ dia, turnos, t }: { dia: string; turnos: Turno[]; t: Tom }) {
  const ppTomCls = `pp-tom pp-t-${t} bg-[var(--c-tinta)] text-[var(--c-sobre-tinta)]`
  return (
    <div className="mt-2 flex flex-nowrap items-center gap-3">
      <div className="flex items-center gap-1">
        {DIAS_UTIL.map(d => {
          const ativo = d === dia
          return (
            <span
              key={d}
              className={`flex h-6 w-6 items-center justify-center rounded-xl text-[11px] font-bold ${ativo ? ppTomCls : "bg-[var(--pp-muted)] text-[var(--pp-ink-muted)]"}`}
            >
              {diaCurto(d)[0]}
            </span>
          )
        })}
      </div>
      <span className="h-5 w-px shrink-0 bg-[var(--pp-border)]" />
      <div className="flex items-center gap-2">
        {(["manha", "tarde"] as Turno[]).map(turno => {
          const ativo = turnos.includes(turno)
          return (
            <span
              key={turno}
              className={`rounded-xl px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${ativo ? ppTomCls : "bg-[var(--pp-muted)] text-[var(--pp-ink-muted)]"}`}
            >
              {turnoNome[turno][0]}
            </span>
          )
        })}
      </div>
    </div>
  )
}
