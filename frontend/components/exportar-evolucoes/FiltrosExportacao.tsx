"use client"

import { DateRangePicker, type AtalhoPeriodo } from "@/components/ui/date-range-picker"
import { MultiSearchCombobox, type OpcaoMulti } from "@/components/cronograma/ui/MultiSearchCombobox"

// Barra de filtros: período (consulta o banco) + pacientes e terapias (filtram o
// que o período trouxe, na própria tela). Vazio = todos.

const GATILHO_CAMPO =
  "flex h-11 w-full items-center gap-2 rounded-lg border border-border bg-background px-3 text-left text-[14px] text-foreground transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

/** Mês corrente: do dia 1º até o último dia. */
export function periodoPadrao(): { inicio: string; fim: string } {
  const hoje = new Date()
  return {
    inicio: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)),
    fim: iso(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)),
  }
}

const ATALHOS: AtalhoPeriodo[] = [
  { rotulo: "Este mês", intervalo: periodoPadrao },
  {
    rotulo: "Mês passado",
    intervalo: () => {
      const hoje = new Date()
      return {
        inicio: iso(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)),
        fim: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 0)),
      }
    },
  },
  {
    rotulo: "Últimos 3 meses",
    intervalo: () => {
      const hoje = new Date()
      return {
        inicio: iso(new Date(hoje.getFullYear(), hoje.getMonth() - 2, 1)),
        fim: iso(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)),
      }
    },
  },
]

function alternar<T>(set: Set<T>, item: T): Set<T> {
  const novo = new Set(set)
  if (novo.has(item)) novo.delete(item)
  else novo.add(item)
  return novo
}

export function FiltrosExportacao({
  periodo,
  onPeriodo,
  opcoesPacientes,
  pacientes,
  onPacientes,
  opcoesTerapias,
  terapias,
  onTerapias,
  carregando,
}: {
  periodo: { inicio: string; fim: string }
  onPeriodo: (p: { inicio: string; fim: string }) => void
  opcoesPacientes: OpcaoMulti<string>[]
  pacientes: Set<string>
  onPacientes: (s: Set<string>) => void
  opcoesTerapias: OpcaoMulti<string>[]
  terapias: Set<string>
  onTerapias: (s: Set<string>) => void
  carregando: boolean
}) {
  return (
    <div className="grid gap-3 rounded-2xl border border-border bg-card p-3 shadow-sm sm:p-4 lg:grid-cols-3">
      <div className="space-y-1">
        <span className="text-[12px] font-semibold text-muted-foreground">Período</span>
        <DateRangePicker
          inicio={periodo.inicio}
          fim={periodo.fim}
          onChange={onPeriodo}
          atalhos={ATALHOS}
          padrao={periodoPadrao}
          className={GATILHO_CAMPO}
        />
      </div>
      <div className="space-y-1">
        <span className="text-[12px] font-semibold text-muted-foreground">Pacientes</span>
        <MultiSearchCombobox<string>
          variant="plano"
          className={GATILHO_CAMPO}
          opcoes={opcoesPacientes}
          selecionados={pacientes}
          onToggle={id => onPacientes(alternar(pacientes, id))}
          onMarcarTodos={ids => onPacientes(new Set([...pacientes, ...ids]))}
          onDesmarcarTodos={() => onPacientes(new Set())}
          placeholder={carregando ? "Carregando…" : "Todos os pacientes"}
          ariaLabel="Filtrar por paciente"
          nomePlural="pacientes"
          adjetivoResumo="selecionados"
          disabled={carregando || opcoesPacientes.length === 0}
        />
      </div>
      <div className="space-y-1">
        <span className="text-[12px] font-semibold text-muted-foreground">Terapias</span>
        <MultiSearchCombobox<string>
          variant="plano"
          className={GATILHO_CAMPO}
          opcoes={opcoesTerapias}
          selecionados={terapias}
          onToggle={id => onTerapias(alternar(terapias, id))}
          onMarcarTodos={ids => onTerapias(new Set([...terapias, ...ids]))}
          onDesmarcarTodos={() => onTerapias(new Set())}
          placeholder={carregando ? "Carregando…" : "Todas as terapias"}
          ariaLabel="Filtrar por terapia"
          nomePlural="terapias"
          disabled={carregando || opcoesTerapias.length === 0}
        />
      </div>
    </div>
  )
}
