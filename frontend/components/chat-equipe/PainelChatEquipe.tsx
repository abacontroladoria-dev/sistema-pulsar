'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { MessagesSquare, X } from 'lucide-react'
import { Toaster } from 'sonner'

import dynamic from 'next/dynamic'
import { useChatEquipe } from '@/contexts/ChatEquipeContext'

// Sob demanda: o painel está no layout raiz, e sem isto o conteúdo dele
// entraria no bundle de toda tela — a /tv e as páginas públicas inclusive.
const ChatEquipe = dynamic(() => import('@/components/chat-equipe/ChatEquipe'), { ssr: false })

// ============================================================================
// Painel lateral do Chat da equipe — montado no layout raiz, abre pelo item
// "Chat da equipe" do sidebar do Pulsar e do Connect.
//
// NÃO MODAL, de propósito: sem fundo escurecido e sem prender o foco, para a
// pessoa continuar clicando no sidebar com ele aberto — inclusive passar do
// Pulsar para o Connect, que é o motivo de ele morar no layout raiz.
//
// z-[45]: acima do sino (z-40) e da página, ABAIXO dos Dialogs (z-50) — um
// modal aberto pela página continua por cima do painel. A ImpersonationBar
// (z-60, fixa no topo) empurra o painel para baixo em vez de cobri-lo.
// ============================================================================

export default function PainelChatEquipe() {
  const { aberto, fechar } = useChatEquipe()
  const pathname = usePathname()
  const painelRef = useRef<HTMLElement>(null)

  // A barra é de (dashboard) e o painel é do layout raiz: mede no DOM.
  useEffect(() => {
    if (!aberto || !painelRef.current) return
    const barra = document.querySelector('[data-impersonation-bar]')
    painelRef.current.style.top = `${barra ? barra.getBoundingClientRect().bottom : 0}px`
  }, [aberto, pathname])

  // Esc fecha — mas não quando o Esc é de algo aberto por cima: um Dialog, o
  // seletor de emoji (Popover = role dialog), o menu "Mais ações" de uma
  // mensagem ou a confirmação de apagar.
  useEffect(() => {
    if (!aberto) return
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector(
        '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]',
      )) return
      fechar()
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [aberto, fechar])

  // Em /chat-equipe o mesmo conteúdo já está na tela inteira.
  const naPagina = pathname.startsWith('/chat-equipe')
  const mostrar = aberto && !naPagina

  // O conteúdo avisa por `toast` do sonner. O Connect já monta um Toaster no
  // layout dele; o Pulsar só tem o da react-hot-toast — sem este, uma mensagem
  // que não foi enviada sumiria calada. Embaixo para não cair sobre o sino. Só
  // com o chat na tela: nada disto entra nas telas públicas (a /tv inclusive).
  const precisaToaster = (mostrar || naPagina) && !pathname.startsWith('/connect')

  return (
    <>
      {mostrar && (
        <aside
          role="complementary"
          aria-label="Chat da equipe"
          ref={painelRef}
          className="fixed top-0 bottom-0 right-0 z-45 flex w-full flex-col border-l border-border bg-background text-foreground shadow-2xl sm:w-104"
        >
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
            <MessagesSquare className="h-5 w-5 text-cyan-600" aria-hidden />
            <h2 className="text-base font-semibold">Chat da equipe</h2>
            <button
              type="button"
              onClick={fechar}
              aria-label="Fechar o Chat da equipe"
              className="ml-auto rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <ChatEquipe />
          </div>
        </aside>
      )}
      {precisaToaster && <Toaster position="bottom-right" richColors closeButton />}
    </>
  )
}
