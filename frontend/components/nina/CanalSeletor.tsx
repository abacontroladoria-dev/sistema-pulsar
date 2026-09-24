'use client'

import React from 'react'
import { Bot, Smartphone } from 'lucide-react'

import type { CanalInbox } from '@/hooks/nina/useCentralInbox'

// ============================================================================
// Seletor de números da /connect/inbox
//
// Chips com rolagem horizontal: cabe no celular da recepção sem quebrar linha.
// Seleção vazia = todos os números que o usuário pode atender. O número da Maia
// (Meta) vem marcado com o robô; os números Evolution, com o celular — é a
// diferença que importa para quem atende: num a IA pode estar respondendo, no
// outro é sempre gente.
//
// Não aparece para quem só tem um número: um filtro de uma opção só é ruído.
// ============================================================================

interface Props {
  canais:       CanalInbox[]
  selecionados: string[]
  aoAlternar:   (id: string) => void
  aoMostrarTodos: () => void
}

const COR_STATUS: Record<string, string> = {
  active:     'bg-emerald-500',
  connecting: 'bg-amber-500',
}

const TITULO_STATUS: Record<string, string> = {
  active:       'Conectado',
  connecting:   'Conectando',
  disconnected: 'Desconectado',
  error:        'Com erro',
  suspended:    'Suspenso',
}

export function CanalSeletor({ canais, selecionados, aoAlternar, aoMostrarTodos }: Props) {
  if (canais.length <= 1) return null

  const todos = selecionados.length === 0

  const chip = (ativo: boolean) =>
    `shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
      ativo
        ? 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/40'
        : 'bg-background text-muted-foreground border-border hover:bg-muted hover:text-foreground'
    }`

  return (
    <div
      className="flex gap-1.5 overflow-x-auto custom-scrollbar pb-1 mt-3 -mx-1 px-1"
      role="group"
      aria-label="Números exibidos"
    >
      <button type="button" onClick={aoMostrarTodos} aria-pressed={todos} className={chip(todos)}>
        Todos
      </button>

      {canais.map(canal => {
        const ativo = selecionados.includes(canal.id)
        const Icone = canal.provider === 'evolution' ? Smartphone : Bot
        return (
          <button
            key={canal.id}
            type="button"
            onClick={() => aoAlternar(canal.id)}
            aria-pressed={ativo}
            title={`${canal.name} — ${TITULO_STATUS[canal.status] ?? canal.status}`}
            className={chip(ativo)}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${COR_STATUS[canal.status] ?? 'bg-rose-500'}`} />
            <Icone className="w-3 h-3" />
            <span className="max-w-[9rem] truncate">{canal.name}</span>
          </button>
        )
      })}
    </div>
  )
}
