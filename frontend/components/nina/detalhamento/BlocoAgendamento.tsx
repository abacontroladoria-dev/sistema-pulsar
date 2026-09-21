'use client'

import React from 'react'
import { CalendarClock, Loader2, Plus } from 'lucide-react'
import type { Appointment, AppointmentStatus } from '@/modules/atendimento/types/central.types'
import { Bloco, Vazio, BotaoAdicionar } from './Bloco'

// ----------------------------------------------------------------------------
// O que já está marcado para esta pessoa.
//
// Lista os agendamentos do CONTATO, não da conversa: o retorno combinado hoje
// pode ter sido marcado numa conversa de dois meses atrás, e escondê-lo faria
// alguém remarcar em cima.
//
// Cancelados não entram (o filtro é da rota). Um cancelado na lista compete
// visualmente com o que está de pé e é exatamente o tipo de linha que se lê
// rápido demais.
// ----------------------------------------------------------------------------

const ROTULO_STATUS: Record<AppointmentStatus, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  cancelled: 'Cancelado',
  completed: 'Concluído',
  no_show:   'Não compareceu',
}

const COR_STATUS: Record<AppointmentStatus, string> = {
  scheduled: 'text-cyan-300',
  confirmed: 'text-emerald-300',
  cancelled: 'text-slate-500',
  completed: 'text-slate-400',
  no_show:   'text-rose-300',
}

// `date` é 'YYYY-MM-DD' e `time` é 'HH:MM:SS' — ambos sem fuso, vindos de
// colunas date/time do Postgres. Formatados à mão em vez de `new Date(iso)`:
// passar 'YYYY-MM-DD' pelo construtor o interpreta como UTC e, no fuso do
// Brasil, mostra o dia ANTERIOR.
function formatarData(date: string, time: string | null): string {
  const [ano, mes, dia] = date.split('-')
  if (!ano || !mes || !dia) return date
  const base = `${dia}/${mes}`
  return time ? `${base} às ${time.slice(0, 5)}` : base
}

export const BlocoAgendamento: React.FC<{
  agendamentos: Appointment[]
  carregando:   boolean
  // Ausente enquanto a fatia de escrita não existe.
  aoAgendar?:   () => void
}> = ({ agendamentos, carregando, aoAgendar }) => (
  <Bloco titulo="Agendamento" icone={<CalendarClock className="w-3.5 h-3.5" />}>
    {carregando ? (
      <p className="flex items-center gap-2 text-xs text-slate-500">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando
      </p>
    ) : (
      <div className="space-y-2">
        {aoAgendar && (
          <BotaoAdicionar onClick={aoAgendar}>
            <span className="inline-flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Agendar retorno
            </span>
          </BotaoAdicionar>
        )}

        {agendamentos.length === 0 ? (
          <Vazio>Nenhum agendamento</Vazio>
        ) : (
          <ul className="space-y-1.5">
            {agendamentos.map(a => (
              <li
                key={a.id}
                className="px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-700/50"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-slate-200 truncate">{a.title}</span>
                  <span className="text-[11px] text-slate-400 shrink-0 tabular-nums">
                    {formatarData(a.date, a.time)}
                  </span>
                </div>
                <span className={`text-[10px] font-medium ${COR_STATUS[a.status]}`}>
                  {ROTULO_STATUS[a.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    )}
  </Bloco>
)
