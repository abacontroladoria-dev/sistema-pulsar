'use client'

import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Bot, ChevronDown, Loader2 } from 'lucide-react'
import type { Conversation } from '@/modules/atendimento/types/central.types'

// ============================================================================
// Status do atendimento — "como está o andamento desta conversa".
//
// Mapa para o enum central.conversation_status:
//   self_service → Autoatendimento · open → Aberto · assigned → Em atendimento
//   waiting → Aguardando · resolved → Resolvido · archived → Fechado
//
// A Maia muda o status sozinha (ConversationService + workers/status.worker.ts),
// mas a escolha daqui sempre vale: a equipe troca a qualquer momento, e a Maia
// não a desfaz até chegar mensagem nova. Autoatendimento liga a Maia na
// conversa; sair dele a desliga — o status não pode mentir sobre quem fala.
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
  { valor: 'self_service', rotulo: 'Autoatendimento', descricao: 'A Maia está conversando com o cliente.',
    texto: 'text-violet-600 dark:text-violet-400',   faixa: 'border-l-violet-500',  ponto: 'bg-violet-500' },
  { valor: 'open',     rotulo: 'Aberto',         descricao: 'Esperando alguém da equipe assumir.',
    texto: 'text-red-600 dark:text-red-400',         faixa: 'border-l-red-500',     ponto: 'bg-red-500' },
  // Azul, não anil: lado a lado com o violeta da Maia (Autoatendimento), o
  // anil não se distinguia na faixa da triagem.
  { valor: 'assigned', rotulo: 'Em atendimento', descricao: 'Cliente está sendo atendido.',
    texto: 'text-blue-600 dark:text-blue-400',       faixa: 'border-l-blue-500',    ponto: 'bg-blue-500' },
  { valor: 'waiting',  rotulo: 'Aguardando',     descricao: 'Aguardando uma ação sua ou do cliente.',
    texto: 'text-amber-600 dark:text-amber-400',     faixa: 'border-l-amber-400',   ponto: 'bg-amber-400' },
  { valor: 'resolved', rotulo: 'Resolvido',      descricao: 'Cliente foi atendido e foi resolvido.',
    texto: 'text-emerald-600 dark:text-emerald-400', faixa: 'border-l-emerald-500', ponto: 'bg-emerald-500' },
  { valor: 'archived', rotulo: 'Fechado',        descricao: 'Cliente foi atendido sem conclusão.',
    texto: 'text-teal-700 dark:text-teal-300',       faixa: 'border-l-teal-700',    ponto: 'bg-teal-700 dark:bg-teal-300' },
]

// O motivo só aparece quando a última palavra sobre o status foi da Maia: com
// a escolha da equipe mais nova que a leitura, mostrá-lo contradiria a tela.
export function motivoStatusMaia(
  c: Pick<Conversation, 'status_ia_motivo' | 'status_ia_em' | 'status_manual_em'> | null,
): string | null {
  if (!c?.status_ia_motivo || !c.status_ia_em) return null
  if (c.status_manual_em && c.status_manual_em >= c.status_ia_em) return null
  return c.status_ia_motivo
}

interface Props {
  status:   Status | null
  aoTrocar: (novo: Status) => Promise<void>
  // A Maia pode atender esta conversa? Número só de gente (Evolution sem
  // "Maia responde") não tem Autoatendimento a escolher.
  maiaDisponivel: boolean
  // Por que a Maia pôs a conversa no status atual. Null quando a última
  // palavra foi da equipe ou a Maia ainda não leu a conversa.
  motivoMaia?: string | null
}

export function StatusAtendimento({ status, aoTrocar, maiaDisponivel, motivoMaia }: Props) {
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
          {motivoMaia && (
            <p className="flex items-start gap-1.5 px-3 py-2 text-xs text-muted-foreground border-b border-border">
              <Bot aria-hidden className="w-3.5 h-3.5 mt-px shrink-0 text-violet-500" />
              <span><span className="font-semibold text-foreground">Maia:</span> {motivoMaia}</span>
            </p>
          )}
          <ul role="listbox" aria-label="Status do atendimento">
            {STATUS_ATENDIMENTO.map(s => {
              const indisponivel = s.valor === 'self_service' && !maiaDisponivel
              return (
                <li key={s.valor} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={s.valor === status}
                    disabled={salvando || indisponivel}
                    title={indisponivel ? 'A Maia não atende por este número.' : undefined}
                    onClick={() => void escolher(s.valor)}
                    className={`w-full text-left border-l-4 ${s.faixa} px-3 py-2.5 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:cursor-wait ${
                      s.valor === status ? 'bg-muted' : ''
                    } ${indisponivel ? 'opacity-50 disabled:cursor-not-allowed' : ''}`}
                  >
                    <span className={`block text-sm font-bold ${s.texto}`}>{s.rotulo}</span>
                    <span className="block text-xs text-muted-foreground">
                      {indisponivel ? 'A Maia não atende por este número.' : s.descricao}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
