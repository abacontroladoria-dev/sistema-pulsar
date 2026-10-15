"use client"

// Placar do "Quem precisa agir": uma linha por setor (o responsável fica no
// "i" ao lado do nome) e as contagens em colunas NOMEADAS (atrasados, vencem
// hoje, no prazo, total) — o número nunca aparece solto. Tocar na linha leva ao
// bloco do setor.

import { ChevronRight, Info } from "lucide-react"
import { InfoTooltip } from "@/components/cronograma/ui/InfoTooltip"
import { TONE_SOFT } from "@/components/cronograma/ui/tones"
import type { BlocoSetor } from "@/lib/indicadores/entradaConvenio"

export function irParaSetor(slug: string) {
  const alvo = document.getElementById(`setor-${slug}`)
  if (!alvo) return
  alvo.scrollIntoView({ behavior: "smooth", block: "start" })
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#setor-${slug}`)
}

function Numero({ n, tom }: { n: number; tom: "red" | "amber" | "green" | null }) {
  if (n === 0) return <span className="text-muted-foreground/60">0</span>
  return <span className={`font-black ${tom ? TONE_SOFT[tom].text : "text-foreground"}`}>{n}</span>
}

export function PlacarSetores({ blocos }: { blocos: BlocoSetor[] }) {
  const cab = "py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
  const th = `${cab} px-2 text-right`
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <table className="w-full text-sm">
        <caption className="sr-only">Pacientes por setor responsável e situação do prazo. Toque no setor para ver a lista.</caption>
        <thead className="border-b border-border bg-muted/40">
          <tr>
            <th scope="col" className={`${cab} pl-3 pr-2 text-left sm:pl-4`}>Setor</th>
            <th scope="col" className={th}>Atrasados</th>
            <th scope="col" className={th}><span className="sm:hidden">Hoje</span><span className="hidden sm:inline">Vencem hoje</span></th>
            <th scope="col" className={th}>No prazo</th>
            <th scope="col" className={`${th} hidden pr-3 sm:table-cell sm:pr-4`}>Total</th>
            <th scope="col" className="w-8"><span className="sr-only">Abrir</span></th>
          </tr>
        </thead>
        <tbody>
          {blocos.map(b => {
            const noPrazo = b.demais.filter(p => p.atual.status === "no prazo").length
            const atrasados = b.atrasados.length
            return (
              <tr
                key={b.slug}
                role="button"
                tabIndex={0}
                aria-label={`${b.familia ? "Aguardando a família" : b.setor}: ir para a lista`}
                onClick={() => irParaSetor(b.slug)}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); irParaSetor(b.slug) } }}
                className={`cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                  b.familia ? "text-muted-foreground" : ""
                }`}
              >
                <td className={`py-1.5 pl-3 pr-2 sm:py-2.5 sm:pl-4 ${!b.familia && atrasados ? "shadow-[inset_3px_0_0_var(--color-rose-500)]" : ""}`}>
                  <span className="inline-flex items-center gap-0.5">
                    <span className={`font-bold ${b.familia ? "" : "text-foreground"}`}>{b.familia ? "Aguardando a família" : b.setor}</span>
                    {/* O responsável fica no "i": a linha mostra só o setor. O
                        span segura teclado e clique para não disparar a linha. */}
                    <span onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                      <InfoTooltip
                        ariaLabel={b.familia ? "Sobre aguardando a família" : `Responsável por ${b.setor}`}
                        largura={260}
                        icone={<span className="inline-flex h-9 w-9 items-center justify-center sm:h-6 sm:w-6"><Info size={15} aria-hidden /></span>}
                      >
                        {b.familia ? (
                          <p>Não depende da equipe: acompanhar o retorno do responsável.</p>
                        ) : (
                          <div className="flex flex-col gap-1">
                            <p>
                              <span className="text-muted-foreground">Responsável: </span>
                              {/* Sem as unidades entre parênteses: o bloco do setor mostra o nome completo. */}
                              <b>{b.responsavel.pessoas.replace(/\s*\([^)]*\)/g, "") || "—"}</b>
                            </p>
                            {b.responsavel.faz && <p className="text-muted-foreground">{b.responsavel.faz}</p>}
                          </div>
                        )}
                      </InfoTooltip>
                    </span>
                  </span>
                </td>
                <td className="px-2 text-right text-base tabular-nums"><Numero n={atrasados} tom={b.familia ? null : "red"} /></td>
                <td className="px-2 text-right text-base tabular-nums"><Numero n={b.venceHoje.length} tom={b.familia ? null : "amber"} /></td>
                <td className="px-2 text-right text-base tabular-nums"><Numero n={noPrazo} tom={null} /></td>
                <td className="hidden px-2 pr-3 text-right tabular-nums text-muted-foreground sm:table-cell sm:pr-4">{b.total}</td>
                <td className="pr-2 text-muted-foreground"><ChevronRight size={16} aria-hidden /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
