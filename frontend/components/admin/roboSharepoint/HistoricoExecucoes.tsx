'use client'

import { useState } from 'react'
import { dataHora, GATILHOS, MODOS, segundos } from '@/lib/roboSharepoint/rotulos'
import type { RoboExecucao } from '@/types/roboSharepoint'

// Duração das últimas execuções, da mais antiga (esquerda) para a mais nova.
// Uma série só (duração), então sem legenda: a cor da barra é o ESTADO da
// execução (emerald concluída, rose falhou, sky em andamento) e o estado vai
// escrito no tooltip e na tabela logo abaixo — nunca só pela cor.
//
// A linha tracejada é a meta de 15 s por execução, que o plano prometeu.

const META_MS = 15000
const ALTURA = 120

function corDaBarra(e: RoboExecucao) {
  if (e.status === 'erro') return 'fill-rose-600'
  if (e.status === 'executando') return 'fill-sky-600'
  return 'fill-emerald-600'
}

const textoStatus = (e: RoboExecucao) => (e.status === 'erro' ? 'Falhou' : e.status === 'executando' ? 'Executando' : 'Concluída')

export function HistoricoExecucoes({ execucoes }: { execucoes: RoboExecucao[] }) {
  const [foco, setFoco] = useState<string | null>(null)
  const serie = [...execucoes].reverse()
  if (serie.length === 0) return <p className="text-sm text-slate-500">Sem histórico ainda.</p>

  const maxMs = Math.max(META_MS * 1.2, ...serie.map(e => e.duracao_ms ?? 0))
  const y = (ms: number) => ALTURA - (ms / maxMs) * ALTURA
  const larguraBarra = 100 / Math.max(serie.length, 10)
  const focado = serie.find(e => e.id === foco) ?? null

  return (
    <div>
      <div className="relative">
        <svg viewBox={`0 0 100 ${ALTURA}`} preserveAspectRatio="none" className="h-32 w-full" role="img"
          aria-label={`Duração das últimas ${serie.length} execuções; detalhes na tabela abaixo`}>
          <line x1="0" x2="100" y1={y(META_MS)} y2={y(META_MS)} className="stroke-slate-300" strokeWidth="0.6"
            strokeDasharray="1.5 1.5" vectorEffect="non-scaling-stroke" />
          {serie.map((e, i) => {
            const h = Math.max(2, ALTURA - y(e.duracao_ms ?? 0))
            return (
              <g key={e.id}>
                {/* Área de toque maior que a barra (coluna inteira). */}
                <rect x={i * larguraBarra} y={0} width={larguraBarra} height={ALTURA} fill="transparent"
                  onMouseEnter={() => setFoco(e.id)} onMouseLeave={() => setFoco(null)}
                  onFocus={() => setFoco(e.id)} onBlur={() => setFoco(null)} tabIndex={0}
                  aria-label={`${dataHora(e.iniciado_em)}: ${textoStatus(e)}, ${segundos(e.duracao_ms)}`} />
                <rect x={i * larguraBarra + larguraBarra * 0.15} y={ALTURA - h} width={larguraBarra * 0.7} height={h} rx="0.8"
                  className={`${corDaBarra(e)} pointer-events-none ${foco && foco !== e.id ? 'opacity-40' : ''}`} />
              </g>
            )
          })}
        </svg>
        <span className="pointer-events-none absolute right-0 text-[11px] text-slate-500" style={{ top: `${(y(META_MS) / ALTURA) * 100}%`, transform: 'translateY(-100%)' }}>
          meta 15 s
        </span>
      </div>

      <div className="mt-2 min-h-5 text-xs text-slate-600" aria-live="polite">
        {focado
          ? <>{dataHora(focado.iniciado_em)} · {textoStatus(focado)} · <strong className="tabular-nums">{segundos(focado.duracao_ms)}</strong> · {GATILHOS[focado.gatilho]} · {focado.metricas?.ms_banco ?? '—'} ms no banco</>
          : <span className="text-slate-400">Passe o mouse numa barra para ver a execução.</span>}
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
              <th className="pb-2 pr-3">Quando</th>
              <th className="pb-2 pr-3">Origem</th>
              <th className="pb-2 pr-3">Situação</th>
              <th className="pb-2 pr-3 text-right">Duração</th>
              <th className="pb-2 pr-3 text-right">No banco</th>
              <th className="pb-2 pr-3 text-right">Maior chamada</th>
              <th className="pb-2 text-right">Arquivos novos</th>
            </tr>
          </thead>
          <tbody>
            {execucoes.map(e => (
              <tr key={e.id} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-3 tabular-nums text-slate-700">{dataHora(e.iniciado_em)}</td>
                <td className="py-2 pr-3 text-slate-600">
                  {GATILHOS[e.gatilho]}
                  {e.modo !== 'producao' && <span className="ml-1 text-xs text-slate-400">({MODOS[e.modo]})</span>}
                  {e.solicitado_por_nome && <span className="block text-xs text-slate-400">{e.solicitado_por_nome}</span>}
                </td>
                <td className="py-2 pr-3">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                    e.status === 'erro' ? 'bg-rose-50 text-rose-700' : e.status === 'executando' ? 'bg-sky-50 text-sky-700' : 'bg-emerald-50 text-emerald-700'
                  }`}>{textoStatus(e)}</span>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-700">{segundos(e.duracao_ms)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-600">{e.metricas?.ms_banco != null ? `${e.metricas.ms_banco} ms` : '—'}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-600">{e.metricas?.ms_maior_chamada_banco ? `${e.metricas.ms_maior_chamada_banco} ms` : '—'}</td>
                <td className="py-2 text-right tabular-nums text-slate-600">{e.resumo?.novos ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
