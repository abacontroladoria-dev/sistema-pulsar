"use client"

// Seletor de mês/ano da Previsão de Receitas — navega entre meses (setas) ou
// pula direto pro mês corrente. Por padrão a tela abre no mês seguinte (mesmo
// comportamento de getRefWeek() já existente antes do seletor existir); daqui
// o usuário pode navegar pra julho/agosto/setembro etc., inclusive meses já
// passados (pra ver deduções por falta reais, não só a projeção futura).

import { ChevronLeft, ChevronRight, CalendarClock } from "lucide-react"

const MESES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
]

export interface SeletorMesPrevisaoProps {
  ano: number
  mes: number
  onChange: (ano: number, mes: number) => void
}

function somarMes(ano: number, mes: number, delta: number): { ano: number; mes: number } {
  const d = new Date(ano, mes - 1 + delta, 1)
  return { ano: d.getFullYear(), mes: d.getMonth() + 1 }
}

export function SeletorMesPrevisao({ ano, mes, onChange }: SeletorMesPrevisaoProps) {
  const hoje = new Date()
  const ehMesAtual = ano === hoje.getFullYear() && mes === hoje.getMonth() + 1

  return (
    <div className="flex h-9 items-center gap-1 rounded-lg border border-border bg-card px-1.5">
      <button
        type="button"
        onClick={() => { const p = somarMes(ano, mes, -1); onChange(p.ano, p.mes) }}
        className="rounded p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        aria-label="Mês anterior"
      >
        <ChevronLeft size={14} />
      </button>
      <span className="min-w-[110px] text-center text-[12px] font-bold text-foreground">
        {MESES_PT[mes - 1]}/{ano}
      </span>
      <button
        type="button"
        onClick={() => { const p = somarMes(ano, mes, 1); onChange(p.ano, p.mes) }}
        className="rounded p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        aria-label="Próximo mês"
      >
        <ChevronRight size={14} />
      </button>
      {!ehMesAtual && (
        <button
          type="button"
          onClick={() => onChange(hoje.getFullYear(), hoje.getMonth() + 1)}
          className="ml-1 flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-semibold text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
        >
          <CalendarClock size={12} /> Mês atual
        </button>
      )}
    </div>
  )
}
