"use client"

// SalasFiltros — barra de filtros de unidade/núcleo/andar/capacidade/turno/status
// para a grade e o mapa de calor de Ocupação de Salas. Cada filtro (exceto
// profissional, que é busca livre) aceita múltipla seleção — um dropdown com
// checkboxes em vez de um <select> nativo, que só permite uma opção por vez.

import { useEffect, useRef, useState } from "react"
import { ChevronDown, Filter, Search, SlidersHorizontal } from "lucide-react"
import { normTxt } from "@/lib/cronograma/constants"
import { CAPACIDADE_LABEL_CURTO } from "@/lib/cronograma/salasTypes"
import { useStatusLabels } from "@/hooks/useStatusLabels"
import { contarFiltrosSecundarios, SALAS_FILTROS_VAZIO, type SalasFiltrosState } from "@/lib/cronograma/salasView"
import type { SalaCapacidade, SalaStatus, SalaComOcupacao } from "@/lib/cronograma/salasTypes"

// O estado do filtro mora em lib/cronograma/salasView.ts (camada 1) porque
// `chipsDeFiltro` precisa do tipo e um módulo puro não pode importar de um
// arquivo de UI. Re-exportado aqui para os imports existentes continuarem
// válidos — nenhum chamador precisou mudar.
export { SALAS_FILTROS_VAZIO }
export type { SalasFiltrosState }

interface MultiSelectFiltroProps {
  label: string
  values: string[]
  options: string[]
  onChange: (v: string[]) => void
  /** Rótulo legível por opção (ex.: "unico" -> "Único") — opcional, usa o valor cru quando ausente. */
  labelFor?: (opcao: string) => string
}

function MultiSelectFiltro({ label, values, options, onChange, labelFor }: MultiSelectFiltroProps) {
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aberto) return
    function aoClicarFora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false)
    }
    // Mesmo handler de Escape que o MaisFiltros já usava — antes só o popover
    // de baixo fechava com Esc e estes não, o que é uma inconsistência que o
    // usuário de teclado sente na mesma barra.
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false)
    }
    document.addEventListener("mousedown", aoClicarFora)
    document.addEventListener("keydown", aoTeclar)
    return () => {
      document.removeEventListener("mousedown", aoClicarFora)
      document.removeEventListener("keydown", aoTeclar)
    }
  }, [aberto])

  function alternar(opcao: string) {
    onChange(values.includes(opcao) ? values.filter(v => v !== opcao) : [...values, opcao])
  }

  const resumo = values.length === 0
    ? "Todos"
    : values.length === 1
      ? (labelFor ? labelFor(values[0]) : values[0])
      : `${values.length} selecionados`

  return (
    <div ref={ref} className="relative">
      {/* Só o rótulo, nunca o valor escolhido — mostrar "Núcleo:
          Desenvolvimento e..." dentro do botão fazia a largura variar por
          filtro e quebrar a barra em duas linhas. O ícone de funil cinza/verde
          diz "tem filtro aqui ou não" à distância; o valor em si aparece no
          título (hover) e, claro, dentro do dropdown ao abrir. */}
      <button
        type="button"
        onClick={() => setAberto(v => !v)}
        aria-expanded={aberto}
        aria-haspopup="true"
        // O nome acessível precisa carregar o VALOR escolhido: visualmente o
        // funil verde diz "tem filtro aqui", mas isso não chega ao leitor de
        // tela, que ouvia só "Unidade".
        aria-label={`${label}: ${resumo}`}
        title={resumo}
        className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-2.5 text-sm text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Filter
          size={15}
          className={values.length ? "shrink-0 fill-emerald-500 text-emerald-500" : "shrink-0 text-muted-foreground"}
          strokeWidth={2.25}
        />
        {/* Sem uppercase tracked-out: caixa alta em rótulo de filtro só
            aumenta a mancha e reduz a legibilidade — e, com o valor escolhido
            invisível no botão, o rótulo é tudo o que o usuário tem para ler. */}
        <span className="text-[13px] text-muted-foreground">{label}</span>
        <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
      </button>
      {aberto && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-64 min-w-50 overflow-auto rounded-lg border border-border bg-card p-1.5 shadow-lg">
          {options.length === 0 && <div className="px-2 py-1 text-xs text-muted-foreground">Nenhuma opção</div>}
          {options.map(o => (
            <label key={o} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted/60">
              <input
                type="checkbox"
                checked={values.includes(o)}
                onChange={() => alternar(o)}
                className="rounded border-border"
              />
              <span className="truncate">{labelFor ? labelFor(o) : o}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

interface SalasFiltrosProps {
  value: SalasFiltrosState
  onChange: (next: SalasFiltrosState) => void
  unidades: string[]
  nucleos: string[]
  andares: string[]
}

const CAPACIDADE_OPCOES: SalaCapacidade[] = ["unico", "duplo", "multiplo"]
const TURNO_OPCOES = ["Manhã", "Tarde"] as const

/**
 * Filtros secundários num popover. A escolha de quais ficam escondidos seguiu o
 * uso: unidade/núcleo/status respondem "onde e em que estado", que é como se
 * procura uma sala; andar/capacidade/turno refinam depois de já ter achado.
 *
 * O contador `(N)` no botão não é decoração — sem ele um filtro ativo some da
 * vista e o usuário conclui que a sala desapareceu do sistema. A tira de chips
 * (FiltrosChips) é a segunda rede de proteção.
 */
function MaisFiltros({ value, andares, onSet }: {
  value: SalasFiltrosState
  andares: string[]
  onSet: <K extends keyof SalasFiltrosState>(key: K, v: SalasFiltrosState[K]) => void
}) {
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const ativos = contarFiltrosSecundarios(value)

  // Mesmo mousedown + ref do MultiSelectFiltro acima — não inventar um segundo
  // mecanismo de "fechar ao clicar fora" na mesma barra.
  useEffect(() => {
    if (!aberto) return
    function aoClicarFora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false)
    }
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false)
    }
    document.addEventListener("mousedown", aoClicarFora)
    document.addEventListener("keydown", aoTeclar)
    return () => {
      document.removeEventListener("mousedown", aoClicarFora)
      document.removeEventListener("keydown", aoTeclar)
    }
  }, [aberto])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setAberto(v => !v)}
        aria-expanded={aberto}
        aria-haspopup="true"
        className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-2.5 text-sm text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <SlidersHorizontal size={14} className="shrink-0 text-muted-foreground" />
        Mais filtros
        {ativos > 0 && (
          <span className="rounded-full bg-slate-900 px-1.5 text-[10px] font-bold tabular-nums text-white dark:bg-white dark:text-slate-900">
            {ativos}
          </span>
        )}
      </button>
      {aberto && (
        // z-50 porque a barra de filtros é sticky z-40 — sem isso o popover
        // nasce atrás do próprio container.
        <div className="absolute right-0 top-full z-50 mt-1 flex w-64 flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-lg">
          <MultiSelectFiltro label="Andar" values={value.andar} options={andares} onChange={v => onSet("andar", v)} />
          <MultiSelectFiltro
            label="Capacidade"
            values={value.capacidade}
            options={CAPACIDADE_OPCOES}
            onChange={v => onSet("capacidade", v as SalaCapacidade[])}
            labelFor={o => CAPACIDADE_LABEL_CURTO[o as SalaCapacidade]}
          />
          <MultiSelectFiltro
            label="Turno"
            values={value.turno}
            options={[...TURNO_OPCOES]}
            onChange={v => onSet("turno", v as ("Manhã" | "Tarde")[])}
          />
          <button
            type="button"
            onClick={() => onSet("semSessao", !value.semSessao)}
            aria-pressed={value.semSessao}
            className={`flex h-9 items-center justify-center whitespace-nowrap rounded-lg border px-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              value.semSessao
                ? "border-amber-400 bg-amber-100 text-amber-800 dark:border-amber-500 dark:bg-amber-950/40 dark:text-amber-300"
                : "border-border bg-card text-muted-foreground hover:bg-muted/50"
            }`}
          >
            Alocação sem sessão
          </button>
          <button
            type="button"
            onClick={() => onSet("comExclusividade", !value.comExclusividade)}
            aria-pressed={value.comExclusividade}
            className={`flex h-9 items-center justify-center whitespace-nowrap rounded-lg border px-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              value.comExclusividade
                ? "border-blue-400 bg-blue-100 text-blue-800 dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-300"
                : "border-border bg-card text-muted-foreground hover:bg-muted/50"
            }`}
          >
            Sala com exclusividade
          </button>
        </div>
      )}
    </div>
  )
}

export function SalasFiltros({ value, onChange, unidades, nucleos, andares }: SalasFiltrosProps) {
  const { labels: statusLabels } = useStatusLabels()
  const statusOpcoes = Object.keys(statusLabels)

  function set<K extends keyof SalasFiltrosState>(key: K, v: SalasFiltrosState[K]) {
    onChange({ ...value, [key]: v })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* O anel vai no CONTAINER (`focus-within`), não no input: o input tem
          `outline-none` e é o controle mais usado da tela — sem isto ele era o
          único elemento genuinamente invisível ao foco de teclado. */}
      <div className="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 focus-within:ring-2 focus-within:ring-ring sm:max-w-64 sm:flex-none">
        <Search size={13} className="shrink-0 text-muted-foreground" />
        <input
          type="text"
          value={value.profissional}
          onChange={e => set("profissional", e.target.value)}
          placeholder="Buscar profissional..."
          aria-label="Buscar profissional"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
      <MultiSelectFiltro label="Unidade" values={value.unidade} options={unidades} onChange={v => set("unidade", v)} />
      <MultiSelectFiltro label="Núcleo" values={value.nucleo} options={nucleos} onChange={v => set("nucleo", v)} />
      <MultiSelectFiltro
        label="Status"
        values={value.status}
        options={statusOpcoes}
        onChange={v => set("status", v as SalaStatus[])}
        labelFor={o => statusLabels[o]?.label_curto ?? o}
      />
      <MaisFiltros value={value} andares={andares} onSet={set} />
    </div>
  )
}

export function aplicarFiltrosSala(
  filtro: SalasFiltrosState,
  sala: { unidade_nome: string; nucleo: string | null; andar: string | null; capacidade: SalaCapacidade; status: SalaStatus },
): boolean {
  if (filtro.unidade.length && !filtro.unidade.includes(sala.unidade_nome)) return false
  if (filtro.nucleo.length && !filtro.nucleo.includes(sala.nucleo ?? "")) return false
  if (filtro.andar.length && !filtro.andar.includes(sala.andar ?? "")) return false
  if (filtro.capacidade.length && !filtro.capacidade.includes(sala.capacidade)) return false
  if (filtro.status.length && !filtro.status.includes(sala.status)) return false
  return true
}

/**
 * Busca livre por profissional alocado em qualquer slot da sala. Usa
 * `normTxt` (remove acentos + minúsculas) para achar "Rachel Silva" tanto
 * com quanto sem acento, em qualquer ordem de capitalização.
 */
export function salaTemProfissional(item: SalaComOcupacao, query: string): boolean {
  const q = normTxt(query)
  if (!q) return true
  return item.slots.some(slot =>
    slot.alocacoes.some(a => normTxt(a.profissionalNome).includes(q)),
  )
}

/**
 * Indica se um profissional bate com a busca ativa — usado para DESTACAR o
 * card dele na grade, sem esconder os outros profissionais do mesmo slot
 * (esconder faria um horário ocupado por outra pessoa aparecer como "Livre",
 * o que é enganoso).
 */
export function profissionalBateComBusca(nome: string, query: string): boolean {
  const q = normTxt(query)
  if (!q) return false
  return normTxt(nome).includes(q)
}
