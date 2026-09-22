'use client'

import { useState } from 'react'
import CentralTopbar       from './CentralTopbar'
import ConversationSidebar from '../conversations/ConversationSidebar'
import ChatPane            from '../chat/ChatPane'
import ContextPanel        from '../context-panel/ContextPanel'
import { useConversas }    from '../useCentralData'

export default function CentralWorkspace() {
  const [contextPanelOpen, setContextPanelOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen]           = useState(false)

  // A conversa selecionada vive AQUI porque dois irmãos dependem dela: a
  // sidebar precisa destacá-la e o ChatPane precisa carregar as mensagens dela.
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // O ChatPane precisa do contato para o cabeçalho, e o contato vem junto da
  // lista de conversas. useConversas é compartilhado — as duas chamadas atingem
  // as mesmas rotas no mesmo intervalo, o custo é o cache HTTP do navegador.
  const { conversas } = useConversas()
  const conversaSelecionada = conversas.find(c => c.conversa.id === selectedId) ?? null
  const contato = conversaSelecionada?.contato ?? null

  function selecionar(id: string) {
    setSelectedId(id)
    // No celular a sidebar é uma gaveta sobre o chat: escolher uma conversa e
    // continuar vendo a lista deixaria a mensagem escondida atrás dela.
    setSidebarOpen(false)
  }

  function openSidebar() {
    setContextPanelOpen(false)
    setSidebarOpen(true)
  }

  function toggleContextPanel() {
    if (!contextPanelOpen) setSidebarOpen(false)
    setContextPanelOpen(o => !o)
  }

  return (
    <div className="h-full flex flex-col">
      <CentralTopbar onOpenSidebar={openSidebar} />
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <ConversationSidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          selectedId={selectedId}
          onSelect={selecionar}
        />
        <ChatPane
          contextPanelOpen={contextPanelOpen}
          onToggleContextPanel={toggleContextPanel}
          conversationId={selectedId}
          contato={contato}
        />
        <ContextPanel
          isOpen={contextPanelOpen}
          onClose={() => setContextPanelOpen(false)}
          conversation={conversaSelecionada?.conversa ?? null}
        />
      </div>
    </div>
  )
}
