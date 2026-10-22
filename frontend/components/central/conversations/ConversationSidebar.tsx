'use client'

import { useState } from 'react'
import { Search, ChevronDown, Plus, X } from 'lucide-react'
import type { ConversationStatus } from '@/modules/atendimento/types/central.types'
import { useConversas, horaCurta, iniciais, type ConversaComContato } from '../useCentralData'

type Filter = 'all' | ConversationStatus

const DOT_COLOR: Record<ConversationStatus, string> = {
  self_service: 'bg-violet-400',
  open:     'bg-emerald-400',
  waiting:  'bg-amber-400',
  assigned: 'bg-sky-400',
  resolved: 'bg-slate-400',
  archived: 'bg-slate-400',
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all',      label: 'Todas'      },
  { key: 'open',     label: 'Abertas'    },
  { key: 'waiting',  label: 'Aguardando' },
  { key: 'assigned', label: 'Atribuídas' },
]

interface SidebarProps {
  isOpen:            boolean
  onClose:           () => void
  selectedId:        string | null
  onSelect:          (id: string) => void
}

export default function ConversationSidebar({
  isOpen, onClose, selectedId, onSelect,
}: SidebarProps) {
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')

  const { conversas, carregando, erro } = useConversas()

  const conversations = conversas.filter(({ conversa, contato }) => {
    if (filter !== 'all' && conversa.status !== filter) return false
    if (search) {
      const nome = contato?.name ?? contato?.display_phone ?? ''
      if (!nome.toLowerCase().includes(search.toLowerCase())) return false
    }
    return true
  })

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          aria-hidden="true"
          onClick={onClose}
        />
      )}

      <aside
        aria-label="Lista de conversas"
        className={`bg-central-sidebar fixed inset-y-0 left-0 z-40 shrink-0 lg:static lg:z-auto lg:inset-auto w-80 flex flex-col border-r border-border overflow-hidden transition-transform duration-300 ease-out motion-reduce:transition-none ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="lg:hidden flex items-center justify-between px-4 pt-3.5 pb-2 shrink-0">
          <span className="text-muted-foreground text-xs font-medium">Conversas</span>
          <button
            onClick={onClose}
            aria-label="Fechar conversas"
            className="min-w-11 min-h-11 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/8 rounded-lg transition-colors -mr-2"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-4 pt-4 pb-3 shrink-0">
          <button className="w-full flex items-center justify-between bg-background hover:bg-muted border border-border rounded-xl px-3.5 py-2.5 transition-colors">
            <div className="flex items-center gap-2.5">
              <div className="size-2 rounded-full bg-emerald-400 shadow-[0_0_6px_var(--color-emerald-400)]" />
              <span className="text-sm font-medium text-foreground">WhatsApp Recepção</span>
            </div>
            <ChevronDown className="size-4 text-muted-foreground" />
          </button>
        </div>

        <div className="px-4 pb-3 shrink-0">
          <label htmlFor="conv-search" className="sr-only">
            Buscar conversa
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" aria-hidden="true" />
            <input
              id="conv-search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar conversa..."
              className="w-full bg-background border border-border text-foreground placeholder:text-muted-foreground text-sm rounded-lg pl-9 pr-3 py-2 outline-none focus:border-brand/50 transition-all"
            />
          </div>
        </div>

        <div className="px-3 pb-2.5 flex items-center gap-1 shrink-0 border-b border-border">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
                filter === f.key
                  ? 'bg-brand text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5'
              }`}
            >
              {f.label}
            </button>
          ))}
          <button
            aria-label="Nova conversa"
            className="ml-auto p-1.5 text-muted-foreground hover:text-foreground hover:bg-foreground/5 rounded-lg transition-colors"
          >
            <Plus className="size-3.5" />
          </button>
        </div>

        <div
          role="log"
          aria-live="polite"
          className="flex-1 overflow-y-auto"
        >
          {/* Três estados distintos, de propósito: uma lista vazia por erro de
              rede e uma lista vazia porque ninguém escreveu ainda parecem
              iguais na tela, e são problemas opostos. */}
          {carregando ? (
            <div className="flex items-center justify-center h-24">
              <p className="text-muted-foreground text-sm">Carregando conversas...</p>
            </div>
          ) : erro ? (
            <div className="flex items-center justify-center h-24 px-4">
              <p className="text-rose-500 text-sm text-center">
                Não foi possível carregar as conversas.
                <span className="block text-muted-foreground text-xs mt-1">{erro}</span>
              </p>
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex items-center justify-center h-24">
              <p className="text-muted-foreground text-sm">Nenhuma conversa encontrada</p>
            </div>
          ) : (
            conversations.map(item => (
              <ConversationCard
                key={item.conversa.id}
                item={item}
                selecionada={item.conversa.id === selectedId}
                onSelect={onSelect}
              />
            ))
          )}
        </div>
      </aside>
    </>
  )
}

// O card do mock mostrava um trecho da última mensagem e um badge de não-lidas.
// Nenhum dos dois existe em central.conversations: o preview exigiria uma query
// de mensagem POR conversa a cada 5s, e não há coluna de não-lidas no schema.
// Em vez de inventar números, o card mostra o que é verdade — o telefone e o
// horário da última mensagem.
function ConversationCard({
  item, selecionada, onSelect,
}: {
  item:        ConversaComContato
  selecionada: boolean
  onSelect:    (id: string) => void
}) {
  const { conversa, contato } = item
  const nome = contato?.name ?? contato?.display_phone ?? 'Contato sem nome'

  return (
    <button
      onClick={() => onSelect(conversa.id)}
      aria-current={selecionada ? 'true' : undefined}
      className={`w-full flex items-center gap-3 px-4 py-3.5 transition-colors border-b border-border text-left ${
        selecionada ? 'bg-brand-surface' : 'hover:bg-foreground/5'
      }`}
    >
      <div className="relative shrink-0">
        <div className="size-9 rounded-full bg-muted flex items-center justify-center text-muted-foreground text-xs font-semibold">
          {iniciais(nome)}
        </div>
        <span
          className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 ${DOT_COLOR[conversa.status]}`}
          style={{ borderColor: 'var(--color-central-sidebar)' }}
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-foreground truncate">{nome}</span>
          <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
            {horaCurta(conversa.last_message_at ?? conversa.created_at)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {contato?.display_phone ?? 'WhatsApp'}
        </p>
      </div>
    </button>
  )
}
