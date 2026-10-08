'use client'

import { memo, useMemo, useState } from 'react'

import {
  CalendarX,
  ChevronDown,
  ChevronUp,
  Clock,
  UserRound,
} from 'lucide-react'

import { getHorario, getIniciais, getPaciente } from './helpers'
import type { GrupoTerapeutaMobile, StatusDisponibilidadeGrupo } from './types'
import type { StatusDisponibilidade } from '@/hooks/useControleDisponibilidade'

type Props = {
  grupo: GrupoTerapeutaMobile
  abrirModalStatus: (
    grupo: GrupoTerapeutaMobile,
    status: StatusDisponibilidade
  ) => void
  atualizarStatusDireto: (
    grupo: GrupoTerapeutaMobile,
    status: StatusDisponibilidade
  ) => void
  salvandoStatus: boolean
}

function ControleTerapeutaMobileCard({
  grupo,
  abrirModalStatus,
  atualizarStatusDireto,
  salvandoStatus,
}: Props) {
  const [aberto, setAberto] = useState(false)
  const salvando = salvandoStatus

  const status = normalizarStatusDisponibilidade(grupo.status)
  // Feriado: sem ação de disponibilidade — a unidade não abriu.
  const fechado = !!grupo.unidadeFechada
  const pendente = !fechado && status === 'pendente'
  const disponivel = !fechado && status === 'disponivel'
  const indisponivel = status === 'indisponivel'
  const substituido = status === 'substituido'
  const parcial = status === 'parcial'
  const indisponivelOuSubstituido = !fechado && (indisponivel || substituido || parcial)

  const horariosOrdenados = useMemo(
    () =>
      [...grupo.atendimentos].sort((a, b) =>
        String(a.hora_inicial).localeCompare(String(b.hora_inicial))
      ),
    [grupo.atendimentos]
  )

  const contagem = useMemo(
    () =>
      grupo.atendimentos.reduce(
        (acc, a) => {
          const s = String(a.status ?? '').toLowerCase()
          if (s === 'disponivel') acc.disponivel++
          else if (s === 'indisponivel') acc.indisponivel++
          else if (s === 'substituido') acc.substituido++
          else acc.pendente++
          return acc
        },
        { disponivel: 0, indisponivel: 0, substituido: 0, pendente: 0 }
      ),
    [grupo.atendimentos]
  )

  const temSlotCritico = useMemo(
    () =>
      grupo.atendimentos.some(
        (a) => a.status === 'indisponivel' || a.status === 'substituido'
      ),
    [grupo.atendimentos]
  )

  const temPendente = useMemo(
    () =>
      grupo.atendimentos.some(
        (a) => String(a.status ?? '').toLowerCase() === 'pendente'
      ),
    [grupo.atendimentos]
  )

  const horarioTotal = useMemo(() => {
    const ini = horariosOrdenados[0]?.hora_inicial
      ? String(horariosOrdenados[0].hora_inicial).slice(0, 5)
      : undefined
    const fim = horariosOrdenados[horariosOrdenados.length - 1]?.hora_final
      ? String(horariosOrdenados[horariosOrdenados.length - 1].hora_final).slice(0, 5)
      : undefined
    return ini && fim ? `${ini} – ${fim}` : grupo.primeiroHorario
  }, [horariosOrdenados, grupo.primeiroHorario])

  const iniciais = useMemo(() => getIniciais(grupo.terapeuta), [grupo.terapeuta])
  const sessoesId = `sessoes-${grupo.terapeuta.replace(/\s+/g, '-')}`

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

      {/* ── Layout principal ── */}
      <div className="flex items-stretch">

        {/* Coluna esquerda — clicável para expandir */}
        <button
          type="button"
          onClick={() => setAberto(!aberto)}
          aria-expanded={aberto}
          aria-controls={sessoesId}
          className="flex-1 text-left px-4 py-4"
        >
          <div className="flex items-start gap-3">
            <div className="h-11 w-11 rounded-full bg-[#eef5fb] text-[#3A8FB7] flex items-center justify-center shrink-0 font-bold text-sm select-none">
              {iniciais}
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-800 leading-tight">
                {grupo.terapeuta}
              </h3>
              <p className="text-sm text-[#3A8FB7] font-medium mt-0.5">
                {grupo.terapia}
              </p>
              <div className="mt-1.5 flex items-center gap-3 text-xs text-slate-400">
                <span className="font-semibold text-slate-700">
                  {grupo.unidade}
                </span>
                <span>·</span>
                <span>{grupo.atendimentos.length} sessões</span>
                <span>·</span>
                <span className="font-bold text-[#3A8FB7]">{horarioTotal}</span>
              </div>
            </div>
          </div>
        </button>

        {/* Coluna central — chips de status 2×2 */}
        <div className="shrink-0 grid grid-cols-2 gap-1.5 pl-6 pr-12 py-4 content-center">
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap text-center ${
            contagem.disponivel > 0
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-slate-50 text-slate-300 border border-slate-100'
          }`}>
            Disponível: {contagem.disponivel}
          </span>
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap text-center ${
            contagem.indisponivel > 0
              ? 'bg-rose-100 text-rose-700'
              : 'bg-slate-50 text-slate-300 border border-slate-100'
          }`}>
            Indisponível: {contagem.indisponivel}
          </span>
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap text-center ${
            contagem.substituido > 0
              ? 'bg-sky-100 text-sky-700'
              : 'bg-slate-50 text-slate-300 border border-slate-100'
          }`}>
            Substituída: {contagem.substituido}
          </span>
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap text-center ${
            contagem.pendente > 0
              ? 'bg-[#eef5fb] text-[#3A8FB7]'
              : 'bg-slate-50 text-slate-300 border border-slate-100'
          }`}>
            Pendente: {contagem.pendente}
          </span>
        </div>

        {/* Coluna direita — status + botões de ação + chevron */}
        <div className="w-52 shrink-0 flex flex-col items-end px-4 py-4 gap-2">

          {/* Linha 1: status badge + chevron */}
          <div className="flex items-center gap-2">
            {fechado ? (
              <span className="whitespace-nowrap px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 inline-flex items-center gap-1">
                <CalendarX className="h-3 w-3" aria-hidden />
                Unidade fechada
              </span>
            ) : (
              <span className={`whitespace-nowrap px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusBadgeClass(status)}`}>
                {statusBadgeLabel(status)}
              </span>
            )}
            <button type="button" onClick={() => setAberto(!aberto)} aria-expanded={aberto} aria-label={aberto ? 'Recolher sessões' : 'Expandir sessões'} className="text-slate-400">
              {aberto
                ? <ChevronUp className="h-4 w-4" />
                : <ChevronDown className="h-4 w-4" />
              }
            </button>
          </div>

          {/* Botões de ação abaixo do status */}
          {pendente && (
            <>
              <button
                type="button"
                disabled={salvando}
                onClick={() => atualizarStatusDireto(grupo, 'disponivel')}
                aria-label={`Marcar ${grupo.terapeuta} como disponível`}
                className="w-full h-11 px-4 rounded-lg bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50 transition hover:bg-emerald-700"
              >
                Disponível
              </button>
              <button
                type="button"
                disabled={salvando}
                onClick={() => abrirModalStatus(grupo, 'indisponivel')}
                aria-label={`Registrar indisponibilidade de ${grupo.terapeuta}`}
                className="w-full h-11 px-4 rounded-lg bg-rose-600 text-white text-xs font-semibold disabled:opacity-50 transition hover:bg-rose-700"
              >
                Indisponível
              </button>
              {temSlotCritico && (
                <button
                  type="button"
                  disabled={salvando}
                  onClick={() => abrirModalStatus(grupo, 'indisponivel')}
                  aria-label={`Registrar substituição para ${grupo.terapeuta}`}
                  className="w-full h-11 px-4 rounded-lg border border-[#3A8FB7] text-[#3A8FB7] text-xs font-semibold disabled:opacity-50 transition hover:bg-[#f0f8fd]"
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
                  aria-label={`Confirmar sessões pendentes de ${grupo.terapeuta}`}
                  className="w-full h-11 px-4 rounded-lg border border-emerald-300 bg-white text-emerald-600 text-xs font-semibold disabled:opacity-50 transition hover:bg-emerald-50"
                >
                  Confirmar pendentes
                </button>
              )}
              <button
                type="button"
                disabled={salvando}
                onClick={() => abrirModalStatus(grupo, 'indisponivel')}
                aria-label={`Encerrar disponibilidade de ${grupo.terapeuta}`}
                className="w-full h-11 px-4 rounded-lg border border-rose-300 text-rose-600 text-xs font-semibold disabled:opacity-50 transition hover:bg-rose-50"
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
                aria-label={`Marcar ${grupo.terapeuta} como disponível agora`}
                className="w-full h-11 px-4 rounded-lg border border-emerald-300 bg-white text-emerald-600 text-xs font-semibold disabled:opacity-50 transition hover:bg-emerald-50"
              >
                Disponível agora
              </button>
              <button
                type="button"
                disabled={salvando}
                onClick={() => abrirModalStatus(grupo, 'indisponivel')}
                aria-label={`Registrar substituição para ${grupo.terapeuta}`}
                className="w-full h-11 px-4 rounded-lg border border-[#3A8FB7] text-[#3A8FB7] text-xs font-semibold disabled:opacity-50 transition hover:bg-[#f0f8fd]"
              >
                Substituição
              </button>
            </>
          )}

        </div>
      </div>

      {/* ── Metadata footer — auditoria ── */}
      {grupo.ultimaAlteracaoPor && grupo.status !== 'pendente' && (
        <div className="border-t border-slate-100 px-5 py-1.5 flex justify-end items-center gap-1.5">
          <Clock className="h-3 w-3 text-slate-300 shrink-0" />
          <span className="text-[11px] text-slate-400">
            Atualizado por{' '}
            <span className="font-medium text-slate-500">{grupo.ultimaAlteracaoPor}</span>
            <span className="mx-1.5 text-slate-300">·</span>
            {formatarDataHora(grupo.ultimaAlteracaoEm)}
          </span>
        </div>
      )}

      {/* ── Sessões expandidas ── */}
      {aberto && (
        <div id={sessoesId} className="border-t border-slate-100 divide-y divide-slate-100">
          {horariosOrdenados.map((item) => (
            <div
              key={item.tita_agendamento_id}
              className="p-4 flex items-center gap-3"
            >
              <div className="h-10 w-10 rounded-full bg-[#eef5fb] text-[#3A8FB7] flex items-center justify-center shrink-0">
                <UserRound className="h-4 w-4" />
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-slate-800">
                    {getPaciente(item)}
                  </span>

                  <span className="text-xs text-[#3A8FB7] font-semibold">
                    {getHorario(item)}
                  </span>

                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                      item.status === 'disponivel'
                        ? 'bg-emerald-100 text-emerald-700'
                        : item.status === 'substituido'
                          ? 'bg-sky-100 text-sky-700'
                          : item.status === 'indisponivel'
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-slate-100 text-slate-600'
                    }`}
                  >
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

function normalizarStatusDisponibilidade(
  status?: string | null
): StatusDisponibilidadeGrupo {
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

function statusBadgeClass(status: StatusDisponibilidadeGrupo): string {
  switch (status) {
    case 'disponivel':
      return 'bg-emerald-100 text-emerald-700'
    case 'indisponivel':
      return 'bg-rose-100 text-rose-700'
    case 'parcial':
      return 'bg-amber-100 text-amber-700'
    case 'substituido':
      return 'bg-sky-100 text-sky-700'
    default:
      return 'bg-slate-100 text-slate-600'
  }
}

function statusBadgeLabel(status: StatusDisponibilidadeGrupo): string {
  switch (status) {
    case 'disponivel':
      return 'Disponível'
    case 'indisponivel':
      return 'Indisponível'
    case 'parcial':
      return 'Indispon. parcial'
    case 'substituido':
      return 'Substituído'
    default:
      return 'Pendente'
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

export default memo(ControleTerapeutaMobileCard)
