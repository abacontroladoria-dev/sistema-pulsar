'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Clock, UserRound } from 'lucide-react'
import { getHorario, getPaciente } from '@/components/central-terapeutas/helpers'
import type { ControleTerapeuticoItem } from '@/components/central-terapeutas/types'

type StatusDisponibilidade =
  | 'pendente'
  | 'disponivel'
  | 'indisponivel'
  | 'parcial'
  | 'substituido'

type GrupoTerapeutaMobile = {
  terapeuta: string
  terapia: string
  unidade: string
  primeiroHorario: string
  status: string
  substituto?: string
  ultimaAlteracaoPor?: string | null
  ultimaAlteracaoEm?: string | null
  atendimentos: ControleTerapeuticoItem[]
}

type Props = {
  grupo: GrupoTerapeutaMobile
  onStatusChanged?: () => void
  abrirModalStatus: (
    grupo: GrupoTerapeutaMobile,
    status: StatusDisponibilidade
  ) => void
  atualizarStatusDireto: (
    grupo: GrupoTerapeutaMobile,
    status: StatusDisponibilidade
  ) => void
  onAbrirCobertura: (grupo: GrupoTerapeutaMobile) => void
  salvandoStatus: boolean
}

export default function DisponibilidadeTerapeutaCard({
  grupo,
  abrirModalStatus,
  atualizarStatusDireto,
  onAbrirCobertura,
  salvandoStatus,
}: Props) {
  const [aberto, setAberto] = useState(false)
  const salvando = salvandoStatus

  const status = normalizarStatus(grupo.status)
  const pendente = status === 'pendente'
  const disponivel = status === 'disponivel'
  const indisponivel = status === 'indisponivel'
  const substituido = status === 'substituido'
  const parcial = status === 'parcial'
  const indisponivelOuSubstituido = indisponivel || substituido || parcial
  const temSlotCritico = grupo.atendimentos.some(
    (a) => a.status === 'indisponivel' || a.status === 'substituido'
  )
  const temPendente = grupo.atendimentos.some(
    (a) => String(a.status ?? '').toLowerCase() === 'pendente'
  )

  const horariosOrdenados = [...grupo.atendimentos].sort((a, b) =>
    String(a.hora_inicial).localeCompare(String(b.hora_inicial))
  )

  const horaInicialGrupo = horariosOrdenados[0]?.hora_inicial
    ? String(horariosOrdenados[0].hora_inicial).slice(0, 5)
    : undefined
  const horaFinalGrupo =
    horariosOrdenados[horariosOrdenados.length - 1]?.hora_final
      ? String(horariosOrdenados[horariosOrdenados.length - 1].hora_final).slice(0, 5)
      : undefined
  const iniciais = getIniciais(grupo.terapeuta)
  const horarioTotal =
    horaInicialGrupo && horaFinalGrupo
      ? `${horaInicialGrupo} – ${horaFinalGrupo}`
      : grupo.primeiroHorario

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

      {/* ── Cabeçalho ── */}
      <div className="flex items-center px-4 py-4 gap-3">

        {/* Avatar + info — clicável para expandir */}
        <button
          type="button"
          onClick={() => setAberto(!aberto)}
          aria-expanded={aberto}
          aria-label={`${grupo.terapeuta} — ${aberto ? 'recolher' : 'expandir'} sessões`}
          className="flex-1 text-left flex items-start gap-3 min-w-0 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand"
        >
          <div className="h-11 w-11 rounded-full bg-brand-surface text-brand-fg flex items-center justify-center shrink-0 font-bold text-sm select-none">
            {iniciais}
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-800 leading-tight truncate">
              {grupo.terapeuta}
            </h3>
            <p className="text-sm text-brand-fg font-medium mt-0.5 truncate">
              {grupo.terapia}
            </p>
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 flex-wrap">
              <span className="font-semibold text-slate-700">{grupo.unidade}</span>
              <span>·</span>
              <span>{grupo.atendimentos.length} sessões</span>
              <span>·</span>
              <span className="font-bold text-violet-700">{horarioTotal}</span>
            </div>
          </div>
        </button>

        {/* Badge de status + chevron */}
        <div className="shrink-0 flex items-center gap-2">
          <span className={`whitespace-nowrap px-3 py-1 rounded-full text-xs font-semibold ${statusBadgeClass(status)}`}>
            {statusBadgeLabel(status)}
          </span>
          <button
            type="button"
            onClick={() => setAberto(!aberto)}
            aria-expanded={aberto}
            aria-label={aberto ? 'Recolher sessões' : 'Expandir sessões'}
            className="text-slate-400 rounded-lg p-0.5 focus:outline-none focus:ring-2 focus:ring-brand"
          >
            {aberto ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {/* ── Botões de ação — full-width ── */}
      <div className="border-t border-slate-100 px-4 pt-3 pb-4 flex gap-2">
        {pendente && (
          <>
            <button
              type="button"
              disabled={salvando}
              onClick={() => atualizarStatusDireto(grupo, 'disponivel')}
              className="flex-1 h-11 rounded-xl bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50 transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
            >
              Disponível
            </button>
            <button
              type="button"
              disabled={salvando}
              onClick={() => abrirModalStatus(grupo, 'indisponivel')}
              className="flex-1 h-11 rounded-xl bg-rose-600 text-white text-sm font-semibold disabled:opacity-50 transition hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2"
            >
              Indisponível
            </button>
            {temSlotCritico && (
              <button
                type="button"
                disabled={salvando}
                onClick={() => onAbrirCobertura(grupo)}
                className="h-11 px-4 rounded-xl border border-brand text-brand-fg text-sm font-semibold disabled:opacity-50 transition hover:bg-brand-hover focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2"
              >
                Substituição
              </button>
            )}
          </>
        )}

        {disponivel && (
          <>
            {temPendente && (
              <button
                type="button"
                disabled={salvando}
                onClick={() =>
                  atualizarStatusDireto(
                    {
                      ...grupo,
                      atendimentos: grupo.atendimentos.filter(
                        (a) => String(a.status ?? '').toLowerCase() === 'pendente'
                      ),
                    },
                    'disponivel'
                  )
                }
                className="flex-1 h-11 rounded-xl border border-emerald-300 bg-white text-[var(--status-ok)] text-sm font-semibold disabled:opacity-50 transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2"
              >
                Confirmar pendentes
              </button>
            )}
            <button
              type="button"
              disabled={salvando}
              onClick={() => abrirModalStatus(grupo, 'indisponivel')}
              className="flex-1 h-11 rounded-xl border border-rose-300 text-rose-600 text-sm font-semibold disabled:opacity-50 transition hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-400 focus:ring-offset-2"
            >
              Encerrar disponibilidade
            </button>
          </>
        )}

        {indisponivelOuSubstituido && (
          <>
            <button
              type="button"
              disabled={salvando}
              onClick={() => abrirModalStatus(grupo, 'disponivel')}
              className="flex-1 h-11 rounded-xl border border-emerald-300 bg-white text-[var(--status-ok)] text-sm font-semibold disabled:opacity-50 transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2"
            >
              Disponível agora
            </button>
            <button
              type="button"
              disabled={salvando}
              onClick={() => onAbrirCobertura(grupo)}
              className="flex-1 h-11 rounded-xl border border-brand text-brand-fg text-sm font-semibold disabled:opacity-50 transition hover:bg-brand-hover focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2"
            >
              Substituição
            </button>
          </>
        )}
      </div>

      {/* ── Metadata — auditoria ── */}
      {grupo.ultimaAlteracaoPor && grupo.status !== 'pendente' && (
        <div className="border-t border-slate-100 px-5 py-1.5 flex justify-end items-center gap-1.5">
          <Clock className="h-3 w-3 text-slate-400 shrink-0" aria-hidden="true" />
          <span className="text-[11px] text-slate-500">
            Atualizado por{' '}
            <span className="font-medium text-slate-600">{grupo.ultimaAlteracaoPor}</span>
            <span className="mx-1.5 text-slate-300" aria-hidden="true">·</span>
            {formatarDataHora(grupo.ultimaAlteracaoEm)}
          </span>
        </div>
      )}

      {/* ── Sessões expandidas ── */}
      {aberto && (
        <div className="border-t border-slate-100 divide-y divide-slate-100">
          {horariosOrdenados.map((item) => (
            <div key={item.tita_agendamento_id} className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-brand-surface text-brand flex items-center justify-center shrink-0" aria-hidden="true">
                <UserRound className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-slate-800">
                    {getPaciente(item)}
                  </span>
                  <span className="text-xs text-brand-fg font-semibold">
                    {getHorario(item)}
                  </span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                    item.status === 'disponivel'
                      ? 'bg-emerald-100 text-emerald-700'
                      : item.status === 'substituido'
                        ? 'bg-sky-100 text-sky-700'
                        : item.status === 'indisponivel'
                          ? 'bg-rose-100 text-rose-700'
                          : 'bg-slate-100 text-slate-600'
                  }`}>
                    {item.status === 'disponivel'
                      ? 'Disponível'
                      : item.status === 'substituido'
                        ? 'Substituído'
                        : item.status === 'indisponivel'
                          ? 'Indisponível'
                          : 'Pendente'}
                  </span>
                  {item.status === 'substituido' && item.profissional_substituto_nome && (
                    <span className="text-xs text-sky-700 font-medium">
                      {item.profissional_substituto_nome}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  )
}

function normalizarStatus(status?: string | null): StatusDisponibilidade {
  if (
    status === 'disponivel' ||
    status === 'indisponivel' ||
    status === 'parcial' ||
    status === 'substituido'
  ) {
    return status
  }
  return 'pendente'
}

function getIniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/)
  if (partes.length >= 2) {
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
  }
  return partes[0].slice(0, 2).toUpperCase()
}

function statusBadgeClass(status: StatusDisponibilidade): string {
  switch (status) {
    case 'disponivel':  return 'bg-emerald-100 text-emerald-700'
    case 'indisponivel': return 'bg-rose-100 text-rose-700'
    case 'parcial':     return 'bg-amber-100 text-amber-700'
    case 'substituido': return 'bg-sky-100 text-sky-700'
    default:            return 'bg-slate-100 text-slate-600'
  }
}

function statusBadgeLabel(status: StatusDisponibilidade): string {
  switch (status) {
    case 'disponivel':  return 'Disponível'
    case 'indisponivel': return 'Indisponível'
    case 'parcial':     return 'Indispon. parcial'
    case 'substituido': return 'Substituído'
    default:            return 'Pendente'
  }
}

function formatarDataHora(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const dia  = String(d.getDate()).padStart(2, '0')
  const mes  = String(d.getMonth() + 1).padStart(2, '0')
  const hora = String(d.getHours()).padStart(2, '0')
  const min  = String(d.getMinutes()).padStart(2, '0')
  return `${dia}/${mes} às ${hora}:${min}`
}
