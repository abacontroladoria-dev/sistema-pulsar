"use client"

// Drawer — painel lateral para detalhe de um item sem tirar o contexto de trás
// da tela. Irmão do ScheduleModal: mesma a11y (via useModalLayer), mesma pilha
// de Esc, geometria diferente.
//
// Mora aqui, e não em components/ui/, porque aquela pasta é um kit parcial onde
// `sheet.tsx` é um stub sem comportamento nenhum — usá-lo daria um painel sem
// foco, sem Esc e sem trap de Tab.
//
// Quando usar em vez de um modal: o conteúdo é o DETALHE de algo que continua
// visível atrás (uma célula da grade, uma linha da tabela), e o usuário vai
// abrir vários em sequência comparando. Um modal centralizado cobre justamente
// a lista de onde ele veio.

import { useRef } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { useModalLayer, Z_MODAL } from "./useModalLayer"

/**
 * Mesma camada do Z_MODAL: drawer e modal não coexistem como pares. Um modal
 * aberto A PARTIR do drawer (ex.: editar a alocação que o drawer mostra) usa
 * Z_MODAL_EMPILHADO e fica por cima, com o drawer montado atrás.
 */
export const Z_DRAWER = Z_MODAL

interface DrawerProps {
  title: string
  subtitle?: React.ReactNode
  /** Rodapé fixo (ex.: ações de editar/excluir). */
  footer?: React.ReactNode
  /** Largura do painel em px. O padrão cabe num texto de ~50 caracteres por linha. */
  width?: number
  zIndex?: number
  onClose: () => void
  children: React.ReactNode
}

export function Drawer({ title, subtitle, footer, width = 420, zIndex = Z_DRAWER, onClose, children }: DrawerProps) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  useModalLayer(cardRef, onClose)

  return createPortal(
    <div
      className="fixed inset-0 flex justify-end bg-black/45 animate-in fade-in duration-200 motion-reduce:animate-none"
      style={{ zIndex }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        // `max-w-full` para o painel virar tela cheia no celular em vez de
        // estourar a viewport com a largura fixa.
        className="flex h-full w-full max-w-full flex-col bg-card shadow-2xl outline-none animate-in slide-in-from-right duration-200 motion-reduce:animate-none"
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="text-[15px] font-black text-foreground">{title}</div>
            {subtitle && <div className="mt-1 text-[11px] text-muted-foreground">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg border border-border bg-muted px-3 text-[13px] text-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X size={13} /> Fechar
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          {children}
        </div>

        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
