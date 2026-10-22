"use client"

import Link from "next/link"
import { Star } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { MenuItemDef } from "@/lib/permissions/menu"

// Um grupo do menu aberto no centro da tela (hoje só Cadastros, dentro de
// Configurações — ver MENU_GRUPOS_EM_MODAL em lib/permissions/menu.ts). Chegam só
// as telas que a pessoa pode abrir; a estrela de favorito fica aqui porque estes
// itens não aparecem mais soltos no Sidebar.

interface ModalGrupoMenuProps {
  titulo: string
  icon: React.ElementType
  itens: MenuItemDef[]
  aberto: boolean
  onFechar: () => void
  isActive: (path: string) => boolean
  isFavorito: (path: string) => boolean
  onAlternarFavorito: (label: string, path: string) => void
}

export function ModalGrupoMenu({
  titulo,
  icon: IconeGrupo,
  itens,
  aberto,
  onFechar,
  isActive,
  isFavorito,
  onAlternarFavorito,
}: ModalGrupoMenuProps) {
  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!v) onFechar() }}>
      <DialogContent className="gap-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="flex-row items-center gap-3 border-b border-border px-5 py-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-primary">
            <IconeGrupo size={18} aria-hidden="true" />
          </span>
          <DialogTitle className="text-base">{titulo}</DialogTitle>
          <DialogDescription className="sr-only">Telas de {titulo}</DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[70vh] grid-cols-1 gap-2 overflow-y-auto p-4 sm:grid-cols-2">
          {itens.map((item) => {
            const Icone = item.icon
            const ativo = isActive(item.path)
            const fav = isFavorito(item.path)
            return (
              <Link
                key={item.codigo}
                href={item.path}
                onClick={onFechar}
                className={`group flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors duration-150
                  ${ativo
                    ? "border-sidebar-primary bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                    : "border-border text-foreground hover:border-sidebar-primary/40 hover:bg-sidebar-accent/50"
                  }`}
              >
                <span
                  className={`flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors
                    ${ativo ? "bg-card text-sidebar-primary" : "bg-muted text-muted-foreground group-hover:bg-card group-hover:text-sidebar-primary"}`}
                >
                  <Icone size={16} aria-hidden="true" />
                </span>
                <span className="flex-1 break-words text-left">{item.label}</span>
                <span
                  role="button"
                  aria-label={fav ? `Tirar ${item.label} dos favoritos` : `Favoritar ${item.label}`}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAlternarFavorito(item.label, item.path) }}
                  className={`rounded p-1 transition-all duration-150 hover:bg-sidebar-accent
                    ${fav
                      ? "text-yellow-500 opacity-100"
                      : "text-muted-foreground/50 opacity-100 hover:text-yellow-500 sm:opacity-0 sm:group-hover:opacity-100"
                    }`}
                >
                  <Star size={12} fill={fav ? "currentColor" : "none"} />
                </span>
              </Link>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
