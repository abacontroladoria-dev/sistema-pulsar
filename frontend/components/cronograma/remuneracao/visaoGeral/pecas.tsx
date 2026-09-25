"use client"

// Peças visuais das visões gerais de Relacionamento Prestador — a da
// Remuneração Individual (individual/VisaoGeralIndividual.tsx) e a de Entregas
// PEP (pep/VisaoGeralPep.tsx). Nasceram dentro da primeira; subiram para cá
// quando a segunda precisou das mesmas, para as duas telas falarem a mesma
// língua visual (vocabulário do dashboard do /rp: barras CSS com clip-path,
// cartões com borda e sombra leve).

import type { ReactNode } from "react"

export const num = (n: number) => n.toLocaleString("pt-BR")
export const pct1 = (n: number) => `${n.toFixed(1).replace(".", ",")}%`

export function Card({ titulo, icone, acao, children, className = "" }: {
  titulo: string; icone: ReactNode; acao?: ReactNode; children: ReactNode; className?: string
}) {
  return (
    <section className={`rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5 ${className}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <span className="text-muted-foreground" aria-hidden>{icone}</span>
          {titulo}
        </h3>
        {acao}
      </div>
      {children}
    </section>
  )
}

export function Metric({ label, valor, cor }: { label: string; valor: string; cor?: string }) {
  return (
    <span className="flex flex-col">
      <span className="text-base font-bold tabular-nums leading-tight" style={cor ? { color: cor } : undefined}>{valor}</span>
      <span className="text-[11px] font-medium leading-tight text-muted-foreground">{label}</span>
    </span>
  )
}

/** Barra horizontal com clip-path (sem reflow por frame), como no /rp. */
export function BarraH({ fracao, cor }: { fracao: number; cor: string }) {
  const largura = Math.max(0, Math.min(100, fracao * 100))
  return (
    <span className="block h-2 w-full overflow-hidden rounded-full bg-muted">
      <span
        className="block h-full w-full"
        style={{
          background: cor,
          clipPath: `inset(0 ${100 - largura}% 0 0)`,
          transition: "clip-path 500ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      />
    </span>
  )
}

/** Barra empilhada de partes de um todo — cada segmento com seu tom. */
export function BarraEmpilhada({ partes }: { partes: { valor: number; cor: string; rotulo: string }[] }) {
  const total = partes.reduce((s, p) => s + p.valor, 0)
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img"
      aria-label={partes.filter(p => p.valor > 0).map(p => `${p.rotulo}: ${p.valor}`).join(", ")}>
      {total > 0 && partes.map(p => p.valor > 0 && (
        <div key={p.rotulo} className="h-full first:rounded-l-full last:rounded-r-full"
          style={{ width: `${(p.valor / total) * 100}%`, background: p.cor }} />
      ))}
    </div>
  )
}

export function Legenda({ cor, rotulo, valor, formatar = num }: {
  cor: string; rotulo: string; valor: number; formatar?: (v: number) => string
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="size-2 shrink-0 rounded-full" style={{ background: valor > 0 ? cor : "transparent", boxShadow: valor > 0 ? undefined : "inset 0 0 0 1px currentColor" }} aria-hidden />
      {rotulo}
      <span className="font-bold tabular-nums text-foreground">{formatar(valor)}</span>
    </span>
  )
}
