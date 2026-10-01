'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import {
  AlignLeft, Bot, Briefcase, Check, Clock, Link2, Loader2, MapPin,
  MessageCircle, Stethoscope, User, UserX, Users, XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/nina/Button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { Appointment } from '@/modules/atendimento/types/central.types'
import { AgendamentoApiError, cancelarAgendamento, atualizarAgendamento } from '@/services/connect/agendamentos'
import {
  dataPorExtenso, duracaoPorExtenso, DURACAO_PADRAO, horaCurta, horaFim,
  STATUS_LABEL, TIPO_COR, TIPO_LABEL,
} from './tipos'

// ============================================================================
// DetalheAgendamento
//
// O painel herdado do Nina tinha um botão "Entrar na Sala de Reunião" apontando
// para /meeting/{id} — rota que não existe neste app (404). Numa clínica
// presencial o dado equivalente é onde a sessão acontece: profissional, sala,
// unidade. É isso que este painel mostra.
//
// Forma no molde do detalhe da agenda do Integra Connect: título grande com o
// quadrado da cor, linhas com ícone e a barra de ações no rodapé.
//
// Cancelar não apaga: muda status para 'cancelled', o que devolve a vaga à
// grade (o predicado de uq_appointments_slot_ocupada exclui cancelados) e
// preserva o rastro de quem desmarcou.
// ============================================================================

interface Props {
  agendamento: Appointment
  onFechar:    () => void
  onAlterado:  (a: Appointment) => void
}

type Acao = 'cancelar' | Appointment['status']

const STATUS_SELO: Record<string, string> = {
  scheduled: 'bg-muted text-muted-foreground',
  confirmed: 'bg-sky-500/15 text-sky-800 dark:text-sky-200',
  completed: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200',
  no_show:   'bg-amber-500/15 text-amber-800 dark:text-amber-200',
  cancelled: 'bg-rose-500/15 text-rose-800 dark:text-rose-200',
}

export default function DetalheAgendamento({ agendamento: a, onFechar, onAlterado }: Props) {
  const [emAndamento, setEmAndamento] = useState<Acao | null>(null)
  // O modal abre por estado, sem DialogTrigger, e o radix não devolve o foco
  // nesse arranjo: guarda quem estava focado (o bloco clicado) para devolver.
  const [gatilho] = useState(() =>
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null,
  )

  const ocupaVaga = a.profissional_id != null
  const duracao = a.duration || DURACAO_PADRAO
  const fechado = a.status === 'completed' || a.status === 'no_show'

  async function cancelar() {
    if (!confirm('Cancelar este agendamento? A vaga volta a ficar disponível na grade.')) return
    setEmAndamento('cancelar')
    try {
      const atualizado = await cancelarAgendamento(a.id)
      toast.success('Agendamento cancelado — vaga liberada')
      onAlterado(atualizado)
      onFechar()
    } catch (err) {
      toast.error(err instanceof AgendamentoApiError ? err.message : 'Não foi possível cancelar')
    } finally {
      setEmAndamento(null)
    }
  }

  async function mudarStatus(status: Appointment['status']) {
    setEmAndamento(status)
    try {
      const atualizado = await atualizarAgendamento(a.id, { status })
      toast.success(`Marcado como ${STATUS_LABEL[status] ?? status}`)
      onAlterado(atualizado)
    } catch (err) {
      toast.error(err instanceof AgendamentoApiError ? err.message : 'Não foi possível atualizar')
    } finally {
      setEmAndamento(null)
    }
  }

  const ocupado = emAndamento !== null
  const girando = (acao: Acao, icone: React.ReactNode) =>
    emAndamento === acao ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" aria-hidden="true" /> : icone

  return (
    <Dialog open onOpenChange={aberto => { if (!aberto && !ocupado) onFechar() }}>
      <DialogContent
        className="sm:max-w-md p-0 gap-0 overflow-hidden bg-card"
        onCloseAutoFocus={e => {
          if (!gatilho?.isConnected) return
          e.preventDefault()
          gatilho.focus()
        }}
      >
        <div className="max-h-[85vh] overflow-y-auto">
          {/* Cabeçalho */}
          <div className="px-6 pt-6 pb-4 pr-12 flex items-start gap-4">
            <span className={cn('w-4 h-4 mt-1.5 rounded shrink-0', TIPO_COR[a.type].ponto)} aria-hidden="true" />
            <div className="min-w-0">
              <DialogTitle className={cn(
                'text-[22px] leading-tight font-normal text-foreground wrap-break-word',
                (fechado || a.status === 'cancelled') && 'line-through text-muted-foreground',
              )}>
                {a.title}
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm text-muted-foreground tabular-nums">
                {dataPorExtenso(a.date)} · {horaCurta(a.time)}
                {a.time ? ` – ${horaFim(a.time, duracao)}` : ''}
              </DialogDescription>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="px-2 h-6 rounded-full text-xs font-medium flex items-center bg-muted text-foreground">
                  {TIPO_LABEL[a.type]}
                </span>
                <span className={cn('px-2 h-6 rounded-full text-xs font-medium flex items-center', STATUS_SELO[a.status] ?? STATUS_SELO.scheduled)}>
                  {STATUS_LABEL[a.status] ?? a.status}
                </span>
                {a.created_by_ai && (
                  <span className="px-2 h-6 rounded-full text-xs font-medium flex items-center gap-1 bg-cyan-500/15 text-cyan-800 dark:text-cyan-200">
                    <Bot className="w-3 h-3" aria-hidden="true" /> Atendente virtual
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Corpo */}
          <div className="px-6 pb-5 space-y-4">
            <Linha icone={Clock}>{duracaoPorExtenso(duracao)}</Linha>

            {/* Onde e com quem — o que substitui a "sala de reunião" do CRM */}
            {ocupaVaga ? (
              <>
                <Linha icone={User}>
                  <span className="text-muted-foreground">Profissional: </span>
                  {a.profissional_nome ?? '—'}
                </Linha>
                <Linha icone={Stethoscope}>{a.terapia_nome ?? '—'}</Linha>
                {a.sala_nome && <Linha icone={MapPin}>{a.sala_nome}</Linha>}
              </>
            ) : (
              <Linha icone={Briefcase}>
                <span className="text-muted-foreground">
                  Compromisso administrativo — não ocupa vaga de terapia na grade.
                </span>
              </Linha>
            )}

            {a.conversation_id && (
              <Linha icone={MessageCircle}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Conversa no atendimento</span>
                  <Link
                    href={`/connect/inbox?c=${a.conversation_id}`}
                    className="shrink-0 inline-flex items-center h-8 px-3 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    Abrir conversa
                  </Link>
                </div>
              </Linha>
            )}

            {a.attendees && a.attendees.length > 0 && (
              <Linha icone={Users}>{a.attendees.join(', ')}</Linha>
            )}

            {a.description && (
              <Linha icone={AlignLeft}>
                <p className="whitespace-pre-wrap wrap-break-word">{a.description}</p>
              </Linha>
            )}

            {/* Vínculo com o TiTa
                tita_session_id só é preenchido depois que a sessão é criada lá.
                Enquanto for nulo, este agendamento é uma promessa nossa que ainda
                não existe na agenda oficial — a recepção precisa ver isso. */}
            <Linha icone={Link2}>
              {a.tita_session_id != null ? (
                <span className="text-emerald-700 dark:text-emerald-200">
                  Sessão {a.tita_session_id} vinculada no TiTa
                </span>
              ) : (
                <span className="text-amber-700 dark:text-amber-200">
                  Ainda não lançado no TiTa — precisa ser criado lá para valer na agenda oficial.
                </span>
              )}
            </Linha>
          </div>

          {/* Ações */}
          {a.status !== 'cancelled' && (
            <div className="px-4 py-3 flex flex-wrap items-center gap-1 border-t border-border bg-muted/40">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={ocupado}
                onClick={cancelar}
                title="Cancela e devolve a vaga à grade"
                className="hover:bg-red-500/10 hover:text-red-600"
              >
                {girando('cancelar', <XCircle className="w-4 h-4 mr-1.5" aria-hidden="true" />)}
                Cancelar
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={ocupado}
                onClick={() => mudarStatus('no_show')}
                title="Registrar falta também libera o horário"
              >
                {girando('no_show', <UserX className="w-4 h-4 mr-1.5" aria-hidden="true" />)}
                Falta
              </Button>
              <div className="ml-auto flex items-center gap-1">
                {a.status !== 'confirmed' && (
                  <Button type="button" variant="outline" size="sm" disabled={ocupado} onClick={() => mudarStatus('confirmed')}>
                    {girando('confirmed', null)}
                    Confirmar
                  </Button>
                )}
                {a.status !== 'completed' && (
                  <Button type="button" size="sm" disabled={ocupado} onClick={() => mudarStatus('completed')}>
                    {girando('completed', <Check className="w-4 h-4 mr-1.5" aria-hidden="true" />)}
                    Marcar realizado
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Linha({ icone: Icone, children }: { icone: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <Icone className="w-5 h-5 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="flex-1 min-w-0 text-[15px] text-foreground">{children}</div>
    </div>
  )
}
