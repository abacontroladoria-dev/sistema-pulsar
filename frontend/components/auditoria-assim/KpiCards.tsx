'use client'

import { Calendar } from 'lucide-react'
import type { KpisAuditoriaAssim } from './types'
import { KPI_VISUAL, ORDEM_KPIS_CARD, type VisualKpi } from './kpisVisual'

type Props = {
  kpis: KpisAuditoriaAssim | null
  loading?: boolean
  activeFilter: string
  totalFiltrados?: number
  onFilter: (situacao: string) => void
}

/** O visual do card mais o número daquele recorte. */
type KpiConfig = VisualKpi & { value: number }

export default function KpiCards({ kpis, loading, activeFilter, totalFiltrados, onFilter }: Props) {
  // Tudo que estava na agenda, inclusive o que não virou sessão: as duas faltas
  // e o dia de unidade fechada. `kpis.total` conta só o ciclo de autorização.
  const total =
    (kpis?.total ?? 0) +
    (kpis?.faltas ?? 0) +
    (kpis?.faltas_terapeuta ?? 0) +
    (kpis?.unidade_fechada ?? 0)

  const cards: KpiConfig[] = ORDEM_KPIS_CARD.map((metrica) => {
    const visual = KPI_VISUAL[metrica]
    // A dica de Glosas é a única dinâmica: as já cobertas por vínculo aparecem
    // como dica, e não somadas — "houve glosa" continua na tela sem inflar o
    // número que a operação usa para dimensionar trabalho. Some quando é zero,
    // porque dica que diz "0" é ruído.
    if (metrica === 'glosas' && kpis?.glosas_resolvidas) {
      const n = kpis.glosas_resolvidas
      return { ...visual, value: kpis.glosas, hint: `+${n} resolvida${n > 1 ? 's' : ''}` }
    }
    return { ...visual, value: kpis?.[metrica] ?? 0 }
  })

  return (
    <section className="flex flex-col gap-2 xl:flex-row pt-0.5">
      <TotalCard
        total={total}
        loading={loading}
        active={activeFilter === ''}
        totalFiltrados={totalFiltrados}
        onFilter={() => onFilter('')}
      />
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-9 flex-1">
        {cards.map((card) => (
          <KpiCard
            key={card.key}
            card={card}
            total={total}
            loading={loading}
            active={activeFilter === card.situacao}
            onFilter={() => onFilter(activeFilter === card.situacao ? '' : card.situacao)}
          />
        ))}
      </div>
    </section>
  )
}

function TotalCard({
  total,
  loading,
  active,
  totalFiltrados,
  onFilter,
}: {
  total: number
  loading?: boolean
  active: boolean
  totalFiltrados?: number
  onFilter: () => void
}) {
  const bars = [35, 55, 42, 68, 52, 78, 62, 88, 72, 95]
  const isFiltered = totalFiltrados !== undefined

  return (
    <button
      onClick={onFilter}
      className={`
        relative overflow-hidden
        xl:w-40 xl:shrink-0
        flex flex-col items-center justify-between
        rounded-2xl p-2.5 pt-3
        bg-linear-to-br from-[oklch(0.52_0.092_217)] to-[oklch(0.34_0.070_217)]
        shadow-md min-h-24
        cursor-pointer text-left
        transition hover:-translate-y-px hover:shadow-lg
        border-2
        ${active ? 'border-white/60' : 'border-transparent'}
      `}
    >
      <div className="relative z-10 flex flex-col items-center gap-1 w-full">
        <div className="h-8 w-8 rounded-full bg-white/15 flex items-center justify-center mb-1">
          <Calendar size={17} className="text-white" />
        </div>

        <span className="text-[10px] font-bold uppercase tracking-widest text-[oklch(0.86_0.040_217)] leading-tight text-center">
          Total de Sessões
        </span>

        {isFiltered ? (
          <div className="flex flex-col items-center mt-1">
            <span className="text-4xl font-bold text-white leading-none">
              {loading ? '—' : totalFiltrados}
            </span>
            <span className="text-[11px] text-[oklch(0.82_0.045_217)] mt-0.5">
              {loading ? '' : `/ ${total} no dia`}
            </span>
          </div>
        ) : (
          <>
            <span className="text-4xl font-bold text-white leading-none mt-1">
              {loading ? '—' : total}
            </span>
            <span className="text-[11px] text-[oklch(0.82_0.045_217)] mt-0.5">100% do total</span>
          </>
        )}
      </div>

      <div className="absolute bottom-0 left-0 right-0 flex items-end gap-0.75 px-3 z-0">
        {bars.map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-[3px] bg-white/10"
            style={{ height: `${h * 0.55}px` }}
          />
        ))}
      </div>
    </button>
  )
}

function KpiCard({
  card,
  total,
  loading,
  active,
  onFilter,
}: {
  card: KpiConfig
  total: number
  loading?: boolean
  active: boolean
  onFilter: () => void
}) {
  const Icon = card.icon
  const percent = total > 0 ? Math.round((card.value / total) * 100) : 0

  return (
    <button
      onClick={onFilter}
      className={`
        group flex flex-col items-center w-full
        rounded-xl p-1.5 shadow-sm
        cursor-pointer text-left
        transition hover:-translate-y-px hover:shadow-md
        border-2
        ${active
          ? `${card.borderActive} ${card.bgActive}`
          : `border-slate-200/80 bg-white ${card.hoverBorder}`
        }
      `}
    >
      <div className="w-full">
        <div className={`h-7 w-7 rounded-full flex items-center justify-center mx-auto ${card.iconTone}`}>
          <Icon size={13} />
        </div>
        <div className="mt-1.5">
          <p className="text-[11px] font-semibold text-slate-600 leading-snug text-center whitespace-pre-line">
            {card.title}
          </p>
          {card.hint && (
            <p className="text-[10px] text-slate-400 leading-tight mt-0.5 text-center">{card.hint}</p>
          )}
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center">
        <span className={`text-2xl font-bold leading-none ${card.tone}`}>
          {loading ? '—' : card.value}
        </span>
      </div>

      <div className="w-full px-1">
        <div className="flex justify-center mb-1.5">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${card.iconTone}`}>
            {loading ? '' : `${percent}%`}
          </span>
        </div>
        <div className="h-1 rounded-full bg-slate-100 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${card.barTone}`}
            style={{ width: `${loading ? 0 : percent}%` }}
          />
        </div>
      </div>
    </button>
  )
}
