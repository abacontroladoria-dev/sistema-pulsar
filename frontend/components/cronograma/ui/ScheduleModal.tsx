"use client"

// ScheduleModal — shell dos modais de grade semanal (§3 #5 do plano). Consolida
// a "moldura" idêntica de CronViewModal / ProfViewModal (Inconsistências) e
// AgendaModal (OcupProf): portal + overlay + card contido (header fixo, corpo
// rolável, footer opcional fixo). A grade e conteúdos ricos ficam como children;
// cada consumidor mantém suas células, que diferem demais para uma abstração
// única valer a pena.

import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"

/**
 * Camadas de empilhamento. Eram literais espalhados (60 aqui, 70 no detalhe do
 * PDI, `z-[100]` nos popovers de FiltrosPdi) — três números escolhidos em
 * arquivos diferentes, sem nada garantindo que a ordem entre eles fosse
 * intencional. Um popover de Radix passava POR CIMA dos dois modais e ninguém
 * percebia até acontecer.
 */
export const Z_MODAL = 60
/** Um modal aberto POR CIMA de outro que continua montado (ver PainelAnalistaShell). */
export const Z_MODAL_EMPILHADO = 70

/** Tudo que é focável dentro do card do modal — usado pelo trap de Tab. */
const SELETOR_FOCAVEL = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",")

/**
 * Pilha dos ScheduleModal montados, na ordem em que montaram — ver o efeito do
 * Esc abaixo. É uma pilha, e não um contador, porque desmontagem fora de ordem
 * (o de dentro saindo depois do de fora) faria um contador dessincronizar e o
 * Esc parar de funcionar para todo mundo; remover por identidade não tem esse
 * modo de falha.
 */
const pilhaModais: symbol[] = []

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
  // `onClose` é quase sempre uma arrow inline no chamador, ou seja uma
  // referência nova a cada render do pai. Guardá-la numa ref mantém o efeito
  // abaixo com dependências VAZIAS: sem isso ele remontaria a cada render do
  // pai, tirando e repondo este modal no topo da pilha — e um Esc no meio
  // dessa janela fechava o modal de baixo em vez do de cima.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const id = Symbol("modal")
    pilhaModais.push(id)
    const noTopo = () => pilhaModais[pilhaModais.length - 1] === id

    // Devolver o foco para onde ele estava. Sem isto, fechar o modal deixava o
    // foco no `<body>` e o teclado recomeçava do topo da página — quem abriu
    // pelo cartão do coordenador perdia o lugar exatamente como acontecia
    // antes na navegação visual.
    const focoAnterior = document.activeElement as HTMLElement | null

    const onKey = (e: KeyboardEvent) => {
      if (!noTopo()) return
      if (e.key === "Escape") {
        onCloseRef.current()
        return
      }
      if (e.key !== "Tab") return

      // Trap de Tab. `aria-modal="true"` promete que o resto da página está
      // inerte; sem prender o Tab a promessa era falsa — dava para tabular
      // para trás do overlay, e com dois modais empilhados para dentro do
      // modal de baixo, sem nenhum sinal visual de onde se estava.
      const card = cardRef.current
      if (!card) return

      // Popover/select do Radix (ex.: o DatePicker de PdiDetalheModal) renderiza
      // num portal IRMÃO do card, não dentro dele. Prender o Tab ali dentro
      // arrastaria o foco de volta para o modal no meio da escolha da data e
      // deixaria o calendário inalcançável pelo teclado. Enquanto o foco está
      // numa camada dessas, ela manda.
      const ativoAgora = document.activeElement
      if (ativoAgora?.closest("[data-radix-popper-content-wrapper],[role=listbox],[role=menu]")) return

      const focaveis = [...card.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
      if (focaveis.length === 0) {
        e.preventDefault()
        card.focus()
        return
      }
      const primeiro = focaveis[0]
      const ultimo = focaveis[focaveis.length - 1]
      const ativo = document.activeElement
      if (!e.shiftKey && (ativo === ultimo || !card.contains(ativo))) {
        e.preventDefault()
        primeiro.focus()
      } else if (e.shiftKey && (ativo === primeiro || !card.contains(ativo))) {
        e.preventDefault()
        ultimo.focus()
      }
    }

    document.addEventListener("keydown", onKey)
    const cardNoMomento = cardRef.current
    return () => {
      document.removeEventListener("keydown", onKey)
      const i = pilhaModais.indexOf(id)
      if (i !== -1) pilhaModais.splice(i, 1)
      const focoAtual = document.activeElement
      // Só devolve o foco se ele ficou "solto" (no body) ou ainda dentro deste
      // modal que está saindo. Se o usuário já clicou noutro lugar da página,
      // roubá-lo de volta seria pior que não restaurar nada.
      const foraDoModal =
        focoAtual === document.body || focoAtual === null || !!cardNoMomento?.contains(focoAtual)
      if (focoAnterior?.isConnected && foraDoModal) {
        focoAnterior.focus()
      }
    }
  }, [])

  // Foco inicial no card. Um `tabIndex={-1}` no container evita escolher por
  // conta própria qual campo "merece" o foco — o leitor de tela anuncia o
  // diálogo e o primeiro Tab entra na ordem natural.
  useEffect(() => {
    cardRef.current?.focus()
  }, [])

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
