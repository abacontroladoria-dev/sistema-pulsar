'use client'

import type { EsperadasPorEntrega } from '@/lib/remuneracao/situacaoEntregasPep'
import { numero } from '@/lib/roboSharepoint/rotulos'

// Evidências esperadas no mês × as que já estão na pasta, por TIPO de entrega
// (STC, ETC, TAP, TOP, PIC, RT, OE) e no total — geral, não por analista
// (pedido de 02/10/2026). Barras horizontais: o comprimento da trilha é o
// esperado, a parte cheia já está na pasta no padrão de nome.

const pct = (n: number, de: number) => (de > 0 ? Math.round((n / de) * 100) : 0)

function Linha({ rotulo, detalhe, naPasta, esperadas, destaque = false }: {
  rotulo: string; detalhe?: string; naPasta: number; esperadas: number; destaque?: boolean
}) {
  const p = pct(naPasta, esperadas)
  return (
    <li
      className={`grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 sm:grid-cols-[3.25rem_minmax(0,14rem)_minmax(0,1fr)_7.5rem] ${destaque ? 'mb-2 border-b border-border pb-3' : ''}`}
    >
      <span
        className={`flex h-7 items-center justify-center rounded-md px-2 text-xs font-semibold ${
          destaque ? 'bg-foreground text-background' : 'bg-muted text-foreground'
        }`}
        aria-hidden
      >
        {rotulo}
      </span>
      <span className="min-w-0">
        <span className={`block truncate text-sm ${destaque ? 'font-semibold text-foreground' : 'font-medium text-foreground'}`}>
          {destaque ? 'Todas as entregas' : detalhe}
        </span>
        <span className="block text-xs text-muted-foreground sm:hidden">{numero(naPasta)} de {numero(esperadas)} · {p}%</span>
      </span>
      <span className="col-span-2 sm:col-span-1" role="img" aria-label={`${rotulo}: ${naPasta} de ${esperadas} na pasta (${p}%)`}>
        <span className="block h-2 overflow-hidden rounded-full bg-muted">
          <span
            className={`block h-full rounded-full transition-[width] motion-reduce:transition-none ${destaque ? 'bg-emerald-500' : 'bg-foreground/70'}`}
            style={{ width: `${p}%`, minWidth: naPasta > 0 ? 4 : 0 }}
          />
        </span>
      </span>
      <span className="hidden text-right sm:block">
        <span className="block text-sm font-semibold tabular-nums text-foreground">
          {numero(naPasta)} <span className="font-normal text-muted-foreground">de {numero(esperadas)}</span>
        </span>
        <span className="block text-xs tabular-nums text-muted-foreground">{p}% na pasta</span>
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
      <Linha rotulo="TOTAL" naPasta={naPasta} esperadas={esperadas} destaque />
      {entregas.map(e => (
        <Linha key={e.sigla} rotulo={e.sigla} detalhe={e.nome} naPasta={e.naPasta} esperadas={e.esperadas} />
      ))}
    </ul>
  )
}
