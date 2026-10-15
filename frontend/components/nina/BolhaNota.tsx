'use client'

import React from 'react'
import { Lock, UserRoundCog } from 'lucide-react'

import type { NotaInternaVista } from '@/modules/atendimento/services/nota-interna.service'
import { horaCurta } from './adapters/centralToNina'

// ============================================================================
// Nota interna no meio da conversa
//
// Silhueta diferente da mensagem, não só a cor: centralizada, com cadeado e
// "Só a equipe vê". Precisa ser impossível confundir com algo que o contato
// recebeu — é o mesmo cuidado do rascunho da Maia em BolhaMensagem.
// ============================================================================

interface Props {
  nota:      NotaInternaVista
  meuUserId: string | null
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Destaca "@Nome" de quem a nota mencionou. Só os nomes que a nota de fato
// menciona: um "@" solto no texto continua texto.
function comMencoes(texto: string, nota: NotaInternaVista, meuUserId: string | null): React.ReactNode {
  if (nota.mencionados.length === 0) return texto
  const porNome = new Map(nota.mencionados.map(p => [`@${p.nome}`, p.id]))
  const padrao = new RegExp(
    `(${[...porNome.keys()].sort((a, b) => b.length - a.length).map(escapar).join('|')})`,
    'g',
  )
  return texto.split(padrao).map((parte, i) => {
    const id = porNome.get(parte)
    if (!id) return <React.Fragment key={i}>{parte}</React.Fragment>
    const souEu = id === meuUserId
    return (
      <span
        key={i}
        className={`font-semibold rounded px-0.5 ${
          souEu
            ? 'bg-amber-300/60 text-amber-950 dark:bg-amber-400/30 dark:text-amber-50'
            : 'text-amber-800 dark:text-amber-200'
        }`}
      >
        {parte}
      </span>
    )
  })
}

export const BolhaNota: React.FC<Props> = ({ nota, meuUserId }) => (
  <div id={`nota-${nota.id}`} className="flex justify-center mt-4">
    <div className="w-full max-w-[92%] sm:max-w-[75%] rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2.5 shadow-sm dark:border-amber-500/40 dark:bg-amber-500/10">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-amber-800 dark:text-amber-300">
        <Lock className="w-3 h-3 shrink-0" aria-hidden />
        <span className="font-semibold uppercase tracking-wide">Nota interna</span>
        <span aria-hidden>·</span>
        <span className="font-medium">{nota.autor.nome}</span>
        <span className="ml-auto text-amber-700/70 dark:text-amber-300/70">{horaCurta(nota.created_at)}</span>
      </div>

      <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap break-words text-amber-950 dark:text-amber-50">
        {comMencoes(nota.body, nota, meuUserId)}
      </p>

      {nota.delegadaPara && (
        <p className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-amber-200/60 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-400/20 dark:text-amber-100">
          <UserRoundCog className="w-3 h-3" aria-hidden />
          Conversa delegada para {nota.delegadaPara.nome}
        </p>
      )}

      <p className="mt-1 text-[10px] text-amber-700/70 dark:text-amber-300/60">Só a equipe vê. O contato não recebe.</p>
    </div>
  </div>
)
