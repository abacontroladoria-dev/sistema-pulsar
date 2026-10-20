'use client'

import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { ChevronDown, Loader2 } from 'lucide-react'
import type { Conversation } from '@/modules/atendimento/types/central.types'

// ============================================================================
// Status do atendimento — "como está o andamento desta conversa".
//
// Mapa para o enum central.conversation_status, sem coluna nova:
//   open → Aberto · assigned → Em atendimento · waiting → Aguardando
//   resolved → Resolvido · archived → Fechado
//
// Qualquer usuário do inbox troca (a RLS de conversations já é por organização,
// e resolve/archive/reopen já eram abertos a todos). Cada opção carrega a cor
// de uma faixa lateral + o título + uma linha de descrição, como no desenho
// aprovado; o gatilho repete só a cor e o título.
// ============================================================================

type Status = Conversation['status']

export const STATUS_ATENDIMENTO: {
  valor: Status; rotulo: string; descricao: string
  texto: string; faixa: string; ponto: string
}[] = [
  { valor: 'open',     rotulo: 'Aberto',         descricao: 'Uma nova conversa ou reiniciada.',
    texto: 'text-red-600 dark:text-red-400',         faixa: 'border-l-red-500',     ponto: 'bg-red-500' },
  { valor: 'assigned', rotulo: 'Em atendimento', descricao: 'Cliente está sendo atendido.',
    texto: 'text-indigo-600 dark:text-indigo-400',   faixa: 'border-l-indigo-500',  ponto: 'bg-indigo-500' },
  { valor: 'waiting',  rotulo: 'Aguardando',     descricao: 'Aguardando uma ação sua ou do cliente.',
    texto: 'text-amber-600 dark:text-amber-400',     faixa: 'border-l-amber-400',   ponto: 'bg-amber-400' },
  { valor: 'resolved', rotulo: 'Resolvido',      descricao: 'Cliente foi atendido e foi resolvido.',
    texto: 'text-emerald-600 dark:text-emerald-400', faixa: 'border-l-emerald-500', ponto: 'bg-emerald-500' },
  { valor: 'archived', rotulo: 'Fechado',        descricao: 'Cliente foi atendido sem conclusão.',
    texto: 'text-teal-700 dark:text-teal-300',       faixa: 'border-l-teal-700',    ponto: 'bg-teal-700 dark:bg-teal-300' },
]

interface Props {
  status:   Status | null
  aoTrocar: (novo: Status) => Promise<void>
}

export function StatusAtendimento({ status, aoTrocar }: Props) {
  const [aberto, setAberto]     = useState(false)
  const [salvando, setSalvando] = useState(false)

  // Sem o detalhe não há status a mostrar; um palpite piscaria ao chegar.
  if (!status) return null
  const atual = STATUS_ATENDIMENTO.find(s => s.valor === status)
  if (!atual) return null

  async function escolher(novo: Status) {
    if (novo === status) { setAberto(false); return }
    setSalvando(true)
    try {
      await aoTrocar(novo)
      setAberto(false)
    } catch {
      // O toast de erro já saiu em quem chamou; a lista fica aberta para tentar de novo.
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Popover.Root open={aberto} onOpenChange={setAberto}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title="Status do atendimento"
          aria-label={`Status do atendimento: ${atual.rotulo}`}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border border-border bg-muted hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 transition-colors"
        >
          <span aria-hidden className={`w-2 h-2 rounded-full ${atual.ponto}`} />
          <span className={atual.texto}>{atual.rotulo}</span>
          {salvando
            ? <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
            : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[min(18rem,calc(100vw-1.5rem))] rounded-lg border border-border bg-card shadow-lg overflow-hidden focus:outline-none"
        >
          <ul role="listbox" aria-label="Status do atendimento">
            {STATUS_ATENDIMENTO.map(s => (
              <li key={s.valor} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={s.valor === status}
                  disabled={salvando}
                  onClick={() => void escolher(s.valor)}
                  className={`w-full text-left border-l-4 ${s.faixa} px-3 py-2.5 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:cursor-wait ${
                    s.valor === status ? 'bg-muted' : ''
                  }`}
                >
                  <span className={`block text-sm font-bold ${s.texto}`}>{s.rotulo}</span>
                  <span className="block text-xs text-muted-foreground">{s.descricao}</span>
                </button>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
