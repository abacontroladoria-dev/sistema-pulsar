"use client"

import { CalendarDays, Clock, Building2, Users } from "lucide-react"
import {
  FluxoSlotPoint,
  FluxoUnitCount,
  getMostActiveUnit,
  getPeakSlot,
  getDailyAverage,
} from "./data"

interface KpiMiniCardsProps {
  slotData: FluxoSlotPoint[]
  atendimentos: FluxoUnitCount | null
  terapeutas: FluxoUnitCount | null
  loading?: boolean
}

interface MiniCardProps {
  title: string
  value: string
  sub: string
  icon: React.ReactNode
  iconBg: string
  valueColor?: string
  subColor?: string
  loading?: boolean
}

function MiniCard({
  title,
  value,
  sub,
  icon,
  iconBg,
  valueColor = "text-slate-800",
  subColor = "text-slate-400",
  loading,
}: MiniCardProps) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 flex items-start gap-3 min-w-0">
      <div className={`${iconBg} rounded-xl p-2.5 shrink-0`}>{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-400 font-medium leading-tight truncate">{title}</p>
        {loading ? (
          <div className="mt-1 space-y-1.5">
            <div className="h-7 w-16 bg-slate-100 rounded-md animate-pulse" />
            <div className="h-3 w-24 bg-slate-100 rounded animate-pulse" />
          </div>
        ) : (
          <>
            <p className={`text-2xl font-bold ${valueColor} leading-tight mt-0.5`}>{value}</p>
            <p className={`text-xs ${subColor} mt-0.5 truncate`}>{sub}</p>
          </>
        )}
      </div>
    </div>
  )
}

export default function KpiMiniCards({
  slotData,
  atendimentos,
  terapeutas,
  loading,
}: KpiMiniCardsProps) {
  const total = atendimentos?.total ?? 0
  const peak = getPeakSlot(slotData)
  const activeUnit = getMostActiveUnit(atendimentos)
  const totalTerapeutas = terapeutas?.total ?? 0

  const avgLabel = `Média: ${getDailyAverage(slotData)} por slot`
  const peakSub = peak.total ? `${peak.total} atendimentos` : "—"

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <MiniCard
        title="Total de atendimentos"
        value={loading ? "—" : String(total)}
        sub={avgLabel}
        iconBg="bg-blue-50"
        icon={<CalendarDays size={18} className="text-blue-500" />}
        subColor="text-slate-400"
        loading={loading}
      />
      <MiniCard
        title="Horário de pico"
        value={peak.slot || "—"}
        sub={peakSub}
        iconBg="bg-purple-50"
        icon={<Clock size={18} className="text-purple-500" />}
        valueColor="text-purple-700"
        subColor="text-purple-400"
      />
      <MiniCard
        title="Unidade mais ativa"
        value={loading ? "—" : activeUnit.label}
        sub={loading ? "—" : `${activeUnit.total} atendimentos`}
        iconBg="bg-emerald-50"
        icon={<Building2 size={18} className="text-emerald-500" />}
        valueColor="text-emerald-700"
        subColor="text-emerald-400"
        loading={loading}
      />
      <MiniCard
        title="Terapeutas em atendimento"
        value={loading ? "—" : String(totalTerapeutas)}
        sub="Agora"
        iconBg="bg-orange-50"
        icon={<Users size={18} className="text-orange-500" />}
        valueColor="text-orange-600"
        subColor="text-orange-400"
        loading={loading}
      />
    </div>
  )
}
