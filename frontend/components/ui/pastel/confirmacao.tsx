'use client'

import { useCallback, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'
import { useModalLayer, Z_MODAL_EMPILHADO } from '@/components/cronograma/ui/useModalLayer'
import { tom, type Tom } from './pecas'

// Confirmação no visual pastel do Pulsar — substitui o window.confirm do
// navegador (caixa preta, fonte do sistema operacional) nas telas que usam o
// kit pastel. Uso:
//
//   const { confirmar, dialogo } = useConfirmacao()
//   if (!(await confirmar({ titulo: 'Descartar esta nova versão?', ... }))) return
//   ...
//   return <>{...}{dialogo}</>
//
// Esc, clique fora e "Cancelar" respondem false. Foco preso no cartão
// (useModalLayer, a mesma pilha dos outros modais).

export type PedidoConfirmacao = {
  titulo: string
  texto?: ReactNode
  /** Rótulo do botão de ação. */
  confirmar: string
  cancelar?: string
  /** Tom do ícone e do botão de ação. vermelho = destrutivo. */
  t?: Tom
  Icone?: typeof AlertTriangle
}

export function useConfirmacao() {
  const [pedido, setPedido] = useState<(PedidoConfirmacao & { responder: (ok: boolean) => void }) | null>(null)

  const confirmar = useCallback(
    (p: PedidoConfirmacao) =>
      new Promise<boolean>(resolve => {
        setPedido({
          ...p,
          responder: ok => {
            setPedido(null)
            resolve(ok)
          },
        })
      }),
    []
  )

  const dialogo = pedido ? <DialogoConfirmacao {...pedido} /> : null
  return { confirmar, dialogo }
}

function DialogoConfirmacao({
  titulo, texto, confirmar, cancelar = 'Cancelar', t = 'aco', Icone = AlertTriangle, responder,
}: PedidoConfirmacao & { responder: (ok: boolean) => void }) {
  const cartao = useRef<HTMLDivElement>(null)
  useModalLayer(cartao, () => responder(false))

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/45 p-4 animate-in fade-in duration-150 motion-reduce:animate-none"
      style={{ zIndex: Z_MODAL_EMPILHADO }}
      onClick={e => { if (e.target === e.currentTarget) responder(false) }}
    >
      <div
        ref={cartao}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmacao-titulo"
        className={`pp ${tom(t)} w-full max-w-md rounded-[24px] bg-[var(--pp-surface)] p-6 shadow-[var(--pp-sombra-alta)] outline-none animate-in zoom-in-95 duration-150 motion-reduce:animate-none`}
      >
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-[var(--c)] text-[var(--c-sobre)]" aria-hidden>
            <Icone className="h-6 w-6" />
          </span>
          <div className="min-w-0 pt-1">
            <h2 id="confirmacao-titulo" className="text-[18px] font-extrabold leading-6">{titulo}</h2>
            {texto && <div className="mt-1.5 whitespace-pre-line text-sm font-semibold text-[var(--pp-ink-muted)]">{texto}</div>}
          </div>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" autoFocus onClick={() => responder(false)} className={`${tom('cinza')} pp-btn pp-btn-suave`}>
            {cancelar}
          </button>
          <button type="button" onClick={() => responder(true)} className={`${tom(t)} pp-btn`}>
            {confirmar}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
