'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bot, Calendar as CalendarIcon, ChevronLeft, ChevronRight,
  Columns, LayoutGrid, List, Loader2, Plus, RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/nina/Button'
import type { Appointment } from '@/modules/atendimento/types/central.types'
import { AgendamentoApiError, listarAgendamentos } from '@/services/connect/agendamentos'
import ReservarVagaModal from './ReservarVagaModal'
import DetalheAgendamento from './DetalheAgendamento'
import { dataParaISO, horaCurta, TIPO_CHIP, TIPO_LABEL, terapiaCurta } from './tipos'

// ============================================================================
// AgendaCentral
//
// Calendário dos agendamentos originados no canal de atendimento — os que a
// atendente virtual marca pelo WhatsApp e os que a recepção marca aqui.
//
// NÃO é a agenda completa da clínica: a agenda oficial vive no TiTa e chega
// espelhada em csv_grades_profissionais. Esta tela mostra o que ESTE canal
// prometeu, e usa a grade apenas como fonte de vagas ofertáveis.
//
// Diferenças em relação ao componente herdado do Nina, todas deliberadas:
//   - dados reais via /api/central/appointments (antes: api.fetchAppointments
//     era um stub que devolvia [] e o "Salvar" não gravava nada)
//   - datas manipuladas como 'YYYY-MM-DD'; o original usava toISOString(), que
//     em GMT-3 devolve o dia anterior antes das 21h
//   - sem subscription de realtime: ela apontava para public.appointments, que
//     não existe. central.appointments não está na publicação de realtime, então
//     a atualização aqui é por refetch (ao trocar de janela, ao voltar o foco e
//     depois de cada mutação)
// ============================================================================

type Visao = 'mes' | 'semana' | 'dia'

const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
// A clínica opera 08:00–12:00 e 13:00–17:40 em sessões de 40 min. A faixa
// exibida vai um pouco além nas duas pontas para caber compromisso
// administrativo fora do horário de atendimento.
const HORA_INICIO = 7
const HORA_FIM    = 19

export default function AgendaCentral() {
  const [referencia, setReferencia] = useState(() => new Date())
  const [visao, setVisao]           = useState<Visao>('mes')
  const [agendamentos, setAgend]    = useState<Appointment[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro]             = useState<string | null>(null)

  const [dataParaCriar, setDataParaCriar] = useState<string | null>(null)
  const [selecionado, setSelecionado]     = useState<Appointment | null>(null)

  const hojeISO = useMemo(() => dataParaISO(new Date()), [])

  // Janela de busca conforme a visão. Sempre um pouco maior que a exibida para
  // que navegar um mês para frente não pisque vazio antes do refetch.
  const janela = useMemo(() => calcularJanela(referencia, visao), [referencia, visao])

  const buscar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const dados = await listarAgendamentos({ from: janela.de, to: janela.ate })
      setAgend(dados)
    } catch (err) {
      const msg = err instanceof AgendamentoApiError ? err.message : 'Falha ao carregar agendamentos'
      setErro(msg)
      setAgend([])
    } finally {
      setCarregando(false)
    }
  }, [janela.de, janela.ate])

  useEffect(() => { void buscar() }, [buscar])

  // Sem realtime na tabela, o refetch ao voltar o foco é o que mantém a tela
  // honesta quando a atendente virtual marca algo enquanto a aba está aberta.
  useEffect(() => {
    function aoFocar() { void buscar() }
    window.addEventListener('focus', aoFocar)
    return () => window.removeEventListener('focus', aoFocar)
  }, [buscar])

  const porDia = useMemo(() => {
    const mapa = new Map<string, Appointment[]>()
    for (const a of agendamentos) {
      const lista = mapa.get(a.date)
      if (lista) lista.push(a)
      else mapa.set(a.date, [a])
    }
    for (const lista of mapa.values()) {
      lista.sort((x, y) => (x.time ?? '').localeCompare(y.time ?? ''))
    }
    return mapa
  }, [agendamentos])

  function navegar(direcao: number) {
    const nova = new Date(referencia)
    if (visao === 'mes')        nova.setMonth(nova.getMonth() + direcao)
    else if (visao === 'semana') nova.setDate(nova.getDate() + direcao * 7)
    else                         nova.setDate(nova.getDate() + direcao)
    setReferencia(nova)
  }

  function aoCriar(novo: Appointment) {
    // Insere localmente para resposta imediata e revalida contra o servidor.
    setAgend(prev => [...prev, novo])
    void buscar()
  }

  function aoAlterar(alterado: Appointment) {
    setAgend(prev => {
      // Cancelado sai da lista: a visão default do calendário não mostra
      // cancelados, senão o dia parece cheio com vagas que já foram liberadas.
      if (alterado.status === 'cancelled') return prev.filter(a => a.id !== alterado.id)
      return prev.map(a => (a.id === alterado.id ? alterado : a))
    })
    setSelecionado(sel => (sel && sel.id === alterado.id ? alterado : sel))
  }

  return (
    <div className="p-6 h-full flex flex-col bg-background text-foreground">
      {/* Cabeçalho */}
      <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between mb-5 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <CalendarIcon className="w-7 h-7 text-cyan-500" />
            Agendamentos
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            O que o atendimento — humano e virtual — marcou na grade da clínica.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full xl:w-auto">
          <div className="flex bg-card p-1 rounded-lg border border-border">
            <BotaoVisao ativa={visao === 'mes'}    onClick={() => setVisao('mes')}    icone={<LayoutGrid className="w-3.5 h-3.5" />} rotulo="Mês" />
            <BotaoVisao ativa={visao === 'semana'} onClick={() => setVisao('semana')} icone={<Columns className="w-3.5 h-3.5" />}    rotulo="Semana" />
            <BotaoVisao ativa={visao === 'dia'}    onClick={() => setVisao('dia')}    icone={<List className="w-3.5 h-3.5" />}       rotulo="Dia" />
          </div>

          <div className="flex items-center bg-card border border-border rounded-lg p-1">
            <button onClick={() => navegar(-1)} className="p-2 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground transition-colors" aria-label="Anterior">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => setReferencia(new Date())}
              className="flex flex-col items-center justify-center w-48 px-2 hover:bg-muted rounded-md py-1 transition-colors"
              title="Ir para hoje"
            >
              <span className="text-sm font-bold text-foreground capitalize">{rotuloPeriodo(referencia, visao)}</span>
            </button>
            <button onClick={() => navegar(1)} className="p-2 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground transition-colors" aria-label="Próximo">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="icon" onClick={() => void buscar()} title="Recarregar" disabled={carregando}>
              <RefreshCw className={`w-4 h-4 ${carregando ? 'animate-spin' : ''}`} />
            </Button>
            <Button onClick={() => setDataParaCriar(hojeISO)}>
              <Plus className="w-4 h-4 mr-2" />
              Agendar
            </Button>
          </div>
        </div>
      </div>

      {/* Área do calendário */}
      <div className="flex-1 bg-card border border-border rounded-xl overflow-hidden shadow-2xl flex flex-col min-h-0">
        {erro ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-rose-700 dark:text-rose-200 max-w-md">{erro}</p>
            <Button variant="outline" onClick={() => void buscar()}>Tentar de novo</Button>
          </div>
        ) : carregando && agendamentos.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
          </div>
        ) : visao === 'mes' ? (
          <VisaoMes
            referencia={referencia}
            porDia={porDia}
            hojeISO={hojeISO}
            onClicarDia={setDataParaCriar}
            onClicarAgendamento={setSelecionado}
          />
        ) : visao === 'semana' ? (
          <VisaoSemana
            referencia={referencia}
            porDia={porDia}
            hojeISO={hojeISO}
            onClicarDia={setDataParaCriar}
            onClicarAgendamento={setSelecionado}
          />
        ) : (
          <VisaoDia
            referencia={referencia}
            porDia={porDia}
            onClicarDia={setDataParaCriar}
            onClicarAgendamento={setSelecionado}
          />
        )}
      </div>

      {/* Rodapé com contagem — dá noção de volume sem abrir nada */}
      <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground/70">
        <span className="tabular-nums">
          {agendamentos.length} {agendamentos.length === 1 ? 'agendamento' : 'agendamentos'} na janela
        </span>
        {agendamentos.some(a => a.created_by_ai) && (
          <span className="flex items-center gap-1.5 text-cyan-400">
            <Bot className="w-3.5 h-3.5" />
            {agendamentos.filter(a => a.created_by_ai).length} pela atendente virtual
          </span>
        )}
      </div>

      {dataParaCriar && (
        <ReservarVagaModal
          dataInicial={dataParaCriar}
          onFechar={() => setDataParaCriar(null)}
          onCriado={aoCriar}
        />
      )}

      {selecionado && (
        <DetalheAgendamento
          agendamento={selecionado}
          onFechar={() => setSelecionado(null)}
          onAlterado={aoAlterar}
        />
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Visões
// ----------------------------------------------------------------------------

interface VisaoProps {
  referencia:          Date
  porDia:              Map<string, Appointment[]>
  hojeISO?:            string
  onClicarDia:         (iso: string) => void
  onClicarAgendamento: (a: Appointment) => void
}

function VisaoMes({ referencia, porDia, hojeISO, onClicarDia, onClicarAgendamento }: VisaoProps) {
  const ano = referencia.getFullYear()
  const mes = referencia.getMonth()
  const diasNoMes    = new Date(ano, mes + 1, 0).getDate()
  const primeiroDia  = new Date(ano, mes, 1).getDay()
  // 6 linhas x 7 colunas cobrem qualquer mês; o resto fica como célula vazia.
  const celulasVazias = 42 - (diasNoMes + primeiroDia)

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="grid grid-cols-7 border-b border-border bg-card shrink-0">
        {DIAS_CURTOS.map(d => (
          <div key={d} className="py-2.5 text-center text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 flex-1 auto-rows-fr overflow-y-auto">
        {Array.from({ length: primeiroDia }).map((_, i) => (
          <div key={`v-${i}`} className="border-b border-r border-border bg-background min-h-[96px]" />
        ))}

        {Array.from({ length: diasNoMes }).map((_, i) => {
          const dia = i + 1
          const iso = `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
          const doDia = porDia.get(iso) ?? []
          const ehHoje = iso === hojeISO

          return (
            <div
              key={iso}
              onClick={() => onClicarDia(iso)}
              className={`border-b border-r border-border p-2 min-h-[96px] cursor-pointer transition-colors hover:bg-muted group ${ehHoje ? 'bg-cyan-950/10' : ''}`}
            >
              <span className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1.5 tabular-nums ${
                ehHoje ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/30' : 'text-muted-foreground group-hover:text-foreground'
              }`}>
                {dia}
              </span>
              <div className="space-y-1">
                {doDia.slice(0, 3).map(a => (
                  <button
                    key={a.id}
                    onClick={e => { e.stopPropagation(); onClicarAgendamento(a) }}
                    className={`w-full text-left text-[10px] px-1.5 py-1 rounded border truncate font-medium transition-colors flex items-center gap-1 ${TIPO_CHIP[a.type]}`}
                  >
                    {a.created_by_ai && <Bot className="w-2.5 h-2.5 shrink-0" />}
                    <span className="tabular-nums">{horaCurta(a.time)}</span>
                    <span className="truncate">{a.profissional_nome ?? a.title}</span>
                  </button>
                ))}
                {doDia.length > 3 && (
                  <span className="block text-[10px] text-muted-foreground/70 pl-1.5">
                    +{doDia.length - 3} mais
                  </span>
                )}
              </div>
            </div>
          )
        })}

        {Array.from({ length: Math.max(0, celulasVazias) }).map((_, i) => (
          <div key={`r-${i}`} className="border-b border-r border-border bg-background" />
        ))}
      </div>
    </div>
  )
}

function VisaoSemana({ referencia, porDia, hojeISO, onClicarDia, onClicarAgendamento }: VisaoProps) {
  const inicio = inicioDaSemana(referencia)
  const dias = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(inicio)
    d.setDate(d.getDate() + i)
    return d
  })
  const horas = Array.from({ length: HORA_FIM - HORA_INICIO + 1 }).map((_, i) => i + HORA_INICIO)

  return (
    <div className="flex-1 overflow-auto bg-card">
      <div className="grid grid-cols-8 border-b border-border sticky top-0 bg-card z-10">
        <div className="p-3 text-[10px] font-medium text-muted-foreground/70 border-r border-border">GMT-3</div>
        {dias.map(d => {
          const iso = dataParaISO(d)
          const ehHoje = iso === hojeISO
          return (
            <div key={iso} className={`p-2 text-center border-r border-border ${ehHoje ? 'bg-cyan-950/20' : ''}`}>
              <div className={`text-[10px] uppercase font-semibold ${ehHoje ? 'text-cyan-400' : 'text-muted-foreground/70'}`}>
                {DIAS_CURTOS[d.getDay()]}
              </div>
              <div className={`text-lg font-bold tabular-nums ${ehHoje ? 'text-cyan-500' : 'text-muted-foreground'}`}>
                {d.getDate()}
              </div>
            </div>
          )
        })}
      </div>

      {horas.map(hora => (
        <div key={hora} className="grid grid-cols-8 min-h-[64px]">
          <div className="border-r border-b border-border p-2 text-[10px] text-muted-foreground/70 text-right tabular-nums">
            {String(hora).padStart(2, '0')}:00
          </div>
          {dias.map(d => {
            const iso = dataParaISO(d)
            const naHora = (porDia.get(iso) ?? []).filter(a => a.time && parseInt(a.time.slice(0, 2), 10) === hora)
            return (
              <div
                key={`${iso}-${hora}`}
                onClick={() => onClicarDia(iso)}
                className="border-r border-b border-border p-1 transition-colors hover:bg-muted cursor-pointer space-y-1"
              >
                {naHora.map(a => (
                  <button
                    key={a.id}
                    onClick={e => { e.stopPropagation(); onClicarAgendamento(a) }}
                    className={`w-full text-left p-1.5 rounded text-[10px] border transition-colors ${TIPO_CHIP[a.type]}`}
                  >
                    <span className="flex items-center gap-1 font-bold truncate">
                      {a.created_by_ai && <Bot className="w-2.5 h-2.5 shrink-0" />}
                      <span className="tabular-nums">{horaCurta(a.time)}</span>
                    </span>
                    <span className="block truncate opacity-90">{terapiaCurta(a.terapia_nome) || a.title}</span>
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function VisaoDia({ referencia, porDia, onClicarDia, onClicarAgendamento }: VisaoProps) {
  const iso = dataParaISO(referencia)
  const doDia = porDia.get(iso) ?? []
  const horas = Array.from({ length: HORA_FIM - HORA_INICIO + 1 }).map((_, i) => i + HORA_INICIO)

  return (
    <div className="flex-1 overflow-auto bg-card">
      <div className="p-4 border-b border-border bg-card sticky top-0 z-10 flex items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-foreground capitalize">
          {referencia.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </h3>
        <span className="text-xs text-muted-foreground/70 tabular-nums">
          {doDia.length} {doDia.length === 1 ? 'agendamento' : 'agendamentos'}
        </span>
      </div>

      <div className="p-4">
        {horas.map(hora => {
          const naHora = doDia.filter(a => a.time && parseInt(a.time.slice(0, 2), 10) === hora)
          return (
            <div key={hora} className="flex border-b border-border min-h-[72px] group hover:bg-card transition-colors">
              <div className="w-16 py-3 pr-4 text-right text-xs font-medium text-muted-foreground/70 border-r border-border tabular-nums shrink-0">
                {String(hora).padStart(2, '0')}:00
              </div>
              <div className="flex-1 p-2 space-y-2 cursor-pointer" onClick={() => onClicarDia(iso)}>
                {naHora.map(a => (
                  <button
                    key={a.id}
                    onClick={e => { e.stopPropagation(); onClicarAgendamento(a) }}
                    className={`w-full text-left p-3 rounded-lg border flex flex-wrap justify-between items-center gap-2 transition-colors ${TIPO_CHIP[a.type]}`}
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 font-bold text-sm">
                        {a.created_by_ai && <Bot className="w-3.5 h-3.5 shrink-0" />}
                        {a.title}
                      </span>
                      <span className="block text-xs opacity-80 mt-0.5 truncate">
                        {[a.profissional_nome, a.sala_nome].filter(Boolean).join(' · ') || 'Administrativo'}
                      </span>
                    </span>
                    <span className="text-right shrink-0">
                      <span className="block font-mono text-sm tabular-nums">{horaCurta(a.time)}</span>
                      <span className="block text-[10px] uppercase tracking-wider font-bold opacity-75">
                        {TIPO_LABEL[a.type]}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function BotaoVisao({ ativa, onClick, icone, rotulo }: {
  ativa: boolean; onClick: () => void; icone: React.ReactNode; rotulo: string
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-all ${
        ativa ? 'bg-muted text-foreground shadow-sm' : 'text-muted-foreground/70 hover:text-muted-foreground'
      }`}
    >
      {icone} {rotulo}
    </button>
  )
}

function inicioDaSemana(d: Date): Date {
  const inicio = new Date(d)
  inicio.setDate(inicio.getDate() - inicio.getDay())
  inicio.setHours(0, 0, 0, 0)
  return inicio
}

// Janela buscada no servidor. Margem de alguns dias em cada ponta para que a
// visão de mês já tenha os dias das semanas que invadem o mês vizinho.
function calcularJanela(referencia: Date, visao: Visao): { de: string; ate: string } {
  if (visao === 'mes') {
    const primeiro = new Date(referencia.getFullYear(), referencia.getMonth(), 1)
    const ultimo   = new Date(referencia.getFullYear(), referencia.getMonth() + 1, 0)
    primeiro.setDate(primeiro.getDate() - 7)
    ultimo.setDate(ultimo.getDate() + 7)
    return { de: dataParaISO(primeiro), ate: dataParaISO(ultimo) }
  }
  if (visao === 'semana') {
    const inicio = inicioDaSemana(referencia)
    const fim = new Date(inicio)
    fim.setDate(fim.getDate() + 6)
    return { de: dataParaISO(inicio), ate: dataParaISO(fim) }
  }
  const iso = dataParaISO(referencia)
  return { de: iso, ate: iso }
}

function rotuloPeriodo(referencia: Date, visao: Visao): string {
  if (visao === 'mes') {
    return referencia.toLocaleString('pt-BR', { month: 'long', year: 'numeric' })
  }
  if (visao === 'semana') {
    const inicio = inicioDaSemana(referencia)
    const fim = new Date(inicio)
    fim.setDate(fim.getDate() + 6)
    const mesInicio = inicio.toLocaleString('pt-BR', { month: 'short' })
    const mesFim    = fim.toLocaleString('pt-BR', { month: 'short' })
    return `${inicio.getDate()} ${mesInicio} – ${fim.getDate()} ${mesFim}`
  }
  return referencia.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'long' })
}
