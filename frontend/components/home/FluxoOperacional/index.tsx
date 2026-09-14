"use client"

import { BarChart3, Info } from "lucide-react"
import { FluxoSlotPoint, FluxoUnitCount } from "./data"
import KpiMiniCards from "./KpiMiniCards"
import FluxoChart from "./Chart"

interface FluxoOperacionalCardProps {
  slotData?: FluxoSlotPoint[]
  atendimentos?: FluxoUnitCount | null
  terapeutas?: FluxoUnitCount | null
  loading?: boolean
}

// Card estatico do dia. Nao busca nada: recebe da home os slots ja vindos da
// tabela-cache (get_fluxo_slots), alimentada pelo cron. O seletor
// Hoje/Semana/Mes foi removido — varria a vw_central_autorizacoes com paginacao
// sequencial e sem teto, dezenas de round-trips por clique no modo "Este Mes".
export default function FluxoOperacionalCard({
  slotData = [],
  atendimentos = null,
  terapeutas = null,
  loading = false,
}: FluxoOperacionalCardProps) {
  const today = new Date().toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_6px_24px_-2px_rgba(0,0,0,0.09)] p-6 space-y-5">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="bg-blue-50 rounded-xl p-2.5 shrink-0">
          <BarChart3 size={20} className="text-blue-500" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-800 leading-tight">
            Fluxo Operacional do Dia
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Atendimentos previstos por unidade e horário
          </p>
        </div>
      </div>

      {/* ── KPI Mini Cards ──────────────────────────────────────────────── */}
      <KpiMiniCards
        slotData={slotData}
        atendimentos={atendimentos}
        terapeutas={terapeutas}
        loading={loading}
      />

      {/* ── Divider ─────────────────────────────────────────────────────── */}
      <div className="border-t border-slate-50" />

      {/* ── Chart ───────────────────────────────────────────────────────── */}
      <FluxoChart data={slotData} showCurrentSlot />

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 text-[11px] text-slate-400 pt-1">
        <Info size={12} className="shrink-0 text-slate-300" />
        <span>Dados referentes a atendimentos previstos para hoje ({today})</span>
      </div>

    </div>
  )
}
