'use client'

import { numero } from '@/lib/roboSharepoint/rotulos'
import type { EsperadasPorEntrega } from '@/lib/remuneracao/situacaoEntregasPep'

// Evidências esperadas no mês × as que já estão na pasta, por TIPO de entrega
// (STC, ETC, TAP, TOP, PIC, RT, OE) e no total — geral, não por analista
// (pedido de 02/10/2026). Barras horizontais: o comprimento da trilha é o
// esperado, a parte cheia já está na pasta no padrão de nome. Cada entrega tem
// a sua cor. Evita violeta e azul, que na PEP são do robô e da pessoa.

// Visual pastel (docs/PLANO_PEP_VISUAL_PASTEL.md, fase 1): o MESMO matiz de
// cada sigla de antes, agora no tom pastel do kit (trilha --c-linha, cheio
// --c-medio, selo --c com texto escuro). O selo branco sobre o amarelo do PIC
// ficava abaixo de 4,5:1.
const MATIZ: Record<string, { h: number; k: number }> = {
  STC: { h: 150, k: 1 }, ETC: { h: 185, k: 0.9 }, TAP: { h: 58, k: 1.15 }, TOP: { h: 350, k: 0.95 },
  PIC: { h: 95, k: 1.1 }, RT: { h: 215, k: 0.9 }, OE: { h: 257, k: 0.25 },
}
const MATIZ_TOTAL = { h: 257, k: 0.35 }
const estiloTom = (m: { h: number; k: number }) => ({ '--h': m.h, '--k': m.k }) as React.CSSProperties
const pct = (n: number, de: number) => (de > 0 ? Math.round((n / de) * 100) : 0)

function Linha({ rotulo, detalhe, naPasta, esperadas, matiz, destaque = false }: {
  rotulo: string; detalhe?: string; naPasta: number; esperadas: number; matiz: { h: number; k: number }; destaque?: boolean
}) {
  const p = pct(naPasta, esperadas)
  return (
    <li
      className={`pp-tom grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 sm:grid-cols-[3.25rem_minmax(0,14rem)_minmax(0,1fr)_7.5rem] ${destaque ? 'mb-2 border-b border-[var(--pp-border)] pb-4' : ''}`}
      style={estiloTom(matiz)}
    >
      <span className="flex h-9 items-center justify-center rounded-xl bg-[var(--c)] text-xs font-extrabold text-[var(--c-sobre)]" aria-hidden>{rotulo}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-extrabold">{destaque ? 'Todas as entregas' : detalhe}</span>
        <span className="block text-xs font-semibold text-[var(--pp-ink-muted)] sm:hidden">{numero(naPasta)} de {numero(esperadas)} · {p}%</span>
      </span>
      <span className="col-span-2 sm:col-span-1" role="img" aria-label={`${rotulo}: ${naPasta} de ${esperadas} na pasta (${p}%)`}>
        <span className="block h-3.5 overflow-hidden rounded-full bg-[var(--c-linha)]">
          <span className="block h-full rounded-full bg-[var(--c-medio)] transition-[width] motion-reduce:transition-none" style={{ width: `${p}%`, minWidth: naPasta > 0 ? 6 : 0 }} />
        </span>
      </span>
      <span className="hidden text-right sm:block">
        <span className="block text-sm font-extrabold tabular-nums">{numero(naPasta)} <span className="font-semibold text-[var(--pp-ink-muted)]">de {numero(esperadas)}</span></span>
        <span className="block text-xs font-semibold tabular-nums text-[var(--c-tinta)]">{p}% na pasta</span>
      </span>
    </li>
  )
}

export function EsperadasChart({ entregas }: { entregas: EsperadasPorEntrega[] }) {
  if (entregas.length === 0) return null
  const esperadas = entregas.reduce((s, e) => s + e.esperadas, 0)
  const naPasta = entregas.reduce((s, e) => s + e.naPasta, 0)
  return (
    <ul className="space-y-3" aria-label="Evidências esperadas e na pasta, por tipo de entrega">
      <Linha rotulo="TOTAL" naPasta={naPasta} esperadas={esperadas} matiz={MATIZ_TOTAL} destaque />
      {entregas.map(e => (
        <Linha key={e.sigla} rotulo={e.sigla} detalhe={e.nome} naPasta={e.naPasta} esperadas={e.esperadas} matiz={MATIZ[e.sigla] ?? MATIZ.OE} />
      ))}
    </ul>
  )
}
