"use client"

// ScheduleModal — shell dos modais de grade semanal (§3 #5 do plano). Consolida
// a "moldura" idêntica de CronViewModal / ProfViewModal (Inconsistências) e
// AgendaModal (OcupProf): portal + overlay + card contido (header fixo, corpo
// rolável, footer opcional fixo). A grade e conteúdos ricos ficam como children;
// cada consumidor mantém suas células, que diferem demais para uma abstração
// única valer a pena.

import { useRef } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { useModalLayer, Z_MODAL, Z_MODAL_EMPILHADO } from "./useModalLayer"

// A pilha/Esc/trap de Tab/restauração de foco moraram aqui até o Drawer de
// Ocupação de Salas precisar do mesmo comportamento; agora vivem em
// useModalLayer, e as duas camadas compartilham UMA pilha (Esc fecha a de cima,
// seja modal ou drawer). Z_MODAL continua exportado daqui porque dezenas de
// arquivos o importam deste módulo.
export { Z_MODAL, Z_MODAL_EMPILHADO }

interface ScheduleModalProps {
  title: string
  subtitle?: React.ReactNode
  /** Linha de aviso (ex.: N slots fora da unidade) — renderizada em âmbar. */
  warning?: React.ReactNode
  /** Rodapé fixo (ex.: ações Aceitar/Desfazer/Fechar). */
  footer?: React.ReactNode
  maxWidth?: number
  /**
   * Camada do overlay. O padrão (60) atende todo mundo; só passe outro valor
   * para EMPILHAR um modal sobre outro que já está aberto (ver
   * PainelAnalistaShell.tsx: o detalhe do paciente abre por cima da lista do
   * coordenador, que continua montada atrás).
   */
  zIndex?: number
  onClose: () => void
  children: React.ReactNode
}

export function ScheduleModal({ title, subtitle, warning, footer, maxWidth = 820, zIndex = Z_MODAL, onClose, children }: ScheduleModalProps) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  useModalLayer(cardRef, onClose)

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/45 p-4 animate-in fade-in duration-200 motion-reduce:animate-none"
      style={{ zIndex }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        className="flex max-h-[92vh] w-full flex-col rounded-2xl bg-card shadow-2xl outline-none animate-in zoom-in-95 duration-200 motion-reduce:animate-none"
        style={{ maxWidth }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="text-[15px] font-black text-foreground">{title}</div>
            {subtitle && <div className="mt-1 text-[11px] text-muted-foreground">{subtitle}</div>}
            {warning && (
              <div className="mt-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400">{warning}</div>
            )}
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

        {/* Corpo rolável */}
        <div className="flex-1 overflow-auto px-5 py-4">
          {children}
        </div>

        {/* Footer fixo */}
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
