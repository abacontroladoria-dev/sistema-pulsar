'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, History } from 'lucide-react'
import { listarAvisosEvidencias } from '@/services/roboSharepoint.service'
import type { EventoEvidencia } from '@/types/roboSharepoint'
import { CartaoEvento } from './CartaoEvento'

// Na tela Entregas PEP: as entregas que mudaram porque a evidência saiu da
// pasta no SharePoint (20261003100000). A entrega e o valor acompanham a
// pasta; este bloco deixa à vista o que mudou, de quem era e quando. Some
// quando não há nada nos últimos 30 dias (ou sem a migration).

const INICIAIS = 4

export function AvisosEvidencias({ cartao }: { cartao: string }) {
  const [avisos, setAvisos] = useState<EventoEvidencia[] | null>(null)
  const [todos, setTodos] = useState(false)

  useEffect(() => {
    let vivo = true
    listarAvisosEvidencias(30).then(a => { if (vivo) setAvisos(a) })
    return () => { vivo = false }
  }, [])

  if (!avisos || avisos.length === 0) return null
  const visiveis = todos ? avisos : avisos.slice(0, INICIAIS)

  return (
    <section className={cartao} aria-labelledby="titulo-avisos-evidencias">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="titulo-avisos-evidencias" className="flex items-center gap-2 text-base font-bold text-slate-800">
            <History className="h-4 w-4 text-brand-fg" aria-hidden /> Entregas que mudaram com o SharePoint
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Últimos 30 dias. Quando uma evidência sai da pasta, a entrega e o valor acompanham — mês liberado não muda.
          </p>
        </div>
        <span className="text-xs font-semibold text-slate-600">{avisos.length} {avisos.length === 1 ? 'mudança' : 'mudanças'}</span>
      </div>
      <ul className="space-y-2">
        {visiveis.map(e => <li key={e.id}><CartaoEvento e={e} compacto /></li>)}
      </ul>
      {avisos.length > INICIAIS && (
        <button type="button" onClick={() => setTodos(v => !v)} aria-expanded={todos}
          className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-brand-fg hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
          {todos ? 'Mostrar menos' : `Ver as ${avisos.length}`}
          <ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${todos ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      )}
    </section>
  )
}
