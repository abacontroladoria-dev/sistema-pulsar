'use client'

import React, { useState } from 'react'
import { Bot, CalendarDays, Clock, Link2, MapPin, Stethoscope, User, UserCircle, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/nina/Button'
import type { Appointment } from '@/modules/atendimento/types/central.types'
import { AgendamentoApiError, cancelarAgendamento, atualizarAgendamento } from '@/services/connect/agendamentos'
import { horaCurta, horaFim, isoParaBR, STATUS_LABEL, TIPO_CHIP, TIPO_LABEL } from './tipos'

// ============================================================================
// DetalheAgendamento
//
// O painel herdado do Nina tinha um botão "Entrar na Sala de Reunião" apontando
// para /meeting/{id} — rota que não existe neste app (404). Numa clínica
// presencial o dado equivalente é onde a sessão acontece: profissional, sala,
// unidade. É isso que este painel mostra.
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

export default function DetalheAgendamento({ agendamento: a, onFechar, onAlterado }: Props) {
  const [ocupado, setOcupado] = useState(false)

  const ocupaVaga = a.profissional_id != null

  async function cancelar() {
    if (!confirm('Cancelar este agendamento? A vaga volta a ficar disponível na grade.')) return
    setOcupado(true)
    try {
      const atualizado = await cancelarAgendamento(a.id)
      toast.success('Agendamento cancelado — vaga liberada')
      onAlterado(atualizado)
      onFechar()
    } catch (err) {
      toast.error(err instanceof AgendamentoApiError ? err.message : 'Não foi possível cancelar')
    } finally {
      setOcupado(false)
    }
  }

  async function mudarStatus(status: Appointment['status']) {
    setOcupado(true)
    try {
      const atualizado = await atualizarAgendamento(a.id, { status })
      toast.success(`Marcado como ${STATUS_LABEL[status] ?? status}`)
      onAlterado(atualizado)
    } catch (err) {
      toast.error(err instanceof AgendamentoApiError ? err.message : 'Não foi possível atualizar')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Cabeçalho */}
        <div className="p-5 border-b border-border">
          <div className="flex justify-between items-start mb-3 gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase border ${TIPO_CHIP[a.type]}`}>
                {TIPO_LABEL[a.type]}
              </span>
              <span className="px-2 py-1 rounded text-[10px] font-bold uppercase border bg-muted text-muted-foreground border-border">
                {STATUS_LABEL[a.status] ?? a.status}
              </span>
              {a.created_by_ai && (
                <span className="px-2 py-1 rounded text-[10px] font-bold uppercase border bg-cyan-500/10 text-cyan-700 dark:text-cyan-200 border-cyan-500/30 flex items-center gap-1">
                  <Bot className="w-3 h-3" /> Atendente virtual
                </span>
              )}
            </div>
            <button onClick={onFechar} className="text-muted-foreground hover:text-foreground transition-colors shrink-0" aria-label="Fechar">
              <X className="w-5 h-5" />
            </button>
          </div>

          <h3 className="text-xl font-bold text-foreground mb-3">{a.title}</h3>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="w-4 h-4 text-cyan-500" />
              {isoParaBR(a.date)}
            </span>
            <span className="flex items-center gap-1.5 tabular-nums">
              <Clock className="w-4 h-4 text-cyan-500" />
              {horaCurta(a.time)}
              {a.duration ? ` – ${horaFim(a.time, a.duration)} (${a.duration}min)` : ''}
            </span>
          </div>
        </div>

        {/* Corpo */}
        <div className="p-5 space-y-5">
          {/* Onde e com quem — o que substitui a "sala de reunião" do CRM */}
          {ocupaVaga ? (
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase text-muted-foreground/70 tracking-wider">Sessão</h4>
              <div className="bg-background border border-border rounded-lg divide-y divide-border">
                <Linha icone={<User className="w-4 h-4 text-cyan-500" />} rotulo="Profissional" valor={a.profissional_nome} />
                <Linha icone={<Stethoscope className="w-4 h-4 text-cyan-500" />} rotulo="Terapia" valor={a.terapia_nome} />
                <Linha icone={<MapPin className="w-4 h-4 text-cyan-500" />} rotulo="Sala" valor={a.sala_nome} />
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/70 bg-background border border-border rounded-lg p-3">
              Compromisso administrativo — não ocupa vaga de terapia na grade.
            </p>
          )}

          {a.description && (
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase text-muted-foreground/70 tracking-wider">Observações</h4>
              <p className="text-sm text-muted-foreground leading-relaxed bg-background p-3 rounded-lg border border-border">
                {a.description}
              </p>
            </div>
          )}

          {a.attendees && a.attendees.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase text-muted-foreground/70 tracking-wider">Participantes</h4>
              <div className="flex flex-wrap gap-2">
                {a.attendees.map((p, i) => (
                  <span key={i} className="flex items-center gap-1.5 bg-muted px-2.5 py-1 rounded-full border border-border text-xs text-foreground">
                    <UserCircle className="w-3.5 h-3.5 text-muted-foreground" />
                    {p}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Vínculo com o TiTa
              tita_session_id só é preenchido depois que a sessão é criada lá.
              Enquanto for nulo, este agendamento é uma promessa nossa que ainda
              não existe na agenda oficial — a recepção precisa ver isso. */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase text-muted-foreground/70 tracking-wider">Registro no TiTa</h4>
            {a.tita_session_id != null ? (
              <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-200 bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
                <Link2 className="w-4 h-4 shrink-0" />
                Sessão {a.tita_session_id} vinculada
              </p>
            ) : (
              <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-200 bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
                <Link2 className="w-4 h-4 shrink-0" />
                Ainda não lançado no TiTa — precisa ser criado lá para valer na agenda oficial.
              </p>
            )}
          </div>

          {/* Ações */}
          {a.status !== 'cancelled' && (
            <div className="space-y-2 pt-1">
              <div className="grid grid-cols-2 gap-2">
                {a.status !== 'confirmed' && (
                  <Button type="button" variant="outline" disabled={ocupado} onClick={() => mudarStatus('confirmed')}>
                    Confirmar
                  </Button>
                )}
                {a.status !== 'completed' && (
                  <Button type="button" variant="outline" disabled={ocupado} onClick={() => mudarStatus('completed')}>
                    Marcar realizado
                  </Button>
                )}
                <Button type="button" variant="outline" disabled={ocupado} onClick={() => mudarStatus('no_show')}>
                  Registrar falta
                </Button>
                <Button type="button" variant="danger" disabled={ocupado} onClick={cancelar}>
                  Cancelar
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground/70">
                Cancelar devolve a vaga à grade. Registrar falta também libera o horário.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Linha({ icone, rotulo, valor }: { icone: React.ReactNode; rotulo: string; valor: string | null }) {
  return (
    <div className="flex items-center gap-3 p-3">
      <span className="shrink-0">{icone}</span>
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground/70 w-24 shrink-0">{rotulo}</span>
      <span className="text-sm text-foreground min-w-0 flex-1">{valor ?? '—'}</span>
    </div>
  )
}
