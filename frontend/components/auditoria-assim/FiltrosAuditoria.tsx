'use client'

import { useState } from 'react'
import { CalendarDays, ChartColumn, Clock, KeySquare, Search } from 'lucide-react'
import { DatePicker } from '@/components/ui/date-picker'
import type { AuditoriaFilters } from './types'
import ModalTokenMensal from './ModalTokenMensal'
import ModalVisaoGerencial from './ModalVisaoGerencial'

type Props = {
  filters: AuditoriaFilters
  onChange: (filters: AuditoriaFilters) => void
}

// O seletor de Status saiu daqui: os cards de KPI já SÃO esse filtro (clicar
// num card escreve `filters.situacao`, clicar de novo limpa), então a barra
// oferecia duas portas para o mesmo campo — e a de baixo era a que ninguém
// usava, porque o número que motiva o filtro está no card.
//
// O que se perdeu junto, e não tinha card: `SOLICITACAO_CANCELADA` (o recorte
// exato de quem quer só as tentativas que quebraram no meio, hoje somadas
// dentro de "Não Solicitadas") e `GLOSA_RESOLVIDA` (que vive como dica no card
// de Glosas). Os dois continuam visíveis na coluna Situação da tabela; só não
// são mais filtráveis. Se voltarem a ser necessários, o caminho é um card ou um
// clique no próprio badge da linha — não o seletor de volta.

const HORARIOS_BLOCOS = [
  { value: '08:00-08:40', label: '08:00 - 08:40' },
  { value: '08:40-09:20', label: '08:40 - 09:20' },
  { value: '09:20-10:00', label: '09:20 - 10:00' },
  { value: '10:00-10:40', label: '10:00 - 10:40' },
  { value: '10:40-11:20', label: '10:40 - 11:20' },
  { value: '11:20-12:00', label: '11:20 - 12:00' },
  { value: '13:00-13:40', label: '13:00 - 13:40' },
  { value: '13:40-14:20', label: '13:40 - 14:20' },
  { value: '14:20-15:00', label: '14:20 - 15:00' },
  { value: '15:00-15:40', label: '15:00 - 15:40' },
  { value: '15:40-16:20', label: '15:40 - 16:20' },
  { value: '16:20-17:00', label: '16:20 - 17:00' },
  { value: '17:00-17:40', label: '17:00 - 17:40' },
]

export default function FiltrosAuditoria({ filters, onChange }: Props) {
  const [conferenciaAberta, setConferenciaAberta] = useState(false)
  const [gerencialAberta, setGerencialAberta] = useState(false)

  function update<K extends keyof AuditoriaFilters>(key: K, value: AuditoriaFilters[K]) {
    onChange({ ...filters, [key]: value })
  }

  return (
    <div className="bg-white/90 backdrop-blur border border-white/50 rounded-2xl p-3 shadow-sm">
      {/* A faixa única só a partir de `xl`, e não de `md`.
          Medido: com cinco colunas ela pede ~870px, e a área de conteúdo tem
          ~990px numa tela de 1280 (a sidebar fixa come 256px) — cabe, mas por
          pouco, e abaixo de 1024 estourava horizontalmente. Duas colunas no
          intervalo médio resolvem sem apertar nenhum controle: a barra fica mais
          alta, nunca mais estreita que o conteúdo. */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[180px_1fr_190px_auto_auto]">

        <DatePicker
          value={filters.data}
          onChange={(v) => update('data', v)}
          rotuloGatilho="Data"
          classeGatilho={`${inputClass} flex items-center gap-3 text-left`}
          conteudoGatilho={
            <>
              <CalendarDays className="w-4 h-4 shrink-0 text-slate-400" aria-hidden />
              <span className={filters.data ? '' : 'text-slate-400'}>
                {filters.data ? filters.data.split('-').reverse().join('/') : 'dd/mm/aaaa'}
              </span>
            </>
          }
        />

        <label className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar paciente"
            value={filters.paciente}
            onChange={(e) => update('paciente', e.target.value)}
            className={`${inputClass} pl-11`}
          />
        </label>

        <label className="relative">
          <Clock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <select
            value={filters.horario_bloco}
            onChange={(e) => update('horario_bloco', e.target.value)}
            className={`${inputClass} pl-11`}
          >
            <option value="">Todos os horários</option>
            {HORARIOS_BLOCOS.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </select>
        </label>

        {/* Brand-outline, e não um segundo botão preenchido ao lado do outro:
            o DESIGN.md reserva o preenchido para a ação que cria um estado, e
            a visão gerencial só emoldura o que já existe. Dois preenchidos
            lado a lado também fariam a barra ter dois "primeiros" botões. */}
        <button
          type="button"
          onClick={() => setGerencialAberta(true)}
          className="flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-2xl border border-brand bg-white px-4 text-sm font-semibold text-brand-fg transition hover:bg-brand-surface focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
        >
          <ChartColumn size={16} />
          Visão do Período
        </button>

        <button
          type="button"
          onClick={() => setConferenciaAberta(true)}
          className="flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-2xl bg-brand-fg px-4 text-sm font-semibold text-white transition hover:bg-brand-dark"
        >
          <KeySquare size={16} />
          Conferência de Filipetas
        </button>

      </div>

      <ModalTokenMensal open={conferenciaAberta} onClose={() => setConferenciaAberta(false)} />
      <ModalVisaoGerencial aberto={gerencialAberta} onClose={() => setGerencialAberta(false)} />
    </div>
  )
}

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
  focus:ring-brand/15
  focus:border-brand
  transition
`
