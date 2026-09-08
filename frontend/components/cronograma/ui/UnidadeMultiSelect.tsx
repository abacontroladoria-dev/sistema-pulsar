"use client"

// UnidadeMultiSelect — multi-select em dropdown com checkbox + busca textual,
// mesmo espírito do MultiSelectFiltro de SalasFiltros.tsx (Ocupação de Salas),
// mas com um campo de busca no topo do dropdown (pedido explícito do usuário)
// e props genéricas (não amarradas à ideia de "unidade" especificamente).

import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, Filter } from "lucide-react"
import { normTxt } from "@/lib/cronograma/constants"

interface UnidadeMultiSelectProps {
  label: string
  values: string[]
  options: string[]
  onChange: (v: string[]) => void
  disabled?: boolean
}

export function UnidadeMultiSelect({ label, values, options, onChange, disabled }: UnidadeMultiSelectProps) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState("")
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aberto) return
    function aoClicarFora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener("mousedown", aoClicarFora)
    return () => document.removeEventListener("mousedown", aoClicarFora)
  }, [aberto])

  useEffect(() => {
    if (!aberto) setBusca("")
  }, [aberto])

  function alternar(opcao: string) {
    onChange(values.includes(opcao) ? values.filter(v => v !== opcao) : [...values, opcao])
  }

  const opcoesFiltradas = useMemo(() => {
    const q = normTxt(busca)
    if (!q) return options
    return options.filter(o => normTxt(o).includes(q))
  }, [options, busca])

  const resumo = values.length === 0
    ? `Todas as ${label.toLowerCase()}`
    : values.length === 1
      ? values[0]
      : `${values.length} selecionadas`

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setAberto(v => !v)}
        disabled={disabled}
        aria-expanded={aberto}
        title={resumo}
        className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-2.5 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Filter
          size={15}
          className={values.length ? "shrink-0 fill-emerald-500 text-emerald-500" : "shrink-0 text-muted-foreground"}
          strokeWidth={2.25}
        />
        <span className="text-foreground">{resumo}</span>
        <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
      </button>
      {aberto && !disabled && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-64 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
          <div className="border-b border-border p-1.5">
            <input
              type="text"
              autoFocus
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar unidade..."
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="max-h-56 overflow-auto p-1.5">
            {opcoesFiltradas.length === 0 && (
              <div className="px-2 py-1 text-xs text-muted-foreground">Nenhuma unidade encontrada</div>
            )}
            {opcoesFiltradas.map(o => (
              <label key={o} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted/60">
                <input
                  type="checkbox"
                  checked={values.includes(o)}
                  onChange={() => alternar(o)}
                  className="rounded border-border"
                />
                <span className="truncate">{o}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
