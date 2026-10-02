'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot, Calendar as CalendarIcon, CalendarX2, ChevronLeft, ChevronRight,
  ListFilter, Loader2, Plus, RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/nina/Button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { MultiSearchCombobox } from '@/components/cronograma/ui/MultiSearchCombobox'
import { cn } from '@/lib/utils'
import type { Appointment } from '@/modules/atendimento/types/central.types'
import { AgendamentoApiError, listarAgendamentos } from '@/services/connect/agendamentos'
import ReservarVagaModal from './ReservarVagaModal'
import DetalheAgendamento from './DetalheAgendamento'
import {
  capitalizar, corDoTipo, dataParaISO, DURACAO_PADRAO, horaCurta, horaFim, inicioDaSemana,
  isoParaData, minutosDoDia, rotuloDoTipo, somarDias, TIPOS_ORDENADOS,
} from './tipos'

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
// Layout no molde da agenda do Integra Connect (/scheduling): coluna lateral
// com minicalendário, filtros e "Próximos"; à direita o calendário com a barra
// Hoje / ‹ › / período / Mês-Semana-Dia e, em semana e dia, grade horária com
// os blocos posicionados pela duração. Lá a cor e o filtro são por pessoa da
// equipe; aqui o agendamento não tem responsável, então a cor segue o tipo
// (vocabulário de tipos.ts) e o filtro é por tipo e por profissional.
//
// Diferenças em relação ao componente herdado do Nina, todas deliberadas:
//   - dados reais via /api/central/appointments (antes: api.fetchAppointments
//     era um stub que devolvia [] e o "Salvar" não gravava nada)
//   - datas manipuladas como 'YYYY-MM-DD'; o original usava toISOString(), que
//     em GMT-3 devolve o dia anterior antes das 21h
//   - sem subscription de realtime: ela apontava para public.appointments, que
//     não existe. central.appointments não está na publicação de realtime, então
//     a atualização aqui é por refetch (ao trocar de mês, ao voltar o foco e
//     depois de cada mutação)
// ============================================================================

type Visao = 'mes' | 'semana' | 'dia'

const VISOES: { valor: Visao; rotulo: string; tecla: string }[] = [
  { valor: 'mes',    rotulo: 'Mês',    tecla: 'M' },
  { valor: 'semana', rotulo: 'Semana', tecla: 'S' },
  { valor: 'dia',    rotulo: 'Dia',    tecla: 'D' },
]

const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

// 1 px por minuto: a sessão de 40 min ganha 40 px, o bastante para título e
// horário em duas linhas.
const ALTURA_HORA = 60
const HORAS = Array.from({ length: 24 }, (_, h) => h)

// Chave do filtro para compromisso administrativo (sem profissional).
const SEM_PROFISSIONAL = ''

// Na visão de mês, quantos itens cabem numa célula: altura da linha menos o
// número do dia, dividida pela altura de um item.
const ALTURA_NUMERO_DIA = 38
const ALTURA_ITEM_MES   = 24

const encerrado = (a: Appointment) => a.status === 'completed' || a.status === 'no_show'

// Abaixo de `sm` a célula do mês só cabe pontinhos, que não dá para tocar um a
// um. Ali o toque no dia abre o dia (onde os agendamentos aparecem e o "+"
// cria), em vez de abrir um agendamento novo por cima.
const telaLarga = () => typeof window === 'undefined' || window.matchMedia('(min-width: 640px)').matches

type EstadoCarga = 'carregando' | 'ok' | 'erro'

export default function AgendaCentral() {
  const [referencia, setReferencia] = useState(() => new Date())
  // No celular a grade de mês não cabe; a recepção abre direto no dia. Ler
  // `window` aqui é seguro só porque o ConnectShell monta a tela no cliente,
  // depois de conferir a sessão — renderizada no servidor, daria hidratação
  // divergente.
  const [visao, setVisao] = useState<Visao>(() =>
    typeof window !== 'undefined' && window.innerWidth < 640 ? 'dia' : 'mes',
  )
  const [agendamentos, setAgend]    = useState<Appointment[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro]             = useState<string | null>(null)
  // Da semana corrente em diante, independente do mês na tela: alimenta o
  // resumo do cabeçalho e "Próximos" mesmo quando se navega para o passado.
  // Tem estado de carga próprio: "0 agendamentos hoje" só pode aparecer quando
  // ESTA busca voltou com zero, não enquanto carrega nem quando falhou.
  const [aFrente, setAFrente]             = useState<Appointment[]>([])
  const [aFrenteEstado, setAFrenteEstado] = useState<EstadoCarga>('carregando')

  const [tiposOcultos, setTiposOcultos] = useState<Set<string>>(() => new Set())
  const [profsOcultos, setProfsOcultos] = useState<Set<string>>(() => new Set())

  const [dataParaCriar, setDataParaCriar] = useState<string | null>(null)
  const [selecionado, setSelecionado]     = useState<Appointment | null>(null)
  // Filtros e "Próximos" no celular, onde a coluna lateral não aparece.
  const [painelAberto, setPainelAberto]   = useState(false)

  // Número da busca mais recente de cada lista. Navegar rápido (setas, atalho
  // repetido, volta de foco) dispara buscas que podem responder fora de ordem:
  // sem isto, a resposta de novembro chegando depois da de dezembro punha os
  // agendamentos de novembro sob o título "Dezembro", e o `finally` de uma
  // busca antiga desligava o "carregando" de uma que ainda não tinha voltado.
  const geracaoMes     = useRef(0)
  const geracaoAFrente = useRef(0)

  const hojeISO = useMemo(() => dataParaISO(new Date()), [])

  // A janela é sempre o mês da referência com uma semana de folga em cada
  // ponta: cobre a semana que atravessa a virada do mês e os pontos do
  // minicalendário, e navegar dentro do mês não refaz a busca.
  const ano = referencia.getFullYear()
  const mes = referencia.getMonth()
  const janela = useMemo(() => ({
    de:  dataParaISO(new Date(ano, mes, 1 - 7)),
    ate: dataParaISO(new Date(ano, mes + 1, 7)),
  }), [ano, mes])

  const buscar = useCallback(async () => {
    const minha = ++geracaoMes.current
    setCarregando(true)
    setErro(null)
    try {
      const dados = await listarAgendamentos({ from: janela.de, to: janela.ate })
      if (minha !== geracaoMes.current) return
      setAgend(dados)
    } catch (err) {
      if (minha !== geracaoMes.current) return
      const msg = err instanceof AgendamentoApiError ? err.message : 'Falha ao carregar agendamentos'
      setErro(msg)
      setAgend([])
    } finally {
      if (minha === geracaoMes.current) setCarregando(false)
    }
  }, [janela.de, janela.ate])

  const buscarAFrente = useCallback(async () => {
    const minha = ++geracaoAFrente.current
    const hoje = new Date()
    // Num refetch (foco, recarregar) os números de antes continuam na tela até
    // a resposta chegar; só a primeira carga mostra "Carregando…".
    setAFrenteEstado(e => (e === 'ok' ? 'ok' : 'carregando'))
    try {
      const dados = await listarAgendamentos({
        from: dataParaISO(inicioDaSemana(hoje)),
        to:   dataParaISO(somarDias(hoje, 60)),
      })
      if (minha !== geracaoAFrente.current) return
      setAFrente(dados)
      setAFrenteEstado('ok')
    } catch {
      if (minha !== geracaoAFrente.current) return
      // A falha aparece como falha no cabeçalho e em "Próximos" — com lista
      // vazia e nenhum aviso, a tela afirmaria "0 agendamentos hoje".
      setAFrente([])
      setAFrenteEstado('erro')
    }
  }, [])

  useEffect(() => { void buscar() }, [buscar])
  useEffect(() => { void buscarAFrente() }, [buscarAFrente])

  // Sem realtime na tabela, o refetch ao voltar o foco é o que mantém a tela
  // honesta quando a atendente virtual marca algo enquanto a aba está aberta.
  useEffect(() => {
    function aoFocar() { void buscar(); void buscarAFrente() }
    window.addEventListener('focus', aoFocar)
    return () => window.removeEventListener('focus', aoFocar)
  }, [buscar, buscarAFrente])

  const visivel = useCallback(
    (a: Appointment) => !tiposOcultos.has(a.type) && !profsOcultos.has(a.profissional_nome ?? SEM_PROFISSIONAL),
    [tiposOcultos, profsOcultos],
  )

  const porDia = useMemo(() => {
    const mapa = new Map<string, Appointment[]>()
    for (const a of agendamentos) {
      if (!visivel(a)) continue
      const lista = mapa.get(a.date)
      if (lista) lista.push(a)
      else mapa.set(a.date, [a])
    }
    for (const lista of mapa.values()) {
      lista.sort((x, y) => (x.time ?? '').localeCompare(y.time ?? ''))
    }
    return mapa
  }, [agendamentos, visivel])

  const doDia = useCallback((iso: string) => porDia.get(iso) ?? [], [porDia])

  // Os filtros listam o que existe nas DUAS listas que eles filtram — o mês
  // carregado e "Próximos" — e também tudo o que está oculto agora. Sem esse
  // último, desmarcar "Triagem" em outubro e ir para agosto (sem triagens)
  // tirava a opção da lista e "Próximos" seguia escondendo toda triagem, sem
  // controle nenhum na tela para desfazer.
  const tiposPresentes = useMemo(() => {
    const presentes = new Set<string>([...agendamentos, ...aFrente].map(a => a.type))
    for (const t of tiposOcultos) presentes.add(t)
    const conhecidos: string[] = TIPOS_ORDENADOS.filter(t => presentes.has(t))
    const novos = [...presentes].filter(t => !conhecidos.includes(t)).sort()
    return [...conhecidos, ...novos]
  }, [agendamentos, aFrente, tiposOcultos])

  const profsPresentes = useMemo(() => {
    const nomes = new Set([...agendamentos, ...aFrente].map(a => a.profissional_nome ?? SEM_PROFISSIONAL))
    for (const p of profsOcultos) nomes.add(p)
    const lista = [...nomes].filter(n => n !== SEM_PROFISSIONAL).sort((x, y) => x.localeCompare(y, 'pt-BR'))
    return nomes.has(SEM_PROFISSIONAL) ? [...lista, SEM_PROFISSIONAL] : lista
  }, [agendamentos, aFrente, profsOcultos])

  const resumo = useMemo(() => {
    const semana = new Set(Array.from({ length: 7 }, (_, i) => dataParaISO(somarDias(inicioDaSemana(new Date()), i))))
    let hoje = 0
    let naSemana = 0
    for (const a of aFrente) {
      if (a.date === hojeISO) hoje++
      if (semana.has(a.date)) naSemana++
    }
    return { hoje, naSemana }
  }, [aFrente, hojeISO])

  const proximos = useMemo(() => {
    const agora = new Date()
    const minutoAgora = agora.getHours() * 60 + agora.getMinutes()
    return aFrente
      .filter(a => (a.status === 'scheduled' || a.status === 'confirmed') && visivel(a))
      // Compromisso de hoje sem horário vale o dia inteiro: lido como 00:00,
      // ele saía de "Próximos" às 00:40 ainda marcado para hoje.
      .filter(a => a.date > hojeISO || (a.date === hojeISO && (!a.time || minutosDoDia(a.time) + (a.duration || DURACAO_PADRAO) > minutoAgora)))
      .sort((x, y) => x.date.localeCompare(y.date) || (x.time ?? '').localeCompare(y.time ?? ''))
      .slice(0, 5)
  }, [aFrente, visivel, hojeISO])

  const navegar = useCallback((direcao: number) => {
    setReferencia(r =>
      visao === 'mes'
        ? new Date(r.getFullYear(), r.getMonth() + direcao, 1)
        : somarDias(r, direcao * (visao === 'semana' ? 7 : 1)),
    )
  }, [visao])

  function abrirDia(d: Date) {
    setReferencia(d)
    setVisao('dia')
  }

  // Na visão de mês "agendar" parte de hoje; nas outras, do dia em foco.
  const novoAgendamento = useCallback(() => {
    setDataParaCriar(visao === 'mes' ? hojeISO : dataParaISO(referencia))
  }, [visao, hojeISO, referencia])

  const modalAberto = dataParaCriar !== null || selecionado !== null || painelAberto

  // Atalhos da referência: T hoje, M/S/D visão, N novo, ←/→ navega.
  //
  // Tecla segurada (`e.repeat`) não conta: → segurado por um segundo disparava
  // umas 20 buscas de mês seguidas.
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (modalAberto || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      const alvo = e.target as HTMLElement | null
      if (alvo?.closest('input, textarea, select, [contenteditable="true"]')) return
      const tecla = e.key.toLowerCase()
      if (tecla === 't') setReferencia(new Date())
      else if (tecla === 'm') setVisao('mes')
      else if (tecla === 's') setVisao('semana')
      else if (tecla === 'd') setVisao('dia')
      else if (tecla === 'n') { e.preventDefault(); novoAgendamento() }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // Dentro do seletor de visão as setas são dele (padrão radiogroup:
        // trocam Mês/Semana/Dia), não da navegação de período.
        if (alvo?.closest('[role="radiogroup"]')) return
        navegar(e.key === 'ArrowLeft' ? -1 : 1)
      }
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [modalAberto, navegar, novoAgendamento])

  // Setas no seletor de visão, como o padrão radiogroup promete: movem a
  // seleção e o foco juntos, dando a volta nas pontas.
  function aoTeclarVisao(e: React.KeyboardEvent<HTMLDivElement>) {
    const passo =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1
          : 0
    if (!passo) return
    e.preventDefault()
    const atual = VISOES.findIndex(v => v.valor === visao)
    const proxima = VISOES[(atual + passo + VISOES.length) % VISOES.length]
    setVisao(proxima.valor)
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-visao="${proxima.valor}"]`)?.focus()
  }

  function aoCriar(novo: Appointment) {
    // Insere localmente para resposta imediata e revalida contra o servidor.
    setAgend(prev => [...prev, novo])
    void buscar()
    void buscarAFrente()
  }

  function aoAlterar(alterado: Appointment) {
    // Cancelado sai da lista: a visão default do calendário não mostra
    // cancelados, senão o dia parece cheio com vagas que já foram liberadas.
    const aplicar = (prev: Appointment[]) =>
      alterado.status === 'cancelled'
        ? prev.filter(a => a.id !== alterado.id)
        : prev.map(a => (a.id === alterado.id ? alterado : a))
    setAgend(aplicar)
    setAFrente(aplicar)
    setSelecionado(sel => (sel && sel.id === alterado.id ? alterado : sel))
  }

  const diasVisiveis = useMemo(
    () => (visao === 'dia' ? [referencia] : Array.from({ length: 7 }, (_, i) => somarDias(inicioDaSemana(referencia), i))),
    [visao, referencia],
  )

  return (
    <div className="h-full flex flex-col gap-4 p-4 sm:p-6 bg-background text-foreground min-h-0">
      {/* Cabeçalho */}
      <div>
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <CalendarIcon className="w-7 h-7 text-cyan-500" aria-hidden="true" />
          Agendamentos
        </h2>
        <p className="text-muted-foreground text-sm mt-1 tabular-nums">
          {aFrenteEstado === 'carregando'
            ? 'Carregando…'
            : aFrenteEstado === 'erro'
              ? 'Não foi possível carregar o resumo de hoje e da semana.'
              : `${resumo.hoje} ${resumo.hoje === 1 ? 'agendamento' : 'agendamentos'} hoje · ${resumo.naSemana} nesta semana`}
        </p>
      </div>

      <div className="flex-1 min-h-0 flex gap-3">
        {/* Coluna lateral — só no desktop */}
        <aside className="hidden lg:flex w-68 shrink-0 flex-col gap-3 min-h-0 overflow-y-auto">
          <Button size="lg" onClick={novoAgendamento} className="self-start shrink-0 px-6" title="Novo agendamento (N)">
            <Plus className="w-5 h-5 mr-2" aria-hidden="true" />
            Agendar
          </Button>

          <div className="rounded-lg bg-card border border-border p-3">
            <MiniCalendario
              selecionada={referencia}
              ocupados={porDia}
              hojeISO={hojeISO}
              onSelecionar={d => { setReferencia(d); if (visao === 'mes') setVisao('dia') }}
            />
          </div>

          <FiltrosEProximos
            tipos={tiposPresentes}
            profissionais={profsPresentes}
            tiposOcultos={tiposOcultos}
            profsOcultos={profsOcultos}
            onTiposOcultos={setTiposOcultos}
            onProfsOcultos={setProfsOcultos}
            proximos={proximos}
            estadoProximos={aFrenteEstado}
            onTentarDeNovo={() => void buscarAFrente()}
            hojeISO={hojeISO}
            onAbrir={setSelecionado}
            portal
          />
        </aside>

        {/* Calendário */}
        <section
          aria-label="Calendário"
          className="flex-1 min-w-0 min-h-0 rounded-lg bg-card border border-border overflow-hidden flex flex-col"
        >
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-muted/40">
            <Button variant="outline" size="sm" onClick={() => setReferencia(new Date())} title="Hoje (T)">
              Hoje
            </Button>
            <div className="flex">
              <BotaoRedondo onClick={() => navegar(-1)} rotulo="Anterior" atalho="←">
                <ChevronLeft className="w-5 h-5" aria-hidden="true" />
              </BotaoRedondo>
              <BotaoRedondo onClick={() => navegar(1)} rotulo="Próximo" atalho="→">
                <ChevronRight className="w-5 h-5" aria-hidden="true" />
              </BotaoRedondo>
            </div>
            <h3 className="text-lg text-foreground truncate min-w-0 flex-1" aria-live="polite">
              {visao === 'dia' ? (
                <>
                  <span className="sm:hidden">{capitalizar(referencia.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, ''))}</span>
                  <span className="hidden sm:inline">{rotuloPeriodo(referencia, visao)}</span>
                </>
              ) : rotuloPeriodo(referencia, visao)}
            </h3>
            <BotaoRedondo onClick={() => { void buscar(); void buscarAFrente() }} rotulo="Recarregar" desabilitado={carregando}>
              <RefreshCw className={cn('w-4 h-4', carregando && 'animate-spin')} aria-hidden="true" />
            </BotaoRedondo>
            <div
              role="radiogroup"
              aria-label="Visualização"
              onKeyDown={aoTeclarVisao}
              className="flex p-0.5 rounded-full bg-muted border border-border"
            >
              {VISOES.map(v => (
                <button
                  key={v.valor}
                  type="button"
                  role="radio"
                  aria-checked={visao === v.valor}
                  // Foco itinerante: Tab entra no grupo pela opção marcada e as
                  // setas andam dentro dele.
                  tabIndex={visao === v.valor ? 0 : -1}
                  data-visao={v.valor}
                  onClick={() => setVisao(v.valor)}
                  title={`${v.rotulo} (${v.tecla})`}
                  className={cn(
                    'px-3 sm:px-4 h-8 rounded-full text-sm transition-colors',
                    visao === v.valor
                      ? 'bg-card text-foreground font-medium shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {v.rotulo}
                </button>
              ))}
            </div>
            <BotaoRedondo onClick={() => setPainelAberto(true)} rotulo="Filtros e próximos" classe="lg:hidden">
              <ListFilter className="w-4 h-4" aria-hidden="true" />
            </BotaoRedondo>
            <Button size="sm" onClick={novoAgendamento} className="lg:hidden" aria-label="Novo agendamento">
              <Plus className="w-4 h-4 sm:mr-1" aria-hidden="true" />
              <span className="hidden sm:inline">Agendar</span>
            </Button>
          </div>

          {erro ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <CalendarX2 className="w-10 h-10 text-muted-foreground/40" aria-hidden="true" />
              <p className="text-base text-foreground">Não foi possível carregar a agenda</p>
              <p className="text-sm text-muted-foreground max-w-md">{erro}</p>
              <Button variant="outline" onClick={() => void buscar()}>Tentar de novo</Button>
            </div>
          ) : carregando && agendamentos.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-cyan-500" aria-hidden="true" />
              <span className="text-sm text-muted-foreground">Carregando agenda…</span>
            </div>
          ) : visao === 'mes' ? (
            <VisaoMes
              referencia={referencia}
              doDia={doDia}
              hojeISO={hojeISO}
              onCriar={setDataParaCriar}
              onAbrirDia={abrirDia}
              onAbrir={setSelecionado}
            />
          ) : (
            <GradeHoraria
              dias={diasVisiveis}
              doDia={doDia}
              onCriar={setDataParaCriar}
              onAbrirDia={abrirDia}
              onAbrir={setSelecionado}
            />
          )}
        </section>
      </div>

      {/* Celular e tablet: a coluna lateral vira painel. Os filtros abrem
          dentro do Dialog (portal={false}), então o Esc da busca fecha só a
          lista, e o DialogContent não leva overflow-hidden — ver AGENTS.md. */}
      <Dialog open={painelAberto} onOpenChange={setPainelAberto}>
        <DialogContent
          className="sm:max-w-sm p-0 gap-0 bg-card"
          onEscapeKeyDown={e => {
            if ((e.target as HTMLElement | null)?.closest?.('[data-multisearch-aberto]')) e.preventDefault()
          }}
        >
          <div className="px-4 pt-5 pb-2 pr-12">
            <DialogTitle className="text-lg font-medium text-foreground">Filtros e próximos</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              O que aparece no calendário e o que vem pela frente.
            </DialogDescription>
          </div>
          <div className="max-h-[75vh] overflow-y-auto px-4 pb-4 flex flex-col gap-3">
            <FiltrosEProximos
              tipos={tiposPresentes}
              profissionais={profsPresentes}
              tiposOcultos={tiposOcultos}
              profsOcultos={profsOcultos}
              onTiposOcultos={setTiposOcultos}
              onProfsOcultos={setProfsOcultos}
              proximos={proximos}
              estadoProximos={aFrenteEstado}
              onTentarDeNovo={() => void buscarAFrente()}
              hojeISO={hojeISO}
              onAbrir={a => { setPainelAberto(false); setSelecionado(a) }}
              portal={false}
            />
          </div>
        </DialogContent>
      </Dialog>

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
// Coluna lateral
// ----------------------------------------------------------------------------

function MiniCalendario({ selecionada, ocupados, hojeISO, onSelecionar }: {
  selecionada:  Date
  ocupados:     Map<string, Appointment[]>
  hojeISO:      string
  onSelecionar: (d: Date) => void
}) {
  const selISO = dataParaISO(selecionada)
  const [mesVisto, setMesVisto] = useState(() => new Date(selecionada.getFullYear(), selecionada.getMonth(), 1))
  // Volta ao mês da data em foco sempre que ela muda por fora (Hoje, setas,
  // atalho). Ajuste durante o render, não em efeito — padrão da doc do React.
  const [selAnterior, setSelAnterior] = useState(selISO)
  if (selAnterior !== selISO) {
    setSelAnterior(selISO)
    setMesVisto(new Date(selecionada.getFullYear(), selecionada.getMonth(), 1))
  }

  const mudarMes = (d: number) => setMesVisto(m => new Date(m.getFullYear(), m.getMonth() + d, 1))

  return (
    <div>
      <div className="flex items-center justify-between pl-2 mb-1">
        <span className="text-sm font-medium text-foreground">
          {capitalizar(mesVisto.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }))}
        </span>
        <div className="flex">
          <BotaoRedondo onClick={() => mudarMes(-1)} rotulo="Mês anterior" pequeno>
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </BotaoRedondo>
          <BotaoRedondo onClick={() => mudarMes(1)} rotulo="Próximo mês" pequeno>
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </BotaoRedondo>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center">
        {DIAS_CURTOS.map(d => (
          <span key={d} className="h-7 flex items-center justify-center text-[11px] text-muted-foreground">
            {d.charAt(0)}
          </span>
        ))}
        {celulasDoMes(mesVisto).map(d => {
          const iso = dataParaISO(d)
          const foraDoMes = d.getMonth() !== mesVisto.getMonth()
          const ehHoje = iso === hojeISO
          const ehSelecionado = iso === selISO
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelecionar(d)}
              aria-label={d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
              aria-current={ehHoje ? 'date' : undefined}
              className={cn(
                'relative mx-auto w-8 h-8 rounded-full text-xs tabular-nums flex items-center justify-center transition-colors',
                ehHoje
                  ? 'bg-cyan-600 text-white font-semibold'
                  : ehSelecionado
                    ? 'bg-cyan-500/15 text-cyan-900 dark:text-cyan-100 font-semibold'
                    : foraDoMes
                      ? 'text-muted-foreground/60 hover:bg-muted'
                      : 'text-foreground hover:bg-muted',
              )}
            >
              {d.getDate()}
              {ocupados.has(iso) && !ehHoje && (
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-cyan-600" aria-hidden="true" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Filtros + "Próximos": o miolo da coluna lateral no desktop e do painel no
// celular. `portal` é false dentro do Dialog do celular (ver
// MultiSearchCombobox: com portal, a lista abre mas não aceita clique ali).
function FiltrosEProximos({
  tipos, profissionais, tiposOcultos, profsOcultos, onTiposOcultos, onProfsOcultos,
  proximos, estadoProximos, onTentarDeNovo, hojeISO, onAbrir, portal,
}: {
  tipos:          string[]
  profissionais:  string[]
  tiposOcultos:   Set<string>
  profsOcultos:   Set<string>
  onTiposOcultos: (s: Set<string>) => void
  onProfsOcultos: (s: Set<string>) => void
  proximos:       Appointment[]
  estadoProximos: EstadoCarga
  onTentarDeNovo: () => void
  hojeISO:        string
  onAbrir:        (a: Appointment) => void
  portal:         boolean
}) {
  return (
    <>
      {tipos.length > 0 && (
        <FiltroMulti
          titulo="Tipos"
          itens={tipos.map(t => ({ chave: t, rotulo: rotuloDoTipo(t) }))}
          ocultos={tiposOcultos}
          onOcultos={onTiposOcultos}
          nomePlural="tipos"
          vazio="Nenhum tipo marcado"
          portal={portal}
          legenda={tipos.filter(t => !tiposOcultos.has(t))}
        />
      )}

      {profissionais.length > 0 && (
        <FiltroMulti
          titulo="Profissionais"
          itens={profissionais.map(p => ({ chave: p, rotulo: p || 'Administrativo' }))}
          ocultos={profsOcultos}
          onOcultos={onProfsOcultos}
          nomePlural="profissionais"
          vazio="Nenhum profissional marcado"
          portal={portal}
        />
      )}

      <div className="rounded-lg bg-card border border-border py-3">
        <h3 className="px-4 pb-1 text-sm font-medium text-cyan-700 dark:text-cyan-300">Próximos</h3>
        {estadoProximos === 'carregando' ? (
          <p className="px-4 py-2 text-sm text-muted-foreground">Carregando…</p>
        ) : estadoProximos === 'erro' ? (
          <div className="px-4 py-2 flex flex-col items-start gap-2">
            <p className="text-sm text-muted-foreground">Não foi possível carregar os próximos agendamentos.</p>
            <Button variant="outline" size="sm" onClick={onTentarDeNovo}>Tentar de novo</Button>
          </div>
        ) : proximos.length === 0 ? (
          <p className="px-4 py-2 text-sm text-muted-foreground">Nada marcado daqui para frente.</p>
        ) : (
          <ul>
            {proximos.map(a => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => onAbrir(a)}
                  className="w-full flex items-start gap-3 px-4 py-2 text-left hover:bg-muted transition-colors"
                >
                  <span className={cn('w-2 h-2 mt-1.5 rounded-full shrink-0', corDoTipo(a.type).ponto)} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-sm text-foreground truncate">
                      {a.title}
                      {a.created_by_ai && (
                        <Bot className="inline w-3 h-3 ml-1 -mt-0.5 text-muted-foreground" aria-label="Marcado pela atendente virtual" />
                      )}
                    </span>
                    <span className="block text-xs text-muted-foreground tabular-nums">
                      {quandoCurto(a.date, hojeISO)}{a.time ? ` · ${horaCurta(a.time)}` : ' · sem horário'} · {rotuloDoTipo(a.type)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

// Filtro de várias seleções com o componente padrão (AGENTS.md: nada de lista
// de caixas feita à mão). A agenda guarda o que está OCULTO — o padrão é ver
// tudo —, e o combobox trabalha com o que está marcado: a conversão é aqui.
//
// O combobox só mostra nomes, então a cor de cada tipo, que antes vinha no
// quadradinho da lista, passou para a legenda embaixo.
function FiltroMulti({ titulo, itens, ocultos, onOcultos, nomePlural, vazio, portal, legenda }: {
  titulo:     string
  itens:      { chave: string; rotulo: string }[]
  ocultos:    Set<string>
  onOcultos:  (s: Set<string>) => void
  nomePlural: string
  vazio:      string
  portal:     boolean
  legenda?:   string[]
}) {
  const marcados = useMemo(
    () => new Set(itens.map(i => i.chave).filter(c => !ocultos.has(c))),
    [itens, ocultos],
  )

  function alternar(chave: string) {
    const novo = new Set(ocultos)
    if (novo.has(chave)) novo.delete(chave)
    else novo.add(chave)
    onOcultos(novo)
  }

  return (
    <div className="rounded-lg bg-card border border-border px-4 py-3 flex flex-col gap-2">
      <h3 className="text-sm font-medium text-cyan-700 dark:text-cyan-300">{titulo}</h3>
      <MultiSearchCombobox<string>
        opcoes={itens.map(i => ({ id: i.chave, nome: i.rotulo }))}
        selecionados={marcados}
        onToggle={alternar}
        onMarcarTodos={ids => {
          const novo = new Set(ocultos)
          for (const id of ids) novo.delete(id)
          onOcultos(novo)
        }}
        onDesmarcarTodos={() => onOcultos(new Set([...ocultos, ...itens.map(i => i.chave)]))}
        placeholder={vazio}
        nomePlural={nomePlural}
        adjetivoResumo="marcados"
        ariaLabel={`Filtrar o calendário por ${titulo.toLowerCase()}`}
        portal={portal}
      />
      {legenda && legenda.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Cor de cada tipo">
          {legenda.map(t => (
            <li key={t} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn('w-2 h-2 rounded-full', corDoTipo(t).ponto)} aria-hidden="true" />
              {rotuloDoTipo(t)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Visões
// ----------------------------------------------------------------------------

interface VisaoProps {
  doDia:      (iso: string) => Appointment[]
  onCriar:    (iso: string) => void
  onAbrirDia: (d: Date) => void
  onAbrir:    (a: Appointment) => void
}

function VisaoMes({ referencia, hojeISO, doDia, onCriar, onAbrirDia, onAbrir }: VisaoProps & {
  referencia: Date
  hojeISO:    string
}) {
  const celulas = celulasDoMes(referencia)
  const linhas = celulas.length / 7
  const grade = useRef<HTMLDivElement>(null)
  const [altura, setAltura] = useState(0)

  // Quantos itens cabem depende da altura real da célula — o mês de 6 linhas
  // num notebook comporta menos que o de 5 num monitor grande.
  useEffect(() => {
    const el = grade.current
    if (!el) return
    const obs = new ResizeObserver(([entrada]) => setAltura(entrada.contentRect.height))
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  const cabem = altura ? Math.max(1, Math.floor((altura / linhas - ALTURA_NUMERO_DIA) / ALTURA_ITEM_MES)) : 3

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="grid grid-cols-7 border-b border-border">
        {DIAS_CURTOS.map(d => (
          <div key={d} className="py-2 text-center text-xs font-medium text-muted-foreground">{d}</div>
        ))}
      </div>

      <div
        ref={grade}
        className="grid grid-cols-7 flex-1 min-h-0 overflow-hidden"
        style={{ gridTemplateRows: `repeat(${linhas}, minmax(0, 1fr))` }}
      >
        {celulas.map((d, i) => {
          const iso = dataParaISO(d)
          const foraDoMes = d.getMonth() !== referencia.getMonth()
          const ehHoje = iso === hojeISO
          const itens = doDia(iso)
          const limite = itens.length > cabem ? cabem - 1 : cabem
          const mostrados = itens.slice(0, limite)
          const resto = itens.length - mostrados.length

          return (
            <div
              key={iso}
              onClick={() => (telaLarga() ? onCriar(iso) : onAbrirDia(d))}
              className={cn(
                'group relative min-h-0 overflow-hidden flex flex-col gap-0.5 p-1 border-border cursor-pointer transition-colors hover:bg-muted/50',
                i % 7 !== 6 && 'border-r',
                i < celulas.length - 7 && 'border-b',
                foraDoMes && 'bg-muted/30',
              )}
            >
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onAbrirDia(d) }}
                aria-label={`Ver ${d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}`}
                aria-current={ehHoje ? 'date' : undefined}
                className={cn(
                  'self-center sm:self-start min-w-7 h-7 shrink-0 rounded-full text-[13px] tabular-nums flex items-center justify-center transition-colors',
                  ehHoje
                    ? 'bg-cyan-600 text-white font-semibold'
                    : foraDoMes
                      ? 'text-muted-foreground/60 hover:bg-muted'
                      : 'text-foreground hover:bg-muted',
                )}
              >
                {d.getDate() === 1 && !ehHoje ? (
                  <span className="px-1 whitespace-nowrap">
                    {d.getDate()} {d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}
                  </span>
                ) : d.getDate()}
              </button>

              {/* Celular: só pontos — o texto não cabe numa coluna de 50 px.
                  Tocar no dia (a célula toda) abre o dia com a lista. */}
              {itens.length > 0 && (
                <div className="flex sm:hidden justify-center gap-0.5 flex-wrap" aria-label={`${itens.length} agendamentos`}>
                  {itens.slice(0, 4).map(a => (
                    <span key={a.id} className={cn('w-1.5 h-1.5 rounded-full', corDoTipo(a.type).ponto)} />
                  ))}
                </div>
              )}

              <div className="hidden sm:flex flex-col gap-0.5 min-h-0">
                {mostrados.map(a => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={e => { e.stopPropagation(); onAbrir(a) }}
                    title={`${a.time ? horaCurta(a.time) : 'Sem horário'} · ${rotuloDoTipo(a.type)} · ${a.title}`}
                    className={cn(
                      'w-full flex items-center gap-1.5 px-1.5 h-5.5 rounded text-xs text-left hover:bg-muted',
                      encerrado(a) && 'opacity-60',
                    )}
                  >
                    <span className={cn('w-2 h-2 rounded-full shrink-0', corDoTipo(a.type).ponto)} aria-hidden="true" />
                    <span className="sr-only">{rotuloDoTipo(a.type)}:</span>
                    {a.time && <span className="text-muted-foreground tabular-nums shrink-0">{horaCurta(a.time)}</span>}
                    <span className={cn('truncate text-foreground', encerrado(a) && 'line-through')}>{a.title}</span>
                    {a.created_by_ai && (
                      <Bot className="w-3 h-3 shrink-0 text-muted-foreground" aria-label="Marcado pela atendente virtual" />
                    )}
                  </button>
                ))}
                {resto > 0 && (
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); onAbrirDia(d) }}
                    className="w-full text-left px-1.5 h-5.5 rounded text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    +{resto} {resto === 1 ? 'outro' : 'outros'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Semana e dia: a mesma grade horária com 7 colunas ou 1.
function GradeHoraria({ dias, doDia, onCriar, onAbrirDia, onAbrir }: VisaoProps & { dias: Date[] }) {
  const rolagem = useRef<HTMLDivElement>(null)
  const [agora, setAgora] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  const umDia = dias.length === 1
  const primeiroISO = dataParaISO(dias[0])
  const quantidade = dias.length
  const agoraISO = dataParaISO(agora)
  const minutoAgora = agora.getHours() * 60 + agora.getMinutes()

  // Ao trocar de período: se hoje está na tela, rola para perto da hora atual;
  // senão, para as 07:00 (a clínica abre às 08:00).
  useEffect(() => {
    const el = rolagem.current
    if (!el) return
    const instante = new Date()
    const hoje = dataParaISO(instante)
    const ultimoISO = dataParaISO(somarDias(isoParaData(primeiroISO), quantidade - 1))
    const contemHoje = hoje >= primeiroISO && hoje <= ultimoISO
    const alvo = contemHoje ? Math.max(0, instante.getHours() * 60 + instante.getMinutes() - 90) : 7 * 60
    el.scrollTop = (alvo / 60) * ALTURA_HORA
  }, [primeiroISO, quantidade])

  // Agendamento sem horário não tem onde cair na grade: vai para a faixa de
  // cima, como as tarefas do dia na referência.
  const semHorario = dias.map(d => doDia(dataParaISO(d)).filter(a => !a.time))
  const temSemHorario = semHorario.some(l => l.length > 0)
  const colunas = { gridTemplateColumns: `56px repeat(${dias.length}, minmax(0, 1fr))` }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="border-b border-border overflow-hidden scrollbar-gutter-stable">
        <div className="grid" style={colunas}>
          <div />
          {dias.map(d => {
            const iso = dataParaISO(d)
            const ehHoje = iso === agoraISO
            return (
              <div key={iso} className={cn('py-2 flex flex-col items-center gap-0.5', umDia && 'items-start pl-3')}>
                <span className={cn('text-[11px] font-medium uppercase', ehHoje ? 'text-cyan-700 dark:text-cyan-300' : 'text-muted-foreground')}>
                  {d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}
                </span>
                <button
                  type="button"
                  onClick={() => onAbrirDia(d)}
                  disabled={umDia}
                  aria-label={`Ver ${d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}`}
                  aria-current={ehHoje ? 'date' : undefined}
                  className={cn(
                    'w-10 h-10 rounded-full text-[22px] leading-none tabular-nums flex items-center justify-center transition-colors disabled:cursor-default',
                    ehHoje ? 'bg-cyan-600 text-white' : 'text-foreground hover:bg-muted disabled:hover:bg-transparent',
                  )}
                >
                  {d.getDate()}
                </button>
              </div>
            )
          })}
        </div>

        {temSemHorario && (
          <div className="grid" style={colunas}>
            <div className="text-[10px] text-muted-foreground text-right pr-2 pt-1.5">Sem horário</div>
            {dias.map((d, i) => (
              <div key={dataParaISO(d)} className="p-1 flex flex-col gap-0.5 min-w-0 border-l border-border">
                {semHorario[i].map(a => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => onAbrir(a)}
                    title={`${rotuloDoTipo(a.type)} · ${a.title}`}
                    className={cn(
                      'w-full px-1.5 h-5.5 rounded text-xs text-left truncate',
                      corDoTipo(a.type).suave,
                      encerrado(a) && 'opacity-60 line-through',
                    )}
                  >
                    <span className="sr-only">{rotuloDoTipo(a.type)}: </span>
                    {a.title}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div ref={rolagem} className="flex-1 min-h-0 overflow-y-auto scrollbar-gutter-stable">
        <div className="grid relative" style={{ ...colunas, height: 24 * ALTURA_HORA }}>
          <div className="relative">
            {HORAS.slice(1).map(h => (
              <span
                key={h}
                className="absolute right-2 -translate-y-1/2 text-[11px] text-muted-foreground tabular-nums"
                style={{ top: h * ALTURA_HORA }}
              >
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
          </div>

          {dias.map(d => {
            const iso = dataParaISO(d)
            const blocos = distribuirColunas(doDia(iso).filter(a => a.time))
            const ehHoje = iso === agoraISO
            return (
              <div
                key={iso}
                onClick={() => onCriar(iso)}
                className="relative border-l border-border cursor-pointer"
                style={{
                  backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${ALTURA_HORA - 1}px, var(--border) ${ALTURA_HORA - 1}px, var(--border) ${ALTURA_HORA}px)`,
                }}
              >
                {blocos.map(({ a, inicio, fim, coluna, colunas: total }) => {
                  const altura = Math.max(((fim - inicio) / 60) * ALTURA_HORA - 2, 20)
                  const compacto = altura < 36
                  // O título já é "Terapia — Profissional"; no dia sobra largura
                  // para a sala. Sem profissional, é compromisso administrativo,
                  // e isso é dito por escrito, como na visão antiga.
                  const detalhe = a.profissional_id == null ? 'Administrativo' : umDia ? a.sala_nome : null
                  // A altura usa a duração padrão quando falta a gravada; o
                  // horário de fim, não — só aparece quando é dado do registro.
                  const fimTexto = a.duration ? horaFim(a.time, a.duration) : null
                  // O tipo vai por escrito também: só pela cor, quem não
                  // distingue âmbar de cyan (ou imprime em cinza) não separa
                  // triagem de retorno.
                  const tipo = rotuloDoTipo(a.type)
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={e => { e.stopPropagation(); onAbrir(a) }}
                      title={`${horaCurta(a.time)}${fimTexto ? `–${fimTexto}` : ''} · ${tipo} · ${a.title}`}
                      className={cn(
                        'absolute rounded-md px-2 text-left overflow-hidden ring-1 ring-card transition-colors z-1',
                        compacto ? 'py-0.5 flex items-center gap-1.5' : 'py-0.5',
                        corDoTipo(a.type).suave,
                        encerrado(a) && 'opacity-60',
                      )}
                      style={{
                        top:    (inicio / 60) * ALTURA_HORA + 1,
                        height: altura,
                        left:   `calc(${(coluna / total) * 100}% + 2px)`,
                        width:  `calc(${100 / total}% - 4px)`,
                      }}
                    >
                      <span className={cn('block truncate text-xs leading-4 font-semibold', encerrado(a) && 'line-through')}>
                        {a.created_by_ai && <Bot className="inline w-3 h-3 mr-1 -mt-0.5" aria-label="Marcado pela atendente virtual" />}
                        {compacto && <span className="sr-only">{tipo}: </span>}
                        {a.title}
                      </span>
                      <span className={cn('block truncate text-[11px] leading-3.5 opacity-80 tabular-nums', compacto && 'shrink-0')}>
                        {horaCurta(a.time)}
                        {!compacto && fimTexto ? ` – ${fimTexto}` : ''}
                        {!compacto ? ` · ${tipo}` : ''}
                        {!compacto && detalhe ? ` · ${detalhe}` : ''}
                      </span>
                    </button>
                  )
                })}

                {ehHoje && (
                  <div className="absolute left-0 right-0 z-2 pointer-events-none" style={{ top: (minutoAgora / 60) * ALTURA_HORA }} aria-hidden="true">
                    <div className="relative h-0.5 bg-red-500">
                      <span className="absolute -left-1.5 -top-1.25 w-3 h-3 rounded-full bg-red-500" />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function BotaoRedondo({ onClick, rotulo, atalho, pequeno, desabilitado, classe, children }: {
  onClick:       () => void
  rotulo:        string
  atalho?:       string
  pequeno?:      boolean
  desabilitado?: boolean
  classe?:       string
  children:      React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desabilitado}
      aria-label={rotulo}
      title={atalho ? `${rotulo} (${atalho})` : rotulo}
      className={cn(
        'rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50',
        pequeno ? 'w-8 h-8' : 'w-9 h-9',
        classe,
      )}
    >
      {children}
    </button>
  )
}

// Semanas completas (domingo a sábado) que cobrem o mês: 4, 5 ou 6 linhas.
function celulasDoMes(d: Date): Date[] {
  const primeiro = new Date(d.getFullYear(), d.getMonth(), 1)
  const diasNoMes = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  const semanas = Math.ceil((primeiro.getDay() + diasNoMes) / 7)
  const inicio = inicioDaSemana(primeiro)
  return Array.from({ length: semanas * 7 }, (_, i) => somarDias(inicio, i))
}

interface Bloco {
  a:       Appointment
  inicio:  number
  fim:     number
  coluna:  number
  colunas: number
}

// Encaixe de horários sobrepostos lado a lado. Os blocos que se encostam em
// cadeia formam um grupo; dentro dele cada bloco ocupa a primeira coluna livre,
// e todos dividem a largura pelo número de colunas que o grupo precisou.
function distribuirColunas(lista: Appointment[]): Bloco[] {
  const blocos: Bloco[] = lista
    .map(a => {
      const inicio = minutosDoDia(a.time)
      return { a, inicio, fim: Math.max(inicio + (a.duration || DURACAO_PADRAO), inicio + 15), coluna: 0, colunas: 1 }
    })
    .sort((x, y) => x.inicio - y.inicio || y.fim - x.fim)

  const saida: Bloco[] = []
  let grupo: Bloco[] = []
  let fimPorColuna: number[] = []
  let fimDoGrupo = -1

  const fechar = () => {
    for (const b of grupo) b.colunas = fimPorColuna.length
    saida.push(...grupo)
    grupo = []
    fimPorColuna = []
  }

  for (const b of blocos) {
    if (b.inicio >= fimDoGrupo && grupo.length) fechar()
    let c = fimPorColuna.findIndex(fim => fim <= b.inicio)
    if (c < 0) { c = fimPorColuna.length; fimPorColuna.push(b.fim) }
    else fimPorColuna[c] = b.fim
    b.coluna = c
    grupo.push(b)
    fimDoGrupo = Math.max(fimDoGrupo, b.fim)
  }
  fechar()
  return saida
}

function rotuloPeriodo(referencia: Date, visao: Visao): string {
  if (visao === 'mes') {
    return capitalizar(referencia.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }))
  }
  if (visao === 'dia') {
    return capitalizar(referencia.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
  }
  const inicio = inicioDaSemana(referencia)
  const fim = somarDias(inicio, 6)
  const mesCurto = (d: Date) => d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
  return inicio.getMonth() === fim.getMonth()
    ? `${inicio.getDate()} – ${fim.getDate()} de ${mesCurto(fim)} de ${fim.getFullYear()}`
    : `${inicio.getDate()} ${mesCurto(inicio)} – ${fim.getDate()} ${mesCurto(fim)} de ${fim.getFullYear()}`
}

// "Hoje", "Amanhã" ou "Qua, 8 out"
function quandoCurto(iso: string, hojeISO: string): string {
  if (iso === hojeISO) return 'Hoje'
  if (iso === dataParaISO(somarDias(isoParaData(hojeISO), 1))) return 'Amanhã'
  return capitalizar(
    isoParaData(iso).toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, ''),
  )
}
