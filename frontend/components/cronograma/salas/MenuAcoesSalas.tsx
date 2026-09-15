"use client"

// MenuAcoesSalas — as ações de manutenção do cadastro, atrás de um "⋯".
//
// Antes eram cinco botões soltos no topo, todos com o mesmo peso visual, um
// deles com 38 caracteres ("Exclusividade de salas com terapias") ocupando um
// quarto da largura. Três delas são raras — histórico, categorias e
// exclusividade se mexem uma vez por mês, não por sessão — e competiam por
// atenção com a única ação frequente.
//
// O que fica fora do menu: "Nova sala", que é a ação de criação desta tela.
//
// Fecha com Esc e com clique fora, pelo mesmo par mousedown+ref que
// MultiSelectFiltro e MaisFiltros já usam nesta página — não inventar um
// terceiro mecanismo de "fechar ao clicar fora" na mesma tela.

import { useEffect, useRef, useState } from "react"
import { History, MoreHorizontal, Settings2, ShieldCheck } from "lucide-react"

interface MenuAcoesSalasProps {
  onHistorico: () => void
  onCategorias: () => void
  onExclusividade: () => void
}

export function MenuAcoesSalas({ onHistorico, onCategorias, onExclusividade }: MenuAcoesSalasProps) {
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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

  const itens = [
    { icone: History, label: "Histórico de alterações", acao: onHistorico },
    { icone: Settings2, label: "Categorias e status", acao: onCategorias },
    { icone: ShieldCheck, label: "Exclusividade de terapias", acao: onExclusividade },
  ]

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setAberto(v => !v)}
        aria-expanded={aberto}
        aria-haspopup="menu"
        aria-label="Mais ações"
        title="Mais ações"
        className="inline-flex size-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MoreHorizontal size={16} aria-hidden />
      </button>

      {aberto && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-60 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-lg"
        >
          {itens.map(({ icone: Icone, label, acao }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              onClick={() => { setAberto(false); acao() }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
            >
              <Icone size={14} className="shrink-0 text-muted-foreground" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
