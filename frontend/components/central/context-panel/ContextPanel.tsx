'use client'

import { X } from 'lucide-react'
import ContactCard          from './ContactCard'
import PatientLinksCard     from './PatientLinksCard'
import ConversationMetaCard from './ConversationMetaCard'
import InternalNotesCard    from './InternalNotesCard'
import type { Conversation } from '@/modules/atendimento/types/central.types'

interface Props {
  isOpen:       boolean
  onClose:      () => void
  // Só as tags de ConversationMetaCard leem isto por enquanto — o resto do
  // painel (ContactCard, PatientLinksCard, InternalNotesCard) continua mock,
  // fora do escopo desta etapa.
  conversation: Conversation | null
}

export default function ContextPanel({ isOpen, onClose, conversation }: Props) {
  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          aria-hidden="true"
          onClick={onClose}
        />
      )}

      <aside
        className={`bg-central-panel fixed inset-y-0 right-0 z-40 flex flex-col border-l border-border overflow-hidden w-full sm:w-90 lg:static lg:z-auto lg:inset-auto lg:shrink-0 transition-transform lg:transition-[width] duration-300 ease-out motion-reduce:transition-none will-change-transform lg:will-change-[width] ${
          isOpen
            ? 'translate-x-0 lg:w-90'
            : 'translate-x-full lg:translate-x-0 lg:w-0'
        }`}
      >
        <div className="w-full lg:w-90 flex flex-col h-full overflow-hidden">
          <div className="h-14 shrink-0 flex items-center justify-between px-5 border-b border-border bg-card">
            <h2 className="text-sm font-semibold text-foreground">Detalhes</h2>
            <button
              onClick={onClose}
              aria-label="Fechar painel"
              className="min-w-11 min-h-11 flex items-center justify-center -mr-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <ContactCard />
            <PatientLinksCard />
            <ConversationMetaCard conversation={conversation} />
            <InternalNotesCard />
          </div>
        </div>
      </aside>
    </>
  )
}
