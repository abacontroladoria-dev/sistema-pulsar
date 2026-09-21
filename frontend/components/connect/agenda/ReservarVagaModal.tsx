'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { AlignLeft, CalendarDays, Loader2, MapPin, Search, User, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/nina/Button'
import type { Appointment, AppointmentType, VagaDisponivel } from '@/modules/atendimento/types/central.types'
import {
  AgendamentoApiError,
  criarAgendamentoAdministrativo,
  listarTerapiasComVaga,
  listarVagas,
  reservarVaga,
  type TerapiaComVaga,
} from '@/services/connect/agendamentos'
import { horaCurta, isoParaBR, TIPO_LABEL, TIPOS_ORDENADOS, terapiaCurta } from './tipos'

// ============================================================================
// ReservarVagaModal
//
// A diferença central em relação ao modal herdado do Nina: aqui NÃO existe
// input de horário livre. O modal antigo tinha <input type="time">, o que
// permitia agendar 03:17 de um domingo — horário que não existe na grade da
// clínica e que nenhum profissional atenderia.
//
// Aqui o operador escolhe uma VAGA que a grade do TiTa de fato oferece
// (status_agendamento = 'Livre') e que ainda não foi prometida a ninguém.
// A lista vem de /api/central/appointments/availability, a mesma fonte que o
// agente de WhatsApp consulta — as duas superfícies nunca oferecem horários
// diferentes.
//
// Há um segundo modo, "administrativo", para compromissos que não consomem vaga
// de grade (reunião com responsável, followup pós-alta). Esse aceita horário
// digitado justamente porque não há vaga para validar contra.
// ============================================================================

type Modo = 'vaga' | 'administrativo'

interface Props {
  dataInicial:  string          // 'YYYY-MM-DD' — dia clicado no calendário
  onFechar:     () => void
  onCriado:     (a: Appointment) => void
}

export default function ReservarVagaModal({ dataInicial, onFechar, onCriado }: Props) {
  const [modo, setModo] = useState<Modo>('vaga')

  // --- modo vaga ---
  const [terapias, setTerapias]         = useState<TerapiaComVaga[]>([])
  const [terapiaId, setTerapiaId]       = useState<number | null>(null)
  const [vagas, setVagas]               = useState<VagaDisponivel[]>([])
  const [vagaSelecionada, setVaga]      = useState<VagaDisponivel | null>(null)
  const [buscandoTerapias, setBTerapias] = useState(true)
  const [buscandoVagas, setBVagas]      = useState(false)
  const [filtroProfissional, setFiltro] = useState('')

  // --- comum ---
  const [tipo, setTipo]                 = useState<AppointmentType>('triagem')
  const [titulo, setTitulo]             = useState('')
  const [descricao, setDescricao]       = useState('')
  const [participantes, setParticipantes] = useState('')
  const [salvando, setSalvando]         = useState(false)

  // --- modo administrativo ---
  const [dataAdm, setDataAdm] = useState(dataInicial)
  const [horaAdm, setHoraAdm] = useState('09:00')
  const [duracaoAdm, setDuracaoAdm] = useState(60)

  // Terapias com vaga a partir do dia clicado. A janela default da RPC é
  // hoje..hoje+30; aqui começamos no dia escolhido para que o operador que
  // clicou em 18/08 veja o que existe de 18/08 em diante.
  useEffect(() => {
    let vivo = true
    setBTerapias(true)
    listarTerapiasComVaga(dataInicial)
      .then(t => { if (vivo) setTerapias(t) })
      .catch(err => { if (vivo) toast.error(mensagemDeErro(err, 'Não foi possível carregar as especialidades')) })
      .finally(() => { if (vivo) setBTerapias(false) })
    return () => { vivo = false }
  }, [dataInicial])

  // Vagas da terapia escolhida
  useEffect(() => {
    if (terapiaId == null) { setVagas([]); return }
    let vivo = true
    setBVagas(true)
    setVaga(null)
    listarVagas({ dataInicio: dataInicial, terapiaId })
      .then(v => { if (vivo) setVagas(v) })
      .catch(err => { if (vivo) toast.error(mensagemDeErro(err, 'Não foi possível carregar os horários')) })
      .finally(() => { if (vivo) setBVagas(false) })
    return () => { vivo = false }
  }, [terapiaId, dataInicial])

  // Agrupa as vagas por dia — uma lista corrida de 300 horários é ilegível.
  const vagasPorDia = useMemo(() => {
    const filtro = filtroProfissional.trim().toLowerCase()
    const alvo = filtro
      ? vagas.filter(v => (v.profissional_nome ?? '').toLowerCase().includes(filtro))
      : vagas

    const mapa = new Map<string, VagaDisponivel[]>()
    for (const v of alvo) {
      const lista = mapa.get(v.data)
      if (lista) lista.push(v)
      else mapa.set(v.data, [v])
    }
    return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [vagas, filtroProfissional])

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setSalvando(true)
    try {
      if (modo === 'vaga') {
        if (!vagaSelecionada) {
          toast.error('Escolha um horário disponível')
          return
        }
        const criado = await reservarVaga({
          profissionalId: vagaSelecionada.profissional_id,
          data:           vagaSelecionada.data,
          hora:           vagaSelecionada.hora_inicial,
          tipo,
          titulo:         titulo.trim() || undefined,
          descricao:      descricao.trim() || undefined,
          participantes:  listaParticipantes(participantes),
        })
        toast.success('Vaga reservada')
        onCriado(criado)
      } else {
        if (!titulo.trim()) {
          toast.error('Informe o título do compromisso')
          return
        }
        const criado = await criarAgendamentoAdministrativo({
          titulo:        titulo.trim(),
          data:          dataAdm,
          hora:          horaAdm,
          duracao:       duracaoAdm,
          tipo:          tipo === 'triagem' ? 'reuniao' : tipo,
          descricao:     descricao.trim() || undefined,
          participantes: listaParticipantes(participantes),
        })
        toast.success('Compromisso criado')
        onCriado(criado)
      }
      onFechar()
    } catch (err) {
      // Vaga tomada entre a listagem e o clique: recarrega os horários para
      // que o operador veja a lista já sem ela, em vez de tentar de novo no
      // mesmo slot.
      if (err instanceof AgendamentoApiError && err.vagaIndisponivel && terapiaId != null) {
        toast.error(err.message)
        setVaga(null)
        listarVagas({ dataInicio: dataInicial, terapiaId }).then(setVagas).catch(() => {})
      } else {
        toast.error(mensagemDeErro(err, 'Não foi possível salvar'))
      }
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Cabeçalho */}
        <div className="p-5 border-b border-border flex justify-between items-center shrink-0">
          <div>
            <h3 className="text-lg font-bold text-foreground">Novo agendamento</h3>
            <p className="text-xs text-muted-foreground/70 mt-0.5">
              A partir de {isoParaBR(dataInicial)}
            </p>
          </div>
          <button onClick={onFechar} className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Alternador de modo */}
        <div className="px-5 pt-4 shrink-0">
          <div className="inline-flex bg-background border border-border rounded-lg p-1">
            <button
              type="button"
              onClick={() => setModo('vaga')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                modo === 'vaga' ? 'bg-muted text-foreground' : 'text-muted-foreground/70 hover:text-muted-foreground'
              }`}
            >
              Vaga da grade
            </button>
            <button
              type="button"
              onClick={() => setModo('administrativo')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                modo === 'administrativo' ? 'bg-muted text-foreground' : 'text-muted-foreground/70 hover:text-muted-foreground'
              }`}
            >
              Administrativo
            </button>
          </div>
          <p className="text-xs text-muted-foreground/70 mt-2">
            {modo === 'vaga'
              ? 'Só aparecem horários que existem na grade e ainda não foram reservados.'
              : 'Compromisso que não ocupa vaga de terapia — reunião, follow-up, visita.'}
          </p>
        </div>

        <form onSubmit={salvar} className="flex-1 overflow-y-auto p-5 space-y-5">
          {modo === 'vaga' ? (
            <>
              {/* Especialidade */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-muted-foreground/70 tracking-wider">
                  Especialidade
                </label>
                {buscandoTerapias ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground/70 py-3">
                    <Loader2 className="w-4 h-4 animate-spin" /> Carregando especialidades com vaga…
                  </div>
                ) : terapias.length === 0 ? (
                  <div className="text-sm text-amber-700 dark:text-amber-200 bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
                    Nenhuma vaga livre na grade a partir de {isoParaBR(dataInicial)}.
                    A grade da TiTa costuma estar populada apenas algumas semanas à frente.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {terapias.map(t => (
                      <button
                        key={t.terapiaId}
                        type="button"
                        onClick={() => setTerapiaId(t.terapiaId)}
                        className={`text-left px-3 py-2 rounded-lg border transition-colors ${
                          terapiaId === t.terapiaId
                            ? 'bg-cyan-500/10 border-cyan-500/40 text-white'
                            : 'bg-background border-border text-muted-foreground hover:border-border'
                        }`}
                      >
                        <span className="block text-xs font-medium truncate">
                          {terapiaCurta(t.terapiaNome)}
                        </span>
                        <span className="block text-[10px] text-muted-foreground/70 tabular-nums">
                          {t.vagas} {t.vagas === 1 ? 'vaga' : 'vagas'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Horários */}
              {terapiaId != null && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-xs font-bold uppercase text-muted-foreground/70 tracking-wider">
                      Horário disponível
                    </label>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/70" />
                      <input
                        value={filtroProfissional}
                        onChange={e => setFiltro(e.target.value)}
                        placeholder="Filtrar profissional"
                        className="bg-background border border-border rounded-md pl-8 pr-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/70 focus:ring-1 focus:ring-cyan-500 outline-none w-44"
                      />
                    </div>
                  </div>

                  {buscandoVagas ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground/70 py-3">
                      <Loader2 className="w-4 h-4 animate-spin" /> Carregando horários…
                    </div>
                  ) : vagasPorDia.length === 0 ? (
                    <p className="text-sm text-muted-foreground/70 py-3">
                      Nenhum horário para este filtro.
                    </p>
                  ) : (
                    <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                      {vagasPorDia.map(([dia, lista]) => (
                        <div key={dia}>
                          <div className="flex items-center gap-2 mb-1.5">
                            <CalendarDays className="w-3.5 h-3.5 text-muted-foreground/70" />
                            <span className="text-xs font-semibold text-muted-foreground">
                              {isoParaBR(dia)}
                            </span>
                            <span className="text-[10px] text-muted-foreground/70">
                              {lista[0].dia_semana}
                            </span>
                          </div>
                          <div className="space-y-1">
                            {lista.map(v => {
                              const ativa =
                                vagaSelecionada?.profissional_id === v.profissional_id &&
                                vagaSelecionada?.data === v.data &&
                                vagaSelecionada?.hora_inicial === v.hora_inicial
                              return (
                                <button
                                  key={`${v.profissional_id}-${v.data}-${v.hora_inicial}`}
                                  type="button"
                                  onClick={() => setVaga(v)}
                                  className={`w-full text-left px-3 py-2 rounded-lg border transition-colors flex items-center gap-3 ${
                                    ativa
                                      ? 'bg-cyan-500/10 border-cyan-500/40'
                                      : 'bg-background border-border hover:border-input'
                                  }`}
                                >
                                  <span className="text-sm font-mono tabular-nums text-foreground shrink-0">
                                    {horaCurta(v.hora_inicial)}
                                    <span className="text-muted-foreground/70">–{horaCurta(v.hora_final)}</span>
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
                                      <User className="w-3 h-3 text-muted-foreground/70 shrink-0" />
                                      {v.profissional_nome}
                                    </span>
                                    <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70 truncate">
                                      <MapPin className="w-3 h-3 shrink-0" />
                                      {v.sala_nome ?? 'Sala não informada'}
                                    </span>
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            /* Modo administrativo: data e hora digitadas, sem vaga para validar */
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-muted-foreground/70 tracking-wider">Data</label>
                <input
                  type="date"
                  required
                  value={dataAdm}
                  onChange={e => setDataAdm(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:ring-1 focus:ring-cyan-500 outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-muted-foreground/70 tracking-wider">Hora</label>
                <input
                  type="time"
                  value={horaAdm}
                  onChange={e => setHoraAdm(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:ring-1 focus:ring-cyan-500 outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-muted-foreground/70 tracking-wider">Duração</label>
                <select
                  value={duracaoAdm}
                  onChange={e => setDuracaoAdm(parseInt(e.target.value, 10))}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:ring-1 focus:ring-cyan-500 outline-none appearance-none"
                >
                  <option value={30}>30 min</option>
                  <option value={40}>40 min</option>
                  <option value={60}>1 hora</option>
                  <option value={90}>1h 30min</option>
                  <option value={120}>2 horas</option>
                </select>
              </div>
            </div>
          )}

          {/* Campos comuns */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-muted-foreground/70 tracking-wider">Tipo</label>
            <select
              value={tipo}
              onChange={e => setTipo(e.target.value as AppointmentType)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:ring-1 focus:ring-cyan-500 outline-none appearance-none"
            >
              {TIPOS_ORDENADOS.map(t => (
                <option key={t} value={t}>{TIPO_LABEL[t]}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-muted-foreground/70 tracking-wider">
              Título {modo === 'vaga' && <span className="text-muted-foreground/70 normal-case font-normal">(opcional)</span>}
            </label>
            <input
              type="text"
              value={titulo}
              onChange={e => setTitulo(e.target.value)}
              placeholder={
                modo === 'vaga'
                  ? vagaSelecionada
                    ? `${terapiaCurta(vagaSelecionada.terapia_nome)} — ${vagaSelecionada.profissional_nome}`
                    : 'Derivado da vaga se ficar vazio'
                  : 'Ex: Reunião com responsável — devolutiva'
              }
              className="w-full bg-background border border-border rounded-lg p-3 text-sm text-foreground focus:ring-1 focus:ring-cyan-500 outline-none placeholder:text-muted-foreground/70"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-muted-foreground/70 tracking-wider">Observações</label>
            <div className="relative">
              <AlignLeft className="absolute left-3 top-3 w-4 h-4 text-muted-foreground/70" />
              <textarea
                value={descricao}
                onChange={e => setDescricao(e.target.value)}
                placeholder="Detalhes que a recepção precisa saber…"
                className="w-full bg-background border border-border rounded-lg pl-10 pr-3 py-3 text-sm text-foreground focus:ring-1 focus:ring-cyan-500 outline-none placeholder:text-muted-foreground/70 resize-none h-20"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-muted-foreground/70 tracking-wider">Participantes</label>
            <input
              type="text"
              value={participantes}
              onChange={e => setParticipantes(e.target.value)}
              placeholder="Ex: Maria Silva, João Souza"
              className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:ring-1 focus:ring-cyan-500 outline-none placeholder:text-muted-foreground/70"
            />
            <p className="text-xs text-muted-foreground/70">Separe os nomes por vírgula</p>
          </div>
        </form>

        {/* Rodapé */}
        <div className="p-5 border-t border-border flex items-center gap-3 shrink-0">
          {modo === 'vaga' && vagaSelecionada && (
            <p className="text-xs text-muted-foreground flex-1 min-w-0 truncate">
              {isoParaBR(vagaSelecionada.data)} às {horaCurta(vagaSelecionada.hora_inicial)} ·{' '}
              {vagaSelecionada.profissional_nome}
            </p>
          )}
          <div className="flex gap-3 ml-auto">
            <Button type="button" variant="outline" onClick={onFechar}>Cancelar</Button>
            <Button
              type="button"
              onClick={salvar}
              disabled={salvando || (modo === 'vaga' && !vagaSelecionada)}
            >
              {salvando ? 'Salvando…' : modo === 'vaga' ? 'Reservar vaga' : 'Criar compromisso'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function listaParticipantes(raw: string): string[] | undefined {
  const lista = raw.split(',').map(s => s.trim()).filter(Boolean)
  return lista.length ? lista : undefined
}

function mensagemDeErro(err: unknown, fallback: string): string {
  if (err instanceof AgendamentoApiError) return err.message
  return fallback
}
