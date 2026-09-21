'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Smile } from 'lucide-react'

// ============================================================================
// Seletor de emoji do compositor
//
// SEM BIBLIOTECA, E SEM RADIX
//
// Uma lib de emoji custa centenas de KB para entregar busca por palavra-chave,
// tom de pele e sequências ZWJ — nada disso é usado por quem responde uma
// recepção de clínica. A lista abaixo é curada: são os emojis que aparecem de
// fato num atendimento em português, agrupados pelo que a pessoa quer dizer.
//
// O Radix também está fora, e não por preferência: `components/ui/popover.tsx`
// neste repo é um STUB (três divs que ignoram todas as props) — usá-lo abriria
// um painel que nunca fecha. O popover aqui é próprio, e por isso precisa
// resolver à mão as três coisas que um popover de verdade resolve: fechar no
// clique fora, fechar no Escape, e não roubar o foco do textarea ao fechar.
//
// Esse último ponto é o que faz a diferença na prática. Se o botão ficasse com
// o foco depois da escolha, quem seleciona dois emojis seguidos teria que
// clicar no campo entre um e outro — e o cursor voltaria para o fim do texto,
// não para onde estava. Por isso o clique no emoji não move o foco (o
// `onMouseDown` com `preventDefault` impede o navegador de tirá-lo do textarea)
// e quem reposiciona o cursor é o compositor.
// ============================================================================

const CATEGORIAS: { nome: string; icone: string; emojis: string[] }[] = [
  {
    nome: 'Rostos',
    icone: '🙂',
    emojis: [
      '😀', '😃', '😄', '😁', '😊', '🙂', '😉', '😍', '🥰', '😘',
      '😗', '🤗', '🤔', '😐', '😴', '😌', '😔', '😕', '🙁', '😢',
      '😭', '😤', '😠', '😥', '😰', '😅', '😂', '🤣', '😎', '🤓',
      '🥳', '😇', '🙃', '😬', '😶', '🤝', '🙏', '💪', '👀', '🫶',
    ],
  },
  {
    nome: 'Gestos',
    icone: '👍',
    emojis: [
      '👍', '👎', '👌', '✌️', '🤞', '👋', '🤙', '👏', '🙌', '✋',
      '🤚', '☝️', '👇', '👉', '👈', '✍️', '🫡', '🤲', '🖐️', '✊',
    ],
  },
  {
    nome: 'Coração',
    icone: '❤️',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💖', '💝',
      '💗', '💕', '💞', '❣️', '💔', '💫', '✨', '🌟', '⭐', '🔥',
    ],
  },
  {
    nome: 'Clínica',
    icone: '🩺',
    emojis: [
      '🩺', '💊', '🏥', '🧑‍⚕️', '👩‍⚕️', '👨‍⚕️', '🧠', '🦷', '🩹', '💉',
      '🧩', '🧸', '👶', '👦', '👧', '👪', '🎒', '📚', '✏️', '🎨',
    ],
  },
  {
    nome: 'Agenda',
    icone: '📅',
    emojis: [
      '📅', '📆', '🗓️', '⏰', '⏳', '🕐', '✅', '☑️', '❌', '⚠️',
      '📍', '🗺️', '🚗', '🚌', '📞', '📱', '💬', '📧', '📄', '📋',
      '💰', '💳', '🧾', '📊', '🔔', '🔕', '🔗', '📌', '🎯', '🎉',
    ],
  },
]

export const SeletorEmoji: React.FC<{
  aoEscolher: (emoji: string) => void
  desabilitado?: boolean
}> = ({ aoEscolher, desabilitado }) => {
  const [aberto, setAberto]         = useState(false)
  const [categoria, setCategoria]   = useState(0)
  const container = useRef<HTMLDivElement>(null)

  // Clique fora e Escape. Só escuta enquanto aberto — um listener global
  // permanente em cada conversa aberta é desperdício.
  useEffect(() => {
    if (!aberto) return

    const foraDaqui = (e: MouseEvent) => {
      if (!container.current?.contains(e.target as Node)) setAberto(false)
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false)
    }

    // `mousedown`, e não `click`: o clique no textarea precisa fechar o painel
    // ANTES de posicionar o cursor, senão a primeira tentativa de digitar só
    // fecha o painel e o cursor não vai para onde a pessoa apontou.
    document.addEventListener('mousedown', foraDaqui)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', foraDaqui)
      document.removeEventListener('keydown', escape)
    }
  }, [aberto])

  const atual = CATEGORIAS[categoria]

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setAberto(v => !v)}
        disabled={desabilitado}
        title="Inserir emoji"
        aria-label="Inserir emoji"
        aria-expanded={aberto}
        className={`p-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
          aberto
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        }`}
      >
        <Smile className="w-5 h-5" />
      </button>

      {aberto && (
        <div
          role="dialog"
          aria-label="Emojis"
          className="absolute bottom-full left-0 mb-2 w-[19rem] rounded-xl border border-border bg-card shadow-xl z-50 overflow-hidden"
        >
          <div className="flex items-center gap-0.5 p-1.5 border-b border-border">
            {CATEGORIAS.map((c, i) => (
              <button
                key={c.nome}
                type="button"
                onClick={() => setCategoria(i)}
                title={c.nome}
                aria-label={c.nome}
                aria-pressed={i === categoria}
                className={`flex-1 py-1.5 rounded-lg text-base leading-none transition-colors ${
                  i === categoria ? 'bg-muted' : 'hover:bg-muted/60'
                }`}
              >
                {c.icone}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-8 gap-0.5 p-2 max-h-52 overflow-y-auto custom-scrollbar">
            {atual.emojis.map(e => (
              <button
                key={e}
                type="button"
                // O foco fica onde está: o textarea não perde o cursor, e a
                // próxima escolha entra na posição certa sem clique no meio.
                onMouseDown={ev => ev.preventDefault()}
                onClick={() => aoEscolher(e)}
                className="aspect-square rounded-lg text-xl leading-none flex items-center justify-center hover:bg-muted transition-colors"
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
