"use client"

// UnidadeMultiSelect — multi-select em dropdown com checkbox + busca textual,
// mesmo espírito do MultiSelectFiltro de SalasFiltros.tsx (Ocupação de Salas),
// mas com um campo de busca no topo do dropdown (pedido explícito do usuário)
// e props genéricas (não amarradas à ideia de "unidade" especificamente).

import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, Filter } from "lucide-react"
import { normTxt } from "@/lib/cronograma/constants"

/**
 * Checkbox secundário, indentado sob uma opção específica — usado hoje pra
 * "Incluir Ambiente Natural" junto de uma unidade física (Previsão de
 * Receitas), mas não amarrado a esse caso: qualquer opção pra qual
 * `aplicaPara` devolver true ganha esse checkbox extra abaixo dela. Só reage
 * a clique enquanto a opção-pai está marcada — sem pai marcado, o valor não
 * tem efeito nenhum no filtro, então fica desabilitado pra não sugerir que
 * teria.
 */
interface SubcheckboxConfig {
  aplicaPara: (opcao: string) => boolean
  label: string
  values: string[]
  onChange: (v: string[]) => void
}

interface UnidadeMultiSelectProps {
  label: string
  values: string[]
  options: string[]
  onChange: (v: string[]) => void
  disabled?: boolean
  /** Texto exibido pra uma opção (checkbox e resumo do botão) — default: a própria opção. */
  renderLabel?: (opcao: string) => string
  subcheckbox?: SubcheckboxConfig
}

export function UnidadeMultiSelect({ label, values, options, onChange, disabled, renderLabel, subcheckbox }: UnidadeMultiSelectProps) {
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
      ? (renderLabel ? renderLabel(values[0]) : values[0])
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
            {opcoesFiltradas.map(o => {
              const opcaoMarcada = values.includes(o)
              const temSubcheckbox = subcheckbox?.aplicaPara(o) ?? false
              return (
                <div key={o}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted/60">
                    <input
                      type="checkbox"
                      checked={opcaoMarcada}
                      onChange={() => alternar(o)}
                      className="rounded border-border"
                    />
                    <span className="truncate">{renderLabel ? renderLabel(o) : o}</span>
                  </label>
                  {temSubcheckbox && (
                    <label
                      className={`ml-6 flex items-center gap-2 rounded-md px-2 py-1 text-xs ${opcaoMarcada ? "cursor-pointer text-muted-foreground hover:bg-muted/60" : "cursor-not-allowed text-muted-foreground/50"}`}
                    >
                      <input
                        type="checkbox"
                        checked={subcheckbox!.values.includes(o)}
                        disabled={!opcaoMarcada}
                        onChange={() => subcheckbox!.onChange(
                          subcheckbox!.values.includes(o) ? subcheckbox!.values.filter(v => v !== o) : [...subcheckbox!.values, o],
                        )}
                        className="rounded border-border"
                      />
                      <span className="truncate">{subcheckbox!.label}</span>
                    </label>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
