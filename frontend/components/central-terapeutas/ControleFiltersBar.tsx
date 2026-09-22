'use client'

import {
  AlertCircle,
  CalendarDays,
  Clock,
  FileSpreadsheet,
  Clock3,
  MapPin,
  RefreshCw,
  Search,
  Stethoscope,
  UserCheck,
  Users,
  UserX,
  X,
} from 'lucide-react'
import { unidadesControle } from './helpers'
import type { ControleFilters } from './types'

type StatusContagem = {
  disponivel: number
  indisponivel: number
  substituido: number
  parcial: number
  pendente: number
}

type Props = {
  filters: ControleFilters
  horarios: string[]
  terapias: string[]
  totalGrupos: number
  statusContagem: StatusContagem
  onChange: (filters: ControleFilters) => void
  onSincronizar?: () => void
  onRelatorio?: () => void
  sincronizando?: boolean
  loading?: boolean
}

export default function ControleFiltersBar({
  filters,
  horarios,
  terapias,
  totalGrupos,
  statusContagem,
  onChange,
  onSincronizar,
  onRelatorio,
  sincronizando,
  loading,
}: Props) {
  function updateFilter<K extends keyof ControleFilters>(
    key: K,
    value: ControleFilters[K]
  ) {
    onChange({ ...filters, [key]: value })
  }

  function toggleStatus(status: string) {
    const atual = filters.statusFiltro ?? []
    const next = atual.includes(status)
      ? atual.filter((s) => s !== status)
      : [...atual, status]
    onChange({ ...filters, statusFiltro: next })
  }

  return (
    <>
      {/* KPI filtros de status — topo */}
      <div className="flex items-stretch gap-3">

        {/* Card Total */}
        <button
          type="button"
          onClick={() => onChange({ ...filters, statusFiltro: [] })}
          className={`
            shrink-0 flex flex-col items-center w-36
            rounded-xl p-2 shadow-sm cursor-pointer
            transition hover:-translate-y-px hover:shadow-md
            border-2
            ${(filters.statusFiltro ?? []).length === 0
              ? 'border-[#3A8FB7] bg-[#f0f8fd]'
              : 'border-slate-200/80 bg-white hover:border-slate-300'}
          `}
        >
          <div className="w-full">
            <div className={`h-7 w-7 rounded-full flex items-center justify-center mx-auto ${
              (filters.statusFiltro ?? []).length === 0
                ? 'bg-[#3A8FB7]/10 text-[#3A8FB7]'
                : 'bg-slate-100 text-slate-500'
            }`}>
              <Users size={13} />
            </div>
            <p className="text-[11px] font-semibold text-slate-600 leading-snug text-center mt-1.5">
              Total
            </p>
          </div>
          <div className="flex-1 flex items-center justify-center py-1">
            <span className={`text-2xl font-bold leading-none ${
              (filters.statusFiltro ?? []).length === 0 ? 'text-[#3A8FB7]' : 'text-slate-700'
            }`}>
              {totalGrupos}
            </span>
          </div>
          <div className="w-full px-1">
            <div className="flex justify-center mb-1.5">
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                (filters.statusFiltro ?? []).length === 0
                  ? 'bg-[#3A8FB7]/10 text-[#3A8FB7]'
                  : 'bg-slate-100 text-slate-500'
              }`}>
                100%
              </span>
            </div>
            <div className="h-1 rounded-full bg-slate-100 overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-500 ${
                (filters.statusFiltro ?? []).length === 0 ? 'bg-[#3A8FB7]' : 'bg-slate-300'
              }`} style={{ width: '100%' }} />
            </div>
          </div>
        </button>

        {/* Status KPI cards */}
        <div className="grid grid-cols-5 gap-3 flex-1">
          {statusChips.map(({ key, label, icon: Icon, iconTone, barTone, borderActive, hoverBorder, bgActive, numClass }) => {
            const ativo = (filters.statusFiltro ?? []).includes(key)
            const count = statusContagem[key as keyof StatusContagem]
            const percent = totalGrupos > 0 ? Math.round((count / totalGrupos) * 100) : 0
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleStatus(key)}
                className={`
                  group flex flex-col items-center w-full
                  rounded-xl p-2 shadow-sm cursor-pointer
                  transition hover:-translate-y-px hover:shadow-md
                  border-2
                  ${ativo ? `${borderActive} ${bgActive}` : `border-slate-200/80 bg-white ${hoverBorder}`}
                `}
              >
                <div className="w-full">
                  <div className={`h-7 w-7 rounded-full flex items-center justify-center mx-auto ${iconTone}`}>
                    <Icon size={13} />
                  </div>
                  <p className="text-[11px] font-semibold text-slate-600 leading-snug text-center mt-1.5 whitespace-pre-line">
                    {label}
                  </p>
                </div>
                <div className="flex-1 flex items-center justify-center py-1">
                  <span className={`text-2xl font-bold leading-none ${numClass}`}>{count}</span>
                </div>
                <div className="w-full px-1">
                  <div className="flex justify-center mb-1.5">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${iconTone}`}>
                      {percent}%
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-slate-100 overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-500 ${barTone}`} style={{ width: `${percent}%` }} />
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Ações */}
        <div className="flex flex-col justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onChange({ ...filters, statusFiltro: [] })}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:border-rose-300 hover:text-rose-500 text-slate-400 text-xs font-medium transition"
          >
            <X size={13} />
            Limpar
          </button>
          {onSincronizar && (
            <button
              type="button"
              onClick={onSincronizar}
              disabled={sincronizando || loading}
              title="Sincronizar dados operacionais"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-500 hover:border-slate-300 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              <RefreshCw size={13} className={sincronizando ? 'animate-spin' : ''} />
              Sincronizar
            </button>
          )}
          {onRelatorio && (
            <button
              type="button"
              onClick={onRelatorio}
              title="Gerar relatório .xlsx por período"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100 text-xs font-medium transition"
            >
              <FileSpreadsheet size={13} />
              Relatório
            </button>
          )}
        </div>
      </div>

      {/* Barra de filtros */}
      <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm">
        <div
          className="
            grid
            grid-cols-1
            gap-3
            md:grid-cols-[185px_1fr_150px_220px_200px]
          "
        >
          {/* Data */}
          <label className="relative">
            <span className="sr-only">Data do atendimento</span>
            <CalendarDays className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              type="date"
              value={filters.data}
              onChange={(e) => updateFilter('data', e.target.value)}
              className={`${inputClass} pl-11`}
            />
          </label>

          {/* Busca unificada — terapeuta ou paciente */}
          <label className="relative">
            <span className="sr-only">Buscar terapeuta ou paciente</span>
            <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              placeholder="Buscar terapeuta ou paciente"
              value={filters.busca}
              onChange={(e) => updateFilter('busca', e.target.value)}
              className={`${inputClass} pl-11`}
            />
          </label>

          {/* Horário */}
          <label className="relative">
            <span className="sr-only">Filtrar por horário</span>
            <Clock3 className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
            <select
              value={filters.horario}
              onChange={(e) => updateFilter('horario', e.target.value)}
              className={`${inputClass} pl-11 pr-8`}
            >
              <option value="">Horários</option>
              {horarios.map((horario) => (
                <option key={horario} value={horario}>
                  {horario.slice(0, 5)}
                </option>
              ))}
            </select>
          </label>

          {/* Unidade */}
          <label className="relative">
            <span className="sr-only">Filtrar por unidade</span>
            <MapPin className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
            <select
              value={filters.unidade}
              onChange={(e) => updateFilter('unidade', e.target.value)}
              className={`${inputClass} pl-11 pr-8`}
            >
              <option value="">Unidades</option>
              {unidadesControle.map((unidade) => (
                <option key={unidade} value={unidade}>
                  {unidade}
                </option>
              ))}
            </select>
          </label>

          {/* Terapia */}
          <label className="relative">
            <span className="sr-only">Filtrar por terapia</span>
            <Stethoscope className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
            <select
              value={filters.terapia}
              onChange={(e) => updateFilter('terapia', e.target.value)}
              className={`${inputClass} pl-11 pr-8`}
            >
              <option value="">Terapias</option>
              {terapias.map((terapia) => (
                <option key={terapia} value={terapia}>
                  {terapia}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </>
  )
}

const statusChips = [
  {
    key: 'disponivel',
    label: 'Disponível',
    icon: UserCheck,
    numClass: 'text-emerald-600',
    iconTone: 'bg-emerald-50 text-emerald-600',
    barTone: 'bg-emerald-500',
    borderActive: 'border-emerald-400',
    hoverBorder: 'hover:border-emerald-300',
    bgActive: 'bg-emerald-50/60',
  },
  {
    key: 'indisponivel',
    label: 'Indisponível',
    icon: UserX,
    numClass: 'text-rose-600',
    iconTone: 'bg-rose-50 text-rose-600',
    barTone: 'bg-rose-500',
    borderActive: 'border-rose-400',
    hoverBorder: 'hover:border-rose-300',
    bgActive: 'bg-rose-50/60',
  },
  {
    key: 'substituido',
    label: 'Substituída',
    icon: RefreshCw,
    numClass: 'text-sky-600',
    iconTone: 'bg-sky-50 text-sky-600',
    barTone: 'bg-sky-500',
    borderActive: 'border-sky-400',
    hoverBorder: 'hover:border-sky-300',
    bgActive: 'bg-sky-50/60',
  },
  {
    key: 'parcial',
    label: 'Indisponibilidade\nParcial',
    icon: AlertCircle,
    numClass: 'text-amber-600',
    iconTone: 'bg-amber-50 text-amber-600',
    barTone: 'bg-amber-500',
    borderActive: 'border-amber-400',
    hoverBorder: 'hover:border-amber-300',
    bgActive: 'bg-amber-50/60',
  },
  {
    key: 'pendente',
    label: 'Pendente',
    icon: Clock,
    numClass: 'text-slate-600',
    iconTone: 'bg-slate-100 text-slate-500',
    barTone: 'bg-slate-400',
    borderActive: 'border-slate-400',
    hoverBorder: 'hover:border-slate-300',
    bgActive: 'bg-slate-50/60',
  },
]

const inputClass = `
  h-11
  w-full
  rounded-2xl
  border border-slate-200
  bg-white
  px-4
  text-sm
  text-slate-700
  outline-none
  focus:ring-4
  focus:ring-[#3A8FB7]/20
  focus:border-[#3A8FB7]
  transition
`
