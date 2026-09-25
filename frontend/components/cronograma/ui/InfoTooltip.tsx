"use client"

// InfoTooltip — ícone de lâmpada que abre um painel explicativo ao clique/toque
// (em vez do `title` nativo, que não funciona em telas touch). Fecha ao clicar
// fora, ao pressionar Escape, ou ao clicar novamente no ícone.
//
// O painel é renderizado num portal (position: fixed, ancorado às coordenadas
// do botão) em vez de posicionado relativo ao próprio ícone — colunas de tabela
// costumam viver dentro de um container com overflow-x-auto, que corta qualquer
// filho absolute/relative que ultrapasse suas bordas. O portal escapa desse clip
// e a posição é recalculada a cada abertura, com clamp horizontal pra não
// estourar a tela nas colunas mais à direita.

import { useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Lightbulb } from "lucide-react"

interface InfoTooltipProps {
  children: ReactNode
  ariaLabel?: string
  /** Notificado sempre que o painel abre/fecha — usado, por ex., para destacar o elemento a que o tooltip se refere. */
  onOpenChange?: (open: boolean) => void
  /** Conteúdo extra renderizado dentro do próprio botão-gatilho, antes do ícone — permite que um texto ao lado (ex.: "N oportunidade(s)") também abra o painel, em vez de só o ícone da lâmpada. */
  trigger?: ReactNode
  /** Largura do painel em px (padrão 288). Em tela estreita continua limitada a 85% da largura. */
  largura?: number
}

const PANEL_WIDTH = 288 // w-72
const VIEWPORT_MARGIN = 8

export function InfoTooltip({ children, ariaLabel = "Explicação das colunas", onOpenChange, trigger, largura = PANEL_WIDTH }: InfoTooltipProps) {
  const [open, setOpenState] = useState(false)
  const setOpen = (value: boolean | ((prev: boolean) => boolean)) => {
    setOpenState(prev => {
      const next = typeof value === "function" ? value(prev) : value
      onOpenChange?.(next)
      return next
    })
  }
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  function reposition() {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const efetiva = Math.min(largura, window.innerWidth * 0.85)
    const maxLeft = window.innerWidth - VIEWPORT_MARGIN - efetiva
    const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft))
    setCoords({ top: rect.bottom + 6, left })
  }

  function toggle() {
    if (!open) reposition()
    setOpen(v => !v)
  }

  useEffect(() => {
    if (!open) return
    function onOutside(e: MouseEvent | TouchEvent) {
      const target = e.target as Node
      if (buttonRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    function onViewportChange() {
      setOpen(false)
    }
    document.addEventListener("mousedown", onOutside)
    document.addEventListener("touchstart", onOutside)
    document.addEventListener("keydown", onEscape)
    window.addEventListener("scroll", onViewportChange, true)
    window.addEventListener("resize", onViewportChange)
    return () => {
      document.removeEventListener("mousedown", onOutside)
      document.removeEventListener("touchstart", onOutside)
      document.removeEventListener("keydown", onEscape)
      window.removeEventListener("scroll", onViewportChange, true)
      window.removeEventListener("resize", onViewportChange)
    }
  }, [open])

  return (
    <span className="relative inline-flex" onClick={e => e.stopPropagation()}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={toggle}
        className={trigger
          ? "inline-flex items-center gap-1 rounded-full transition-colors hover:text-foreground"
          : "inline-flex items-center justify-center rounded-full p-0.5 text-amber-500 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"}
      >
        {trigger}
        <Lightbulb size={14} className={trigger ? "shrink-0 text-amber-500" : undefined} />
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          role="tooltip"
          style={{ top: coords.top, left: coords.left, width: largura }}
          className="fixed z-50 max-w-[85vw] rounded-lg border border-border bg-popover p-3 text-xs font-normal normal-case text-popover-foreground shadow-lg"
        >
          {children}
        </div>,
        document.body,
      )}
    </span>
  )
}
