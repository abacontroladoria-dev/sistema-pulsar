"use client"

import { ChevronDown } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MENU_AREA_POR_ID, type AreaId, type MenuAreaDef } from "@/lib/permissions/menu"

type Props = {
  area: AreaId
  /** Só as áreas liberadas para a pessoa (useAreasVisiveis). */
  areas: MenuAreaDef[]
  onEscolher: (area: AreaId) => void
  /** Sidebar recolhido do Connect: só o ícone. */
  compacto?: boolean
}

// Seletor acima do menu: Operacional · Financeiro · Relatórios · Pulsar Connect.
// Troca só o que o Sidebar lista, sem navegar — exceto Connect, que tem tela
// própria. Quem só tem uma área vê o nome dela, sem lista para abrir.
export function SeletorArea({ area, areas, onEscolher, compacto = false }: Props) {
  const atual = MENU_AREA_POR_ID[area]
  const Icone = atual.icon
  // Lista só quando há para onde ir. Quem só tem o Connect, fora dele, ainda
  // precisa da lista: é o caminho até o Connect (o item solto do menu saiu).
  const soUma = areas.length === 0 || (areas.length === 1 && areas[0].id === area)

  const rotulo = (
    <>
      <Icone size={16} className="shrink-0" aria-hidden="true" />
      {!compacto && <span className="flex-1 text-left truncate">{atual.nome}</span>}
    </>
  )

  if (soUma) {
    if (compacto) return null
    return (
      <div className="flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-sm font-semibold text-sidebar-foreground">
        {rotulo}
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={compacto ? `Área: ${atual.nome}` : undefined}
          title={compacto ? `Área: ${atual.nome}` : undefined}
          className={`flex h-10 items-center gap-2.5 rounded-lg border border-sidebar-ring/60 bg-card text-sm font-semibold text-sidebar-accent-foreground transition-colors hover:bg-sidebar-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring ${
            compacto ? "w-10 justify-center" : "w-full px-3"
          }`}
        >
          {rotulo}
          {!compacto && <ChevronDown size={16} className="shrink-0 opacity-70" aria-hidden="true" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuRadioGroup value={area} onValueChange={(v) => onEscolher(v as AreaId)}>
          {areas.map((a) => {
            const I = a.icon
            return (
              <DropdownMenuRadioItem key={a.id} value={a.id}>
                <I size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="flex-1">{a.nome}</span>
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
