'use client'

import { numero } from '@/lib/roboSharepoint/rotulos'
import type { EsperadasPorEntrega } from '@/lib/remuneracao/situacaoEntregasPep'

// Evidências esperadas no mês × as que já estão na pasta, por TIPO de entrega
// (STC, ETC, TAP, TOP, PIC, RT, OE) e no total — geral, não por analista
// (pedido de 02/10/2026). Barras horizontais: o comprimento da trilha é o
// esperado, a parte cheia já está na pasta no padrão de nome. Cada entrega tem
// a sua cor. Evita violeta e azul, que na PEP são do robô e da pessoa.

const COR: Record<string, string> = {
  STC: '#0d8a4e', ETC: '#0f766e', TAP: '#d97706', TOP: '#e87ba4', PIC: '#eda100', RT: '#0891b2', OE: '#64748b',
}
const COR_TOTAL = '#334155'
const corDe = (sigla: string) => COR[sigla] ?? '#64748b'
const pct = (n: number, de: number) => (de > 0 ? Math.round((n / de) * 100) : 0)

function Linha({ rotulo, detalhe, naPasta, esperadas, cor, destaque = false }: {
  rotulo: string; detalhe?: string; naPasta: number; esperadas: number; cor: string; destaque?: boolean
}) {
  const p = pct(naPasta, esperadas)
  return (
    <li className={`grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 sm:grid-cols-[3.25rem_minmax(0,14rem)_minmax(0,1fr)_7.5rem] ${destaque ? 'rounded-xl bg-slate-50 px-3 py-3' : ''}`}>
      <span className="flex h-9 items-center justify-center rounded-lg text-xs font-black text-white" style={{ background: cor }} aria-hidden>{rotulo}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-slate-800">{destaque ? 'Todas as entregas' : detalhe}</span>
        <span className="block text-[11px] text-slate-500 sm:hidden">{numero(naPasta)} de {numero(esperadas)} · {p}%</span>
      </span>
      <span className="col-span-2 sm:col-span-1" role="img" aria-label={`${rotulo}: ${naPasta} de ${esperadas} na pasta (${p}%)`}>
        <span className="block h-4 overflow-hidden rounded-full" style={{ background: `${cor}2e` }}>
          <span className="block h-full rounded-full transition-[width] motion-reduce:transition-none" style={{ width: `${p}%`, minWidth: naPasta > 0 ? 6 : 0, background: cor }} />
        </span>
      </span>
      <span className="hidden text-right sm:block">
        <span className="block text-sm font-black tabular-nums text-slate-900">{numero(naPasta)} <span className="font-semibold text-slate-500">de {numero(esperadas)}</span></span>
        <span className="block text-[11px] tabular-nums text-slate-500">{p}% na pasta</span>
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
      <Linha rotulo="TOTAL" naPasta={naPasta} esperadas={esperadas} cor={COR_TOTAL} destaque />
      {entregas.map(e => (
        <Linha key={e.sigla} rotulo={e.sigla} detalhe={e.nome} naPasta={e.naPasta} esperadas={e.esperadas} cor={corDe(e.sigla)} />
      ))}
    </ul>
  )
}
