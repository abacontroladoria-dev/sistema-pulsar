"use client"

import {
  CalendarClock,
  CalendarX,
  FileCheck2,
  FileQuestion,
  FileX,
  Hourglass,
  Layers,
  type LucideIcon,
} from "lucide-react"
import { foco } from "@/components/cadastros/pacientes/ui/campos"
import { RECORTE_DICA, RECORTE_LABEL, type RecorteContratos } from "@/lib/contratos/filtros"

// Os indicadores da Status Contratos. Cada card É o filtro do seu recorte
// (clicar filtra, clicar de novo volta a "Todos") — mesma regra da Status
// Laudos e Senhas. Contam PACIENTES.
//
// Mesma família de cor dos selos (lib/contratos/status.ts): verde = valendo,
// âmbar = pede ação, rosa = vencido, violeta = link morto.

type Card = { recorte: RecorteContratos; Icone: LucideIcon; tom: string; ativo: string }

const CARDS: Card[] = [
  { recorte: "todos", Icone: Layers, tom: "text-slate-600 dark:text-slate-300", ativo: "border-slate-400 bg-slate-100 dark:border-slate-600 dark:bg-slate-800/60" },
  { recorte: "sem_contrato", Icone: FileQuestion, tom: "text-rose-600 dark:text-rose-400", ativo: "border-rose-400 bg-rose-50 dark:border-rose-700 dark:bg-rose-950/40" },
  { recorte: "aguardando", Icone: Hourglass, tom: "text-amber-600 dark:text-amber-400", ativo: "border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40" },
  { recorte: "assinado_vigente", Icone: FileCheck2, tom: "text-emerald-600 dark:text-emerald-400", ativo: "border-emerald-400 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/40" },
  { recorte: "a_vencer", Icone: CalendarClock, tom: "text-amber-600 dark:text-amber-400", ativo: "border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40" },
  { recorte: "vencido", Icone: CalendarX, tom: "text-rose-600 dark:text-rose-400", ativo: "border-rose-400 bg-rose-50 dark:border-rose-700 dark:bg-rose-950/40" },
  { recorte: "recusado_expirado", Icone: FileX, tom: "text-violet-600 dark:text-violet-400", ativo: "border-violet-400 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/40" },
]

export function PainelIndicadoresContratos({
  contagens,
  recorte,
  onRecorte,
  carregando,
}: {
  contagens: Record<RecorteContratos, number>
  recorte: RecorteContratos
  onRecorte: (r: RecorteContratos) => void
  carregando: boolean
}) {
  return (
    // OS SETE numa linha só a partir do `lg` (pedido do usuário, 09/10/2026:
    // "não separe em duas linhas") — por isso 7 colunas aqui, não as 4 do
    // painel de filtros: 7 cards do tamanho de 1/4 da linha não cabem numa
    // linha só no mesmo espaço. Abaixo de `lg`, empilha em 2-3 colunas.
    <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
      {CARDS.map(({ recorte: r, Icone, tom, ativo }) => {
        const marcado = recorte === r
        return (
          <button
            key={r}
            type="button"
            aria-pressed={marcado}
            title={RECORTE_DICA[r]}
            onClick={() => onRecorte(marcado && r !== "todos" ? "todos" : r)}
            className={`flex min-h-[76px] flex-col justify-between rounded-xl border p-3 text-left shadow-sm transition-colors ${foco} ${
              marcado ? `${ativo} ring-1 ring-black/5` : "border-border bg-card hover:bg-muted/40"
            }`}
          >
            <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Icone className={`h-3.5 w-3.5 shrink-0 ${tom}`} aria-hidden="true" />
              <span className="leading-tight">{RECORTE_LABEL[r]}</span>
            </span>
            <span className={`mt-1 text-2xl font-bold tabular-nums ${marcado ? tom : "text-foreground"}`}>
              {carregando ? <span className="inline-block h-6 w-10 animate-pulse rounded bg-muted align-middle" /> : contagens[r]}
            </span>
          </button>
        )
      })}
    </section>
  )
}
