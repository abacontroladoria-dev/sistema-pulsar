"use client"

// SalaProfissionaisTab — quem usa a sala, uma linha por pessoa (não por
// alocação): quem atende segunda e quarta aparece uma vez, com os dois turnos.
// A grade responde "o que acontece na terça"; esta aba responde "quanto a
// Késia usa esta sala".

import { SITUACAO_LABEL, type LinhaProfissionalSala } from "@/lib/cronograma/salasView"
import { StatusPill } from "@/components/cronograma/ui/StatusPill"
import { tCor } from "@/lib/cronograma/constants"
import { SITUACAO_TONE, TERAPIA_MARCA_CLS } from "./salasVocabulario"

interface SalaProfissionaisTabProps {
  linhas: LinhaProfissionalSala[]
  onAbrirAlocacao: (alocacaoId: string) => void
}

export function SalaProfissionaisTab({ linhas, onAbrirAlocacao }: SalaProfissionaisTabProps) {
  if (linhas.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border py-12 text-center">
        <p className="text-sm font-semibold text-foreground">Nenhum profissional alocado</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Use a aba Ocupação semanal para alocar alguém num turno livre.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-150 border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <Th>Profissional</Th>
            <Th>Especialidade</Th>
            <Th>Turnos nesta sala</Th>
            <Th align="right">Sessões</Th>
            <Th>Situação</Th>
          </tr>
        </thead>
        <tbody>
          {linhas.map(l => (
            <tr key={l.profissionalNome} className="border-b border-border last:border-0">
              <td className="px-3 py-2 font-medium text-foreground">{l.profissionalNome}</td>
              <td className="px-3 py-2">
                {l.terapias.length === 0 ? (
                  // "—" = não se aplica / não existe. Aqui é literalmente isso:
                  // não há terapia registrada para esta pessoa nesta sala.
                  <span className="text-muted-foreground" title="Nenhuma especialidade registrada">—</span>
                ) : (
                  <span className="flex flex-wrap items-center gap-1.5">
                    {l.terapias.map(t => (
                      <span key={t} className="flex items-center gap-1 text-xs text-foreground">
                        <span className={TERAPIA_MARCA_CLS} style={{ background: tCor(t, true) }} aria-hidden />
                        {t}
                      </span>
                    ))}
                  </span>
                )}
              </td>
              <td className="px-3 py-2">
                <span className="flex flex-wrap gap-1">
                  {l.turnos.map(t => (
                    <button
                      key={t.alocacaoId}
                      type="button"
                      onClick={() => onAbrirAlocacao(t.alocacaoId)}
                      title={`${t.diaLabel} · ${t.turno} — ${SITUACAO_LABEL[t.situacao]}`}
                      className="inline-flex min-h-11 items-center rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
                    >
                      {t.diaLabel} {t.turno === "Manhã" ? "M" : "T"}
                    </button>
                  ))}
                </span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-foreground">
                {l.sessoesReais}
                <span className="text-muted-foreground"> / {l.sessoesCapacidade}</span>
              </td>
              <td className="px-3 py-2">
                <StatusPill tone={SITUACAO_TONE[l.situacao]} dense>{SITUACAO_LABEL[l.situacao]}</StatusPill>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      scope="col"
      className={`px-3 py-2 text-[11px] font-semibold text-muted-foreground ${align === "right" ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  )
}
