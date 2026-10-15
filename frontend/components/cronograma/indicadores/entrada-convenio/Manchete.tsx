"use client"

// Manchete do Painel de Entrada: a frase que diz quantos estão fora do prazo e
// em quais setores, a barra atrasados / vencem hoje / no prazo (que também é o
// filtro de status dos blocos) e a mediana até o início contra a meta.

import { Check, X } from "lucide-react"
import { TONE_SOFT } from "@/components/cronograma/ui/tones"
import type { Manchete as DadosManchete, StatusFiltro } from "@/lib/indicadores/entradaConvenio"

const SEGMENTOS: { status: StatusFiltro; cor: string; um: string; varios: string; tom: keyof typeof TONE_SOFT }[] = [
  { status: "atrasado", cor: "bg-rose-500", um: "atrasado", varios: "atrasados", tom: "red" },
  { status: "vence hoje", cor: "bg-amber-400", um: "vence hoje", varios: "vencem hoje", tom: "amber" },
  { status: "no prazo", cor: "bg-emerald-500", um: "no prazo", varios: "no prazo", tom: "green" },
]

export function Manchete({ m, mediana, meta, status, onStatus }: {
  m: DadosManchete
  mediana: number | null
  meta: number
  status: StatusFiltro | null
  onStatus: (s: StatusFiltro | null) => void
}) {
  const contagem: Record<StatusFiltro, number> = { "atrasado": m.atrasados, "vence hoje": m.venceHoje, "no prazo": m.noPrazo }
  const outros = Math.max(0, m.total - m.atrasados - m.venceHoje - m.noPrazo)
  const dentroDaMeta = mediana != null && mediana <= meta

  return (
    <section aria-labelledby="entrada-manchete" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <div>
        <h2 id="entrada-manchete" className="text-lg font-black leading-snug text-foreground sm:text-xl">{m.titulo}</h2>
        {m.apoio && <p className="mt-0.5 text-sm text-muted-foreground">{m.apoio}</p>}
      </div>

      {m.total > 0 && (
        <div className="flex flex-col gap-2">
          <div aria-hidden className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted">
            {SEGMENTOS.map(s => contagem[s.status] > 0 && (
              <div
                key={s.status}
                className={`${s.cor} transition-opacity ${status && status !== s.status ? "opacity-25" : ""}`}
                style={{ flexGrow: contagem[s.status] }}
              />
            ))}
            {outros > 0 && <div className={`bg-slate-400 ${status ? "opacity-25" : ""}`} style={{ flexGrow: outros }} />}
          </div>
          <div role="group" aria-label="Mostrar só" className="flex flex-wrap items-center gap-1.5">
            {SEGMENTOS.map(s => {
              const n = contagem[s.status]
              const ativo = status === s.status
              return (
                <button
                  key={s.status}
                  type="button"
                  aria-pressed={ativo}
                  disabled={n === 0 && !ativo}
                  onClick={() => onStatus(ativo ? null : s.status)}
                  title={ativo ? "Mostrar todos de novo" : `Mostrar só quem ${n === 1 ? "está" : "estão"} ${s.varios}`}
                  className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50 sm:min-h-8 ${
                    ativo
                      ? `border-transparent ${TONE_SOFT[s.tom].bg} ${TONE_SOFT[s.tom].text} ring-2 ring-inset ring-current`
                      : "border-border bg-card text-foreground hover:bg-muted"
                  }`}
                >
                  <span aria-hidden className={`h-2 w-2 rounded-full ${s.cor}`} />
                  <span className="tabular-nums">{n}</span> {n === 1 ? s.um : s.varios}
                  {ativo && <X size={12} aria-hidden />}
                </button>
              )
            })}
            {outros > 0 && (
              <span className="px-1 text-xs text-muted-foreground">
                <span className="tabular-nums">{outros}</span> sem data ou fora de ordem
              </span>
            )}
          </div>
        </div>
      )}

      {mediana != null && (
        <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          Da entrada à 1ª sessão: mediana de
          <b className="tabular-nums text-foreground">{mediana} dias úteis</b>
          (meta {meta})
          <span className={`inline-flex items-center gap-0.5 font-semibold ${dentroDaMeta ? TONE_SOFT.green.text : TONE_SOFT.red.text}`}>
            {dentroDaMeta ? <Check size={13} aria-hidden /> : <X size={13} aria-hidden />}
            {dentroDaMeta ? "dentro da meta" : "acima da meta"}
          </span>
        </p>
      )}
    </section>
  )
}
