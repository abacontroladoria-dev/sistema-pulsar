'use client'

import { useCallback, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle, Ban, CalendarDays, CheckCircle2, Link2, Loader2, RefreshCw, X,
} from 'lucide-react'
import { diasUteisDe, segundaDe, type useAnaliseReincidencia } from '@/hooks/useAnaliseReincidencia'
import { useModalDialog } from '@/hooks/useModalDialog'
import type { CandidataVinculo, CartaoGrade, GuiaOrfa } from '../types'
import DetalheCartao from './DetalheCartao'
import GradeSemana from './GradeSemana'
import { PENDENCIAS } from './pendencias'
import { dataHoraCurta, formatarDia, formatarDiaComNome, hojeLocal, rotuloSemana } from './datas'
import { montarGrade } from './grade'
import { mapearCandidatas, type MapaCandidatas } from './vinculo'

const ID_TITULO = 'titulo-semana-paciente'

/** "17–21" — a semana em duas datas, sem o mês, que a faixa já diz. */
function rotuloCurtoSemana(inicio: string, fim: string): string {
  return `${inicio.slice(8, 10)}–${fim.slice(8, 10)}`
}

/**
 * O modo "esta guia cobre qual sessão?", que a grade passou a hospedar.
 *
 * Era um modal próprio (`ModalEscolherSessao`, removido em 2026-08-24). Ele
 * prometia no comentário que "a semana continua atrás" e não continuava: abri-lo
 * fechava o modal da semana, então tudo o que se sabia sobre a guia — motivo da
 * recusa, quem solicitou, os vizinhos da agenda — sumia no exato momento de
 * decidir, e voltava reduzido a uma linha cinza de subtítulo.
 */
export type ModoVinculo = {
  guia: GuiaOrfa
  candidatas: CandidataVinculo[]
  carregando: boolean
  erro: string | null
  janelaDias: number
  onEscolher: (candidata: CandidataVinculo) => void
  onSemSessao: () => void
  onCancelar: () => void
}

/**
 * O mês do paciente, semana a semana — a resposta para "onde está a pendência?".
 *
 * A listagem é mensal e a grade é semanal, e até 2026-08-24 nada ligava as duas:
 * o modal abria na semana da última autorização, que não é onde está o trabalho.
 * Quem clicava numa linha de "Faltando 3" podia cair numa semana limpa e não
 * tinha como saber para que lado navegar.
 *
 * Cada segmento diz quantos cartões marcados aquela semana tem. O ponto no lugar
 * do número é deliberado: "0" repetido em quatro segmentos vira ruído com peso
 * de dado, e o que importa ali é só distinguir "tem" de "não tem".
 *
 * A semana aberta usa o steel da marca, nunca matiz semântico — é "você está
 * aqui", não um estado. E o número marcado usa âmbar, o mesmo matiz que essa
 * tela usa para "esperando alguém olhar".
 */
function FaixaDeSemanas({
  semanas,
  atual,
  onEscolher,
  tom = 'pendencia',
}: {
  semanas: { inicio: string; fim: string; marcados: number }[]
  atual: string
  onEscolher: (inicio: string) => void
  /**
   * O que o número conta. No modo de vínculo a faixa deixa de contar pendências
   * e passa a contar CANDIDATAS — a mesma pergunta ("para que lado navegar?")
   * com outra resposta —, e o distintivo troca de âmbar para steel: ali ele é
   * seleção, não um estado da semana.
   */
  tom?: 'pendencia' | 'candidata'
}) {
  if (semanas.length < 2) return null
  const emVinculo = tom === 'candidata'

  return (
    <nav
      aria-label="Semanas do mês"
      className="flex items-center gap-1 overflow-x-auto border-b border-slate-100 bg-slate-50 px-4 py-1.5 sm:px-6"
    >
      {semanas.map(({ inicio, fim, marcados }) => {
        const aberta = inicio === atual
        return (
          <button
            key={inicio}
            type="button"
            onClick={() => onEscolher(inicio)}
            aria-current={aberta ? 'true' : undefined}
            aria-label={`Semana de ${rotuloCurtoSemana(inicio, fim)}, ${
              marcados === 0
                ? emVinculo
                  ? 'nenhuma candidata'
                  : 'nada a conferir'
                : `${marcados} ${emVinculo ? 'candidata(s)' : 'a conferir'}`
            }`}
            className={`flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] transition focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none ${
              aberta
                ? 'bg-brand-surface font-semibold text-brand-fg'
                : 'text-slate-600 hover:bg-white'
            }`}
          >
            <span className="tabular-nums">{rotuloCurtoSemana(inicio, fim)}</span>
            {marcados > 0 ? (
              <span
                className={`rounded-full px-1.5 text-[11px] font-bold tabular-nums ${
                  emVinculo ? 'bg-brand text-white' : 'bg-amber-100 text-amber-800'
                }`}
              >
                {marcados}
              </span>
            ) : (
              <span className="text-slate-300" aria-hidden>
                ·
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}

/**
 * A barra do modo de vínculo: o que se está vinculando, e onde estão as opções.
 *
 * A janela de candidatas é de 7 dias RETROATIVOS a partir do instante em que a
 * ASSIM registrou a guia, e ela atravessa a semana exibida — às vezes o mês. Uma
 * guia autorizada na segunda procura sessões da quinta anterior, que a grade
 * aberta não tem onde desenhar. Toda candidata que a semana não mostra sai
 * escrita aqui, com o gesto que chega até ela: sem isso a tela contaria "3
 * candidatas" e mostraria uma, calada.
 *
 * "É autorização extra" é ação de PRIMEIRA CLASSE e não caso de borda — 39% das
 * órfãs medidas em produção (2026-08-20) não cobrem sessão nenhuma. No modal
 * antigo ela era um botão de contorno cinza no rodapé, isto é, o desfecho mais
 * provável vestido como o controle mais fraco. Quando não há candidata nenhuma,
 * ela vira o botão preenchido: é literalmente a única coisa a fazer.
 */
function BarraVinculo({
  modo,
  mapa,
  semanas,
  semanaAtual,
  onIrParaSemana,
  onIrParaData,
}: {
  modo: ModoVinculo
  mapa: MapaCandidatas
  semanas: { inicio: string; fim: string }[]
  semanaAtual: string
  onIrParaSemana: (inicio: string) => void
  onIrParaData: (dia: string) => void
}) {
  const { guia } = modo
  const nesta = mapa.porSemana.get(semanaAtual) ?? 0
  const outras = semanas.filter(
    (s) => s.inicio !== semanaAtual && (mapa.porSemana.get(s.inicio) ?? 0) > 0
  )
  // Uma entrada por DIA, e não por candidata: duas sessões do mesmo dia são um
  // destino só, e o botão diz a data porque é ela que a pessoa vai reconhecer.
  const diasForaDoMes = [...new Set(mapa.foraDoMes.map((c) => c.data_atendimento ?? ''))]
    .filter(Boolean)
    .sort()
  const vazio = !modo.carregando && !modo.erro && mapa.totalElegiveis === 0

  return (
    <div className="flex flex-col gap-2.5 border-b border-slate-200 bg-brand-surface px-4 py-3 sm:px-6 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[13px] leading-tight font-bold text-brand-fg">
          <Link2 size={15} aria-hidden />A guia{' '}
          <span className="font-mono tabular-nums">{guia.guia}</span> cobre qual sessão?
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">
          {guia.codigo_tuss && <span className="tabular-nums">TUSS {guia.codigo_tuss} · </span>}
          autorizada em <span className="tabular-nums">{dataHoraCurta(guia.data_execucao)}</span> ·
          sessões dos {modo.janelaDias} dias anteriores
        </p>

        <div className="mt-1.5 text-[12px] leading-relaxed" role="status" aria-live="polite">
          {modo.carregando ? (
            <p className="flex items-center gap-1.5 text-slate-600">
              <Loader2 size={13} className="animate-spin" aria-hidden />
              Procurando as sessões que esta guia pode cobrir…
            </p>
          ) : modo.erro ? (
            <p className="flex items-start gap-1.5 font-medium text-rose-700">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
              {modo.erro}
            </p>
          ) : vazio ? (
            <p className="text-slate-700">
              Nenhuma sessão candidata nos {modo.janelaDias} dias anteriores. Costuma ser
              autorização extra.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <span className="font-semibold text-brand-fg">
                {nesta > 0
                  ? 'Clique na sessão — ou na falta de terapeuta — que esta guia autorizou.'
                  : 'Nenhuma candidata nesta semana.'}
              </span>
              {outras.map((s) => (
                <button
                  key={s.inicio}
                  type="button"
                  onClick={() => onIrParaSemana(s.inicio)}
                  className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-brand bg-white px-2 text-[11px] font-semibold text-brand-fg transition hover:bg-brand-hover focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:outline-none"
                >
                  <span className="tabular-nums">{rotuloCurtoSemana(s.inicio, s.fim)}</span>
                  <span className="rounded-full bg-brand px-1.5 font-bold tabular-nums text-white">
                    {mapa.porSemana.get(s.inicio)}
                  </span>
                </button>
              ))}
              {diasForaDoMes.map((dia) => (
                <button
                  key={dia}
                  type="button"
                  onClick={() => onIrParaData(dia)}
                  title="Está fora do mês carregado — abrir o mês dessa sessão"
                  className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-brand bg-white px-2 text-[11px] font-semibold text-brand-fg transition hover:bg-brand-hover focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:outline-none"
                >
                  <CalendarDays size={11} aria-hidden />
                  <span className="tabular-nums">{formatarDia(dia)}</span>
                </button>
              ))}
            </div>
          )}

          {/* Não deveria acontecer. Dito em voz alta justamente por isso: uma
              candidata que cai na semana aberta e mesmo assim não tem cartão
              sumiria da tela sem deixar rastro, e o total acima ficaria
              prometendo uma opção que não existe em lugar nenhum. */}
          {mapa.semCartao.length > 0 && (
            <p className="mt-1 text-[11px] text-amber-800">
              {mapa.semCartao.length} candidata(s) desta semana não aparecem na grade:{' '}
              {mapa.semCartao
                .map((c) =>
                  c.data_atendimento
                    ? `${formatarDiaComNome(c.data_atendimento)} ${(c.hora_inicial ?? '').slice(0, 5)}`.trim()
                    : 'sem data'
                )
                .join(', ')}
              .
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={modo.onSemSessao}
          className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold transition focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none ${
            vazio
              ? 'bg-brand-fg text-white hover:bg-brand-dark'
              : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          <Ban size={13} aria-hidden />
          Nenhuma — é autorização extra
        </button>
        <button
          type="button"
          onClick={modo.onCancelar}
          className="inline-flex h-9 items-center rounded-lg px-3 text-[12px] font-medium text-slate-600 transition hover:bg-white focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}

/** Duas letras do nome. Não há foto de paciente no sistema — a inicial é a identidade. */
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '?'
  return ((partes[0][0] ?? '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase()
}

type Props = {
  open: boolean
  onClose: () => void
  analise: ReturnType<typeof useAnaliseReincidencia>
  podeVincular: boolean
  /** `admin`/`autorizacao`. Mais estreito que `podeVincular` — ver a RPC. */
  podeReclassificar: boolean
  codigosGlosa: Map<string, string>
  onVincularGuia: (guia: string) => void
  onReclassificar: (cartao: CartaoGrade) => void
  /** Ligado = a grade está escolhendo a sessão desta guia. Ver `ModoVinculo`. */
  vinculo: ModoVinculo | null
}

/**
 * A semana de um paciente, em grade — a segunda tela dentro da tela.
 *
 * Por que modal e não rota: a decisão que se toma aqui (esta guia cobre qual
 * sessão?) volta imediatamente para a listagem, que é onde está a fila de
 * trabalho. Perder a listagem a cada paciente aberto obrigaria a refazer o
 * recorte da semana a cada volta — e a listagem é a única visão de quantos
 * ainda faltam.
 *
 * Ele não busca nada ao abrir: a semana inteira da clínica já está em memória
 * (ver useAnaliseReincidencia), então o recorte deste paciente é um `useMemo`.
 * É o que garante que os números daqui sejam os MESMOS da linha clicada — não
 * uma segunda contagem que pode divergir.
 *
 * ── O que mudou em 2026-08-24 ──────────────────────────────────────────────
 *
 * A queixa era que o modal não tinha hierarquia e não dizia QUAL sessão estava
 * com problema. O que sobrou, depois de o usuário podar o que não queria:
 *
 * 1. "faltando" e "sobrando" deixaram de ser agregados por TUSS e viraram
 *    marcas nos cartões (`sessaoSemCobertura`, `guiasExcedentes`) — é o que
 *    torna a pendência apontável, que era o pedido literal;
 * 2. o cartão passou a ter duas espécies, e a diferença é de SILHUETA: o
 *    saudável colapsa em duas linhas, o pendente fica inteiro com barra
 *    lateral. Com seis matizes a 11px a cor tinha parado de discriminar;
 * 3. todo cartão virou botão e abre uma GAVETA com tudo o que se sabe sobre
 *    ele — o que aposentou a seção "histórico de autorizações" e, com ela, o
 *    rodapé inteiro. Ver `DetalheCartao`;
 * 4. a faixa de semanas do mês tomou o lugar do seletor de semana no cabeçalho,
 *    e o modal passou a abrir na primeira semana que tem cartão marcado.
 *
 * **Não há mais filtro nenhum aqui.** Os indicadores das cinco espécies e as
 * chips de cota por TUSS foram removidos a pedido, e cada um era o filtro do
 * que nomeava; o modal mostra a semana inteira, sempre. As cinco contagens
 * sobrevivem só no resumo `sr-only`, para quem lê por leitor de tela — a
 * listagem continua sendo onde elas se leem com os olhos.
 */
export default function ModalSemanaPaciente({
  open, onClose, analise, podeVincular, podeReclassificar, codigosGlosa,
  onVincularGuia, onReclassificar, vinculo,
}: Props) {
  /** O cartão aberto na gaveta lateral. Nulo = só a grade. */
  const [detalhe, setDetalhe] = useState<CartaoGrade | null>(null)

  /**
   * Escape desfaz um estágio por vez: o modo de vínculo, depois a gaveta,
   * depois o modal.
   *
   * Nem a gaveta nem o modo instalam focus trap próprio, de propósito (ver
   * `DetalheCartao`), então quem escuta o Escape continua sendo o
   * `useModalDialog` daqui — em captura no `document`, antes de qualquer handler
   * do React. Encadear os estágios AQUI é o único ponto onde funciona: um
   * `onKeyDown` no filho parece resolver e não resolve.
   */
  const fechar = useCallback(() => {
    if (vinculo) {
      vinculo.onCancelar()
      return
    }
    if (detalhe) {
      setDetalhe(null)
      return
    }
    onClose()
  }, [vinculo, detalhe, onClose])
  const { refDialogo, propsDialogo } = useModalDialog(open, fechar, ID_TITULO)

  const dias = useMemo(() => diasUteisDe(analise.semanaInicio), [analise.semanaInicio])

  const linhas = useMemo(
    () =>
      montarGrade(
        analise.sessoesVisiveis,
        analise.autorizacoesVisiveis,
        analise.estadoDaGuia,
        dias,
        analise.placar,
        {
          descoberta: analise.sessaoDescoberta,
          decorrida: analise.sessaoJaDecorrida,
          excedentes: analise.guiasExcedentes,
        },
        analise.vinculos
      ),
    [
      analise.sessoesVisiveis, analise.autorizacoesVisiveis, analise.estadoDaGuia, dias,
      analise.placar, analise.sessaoDescoberta, analise.sessaoJaDecorrida,
      analise.guiasExcedentes, analise.vinculos,
    ]
  )

  /**
   * A junção entre as candidatas da guia e o que a semana aberta desenha.
   *
   * Pelas CHAVES dos cartões, e não pelas datas: o `chave` de um cartão de
   * sessão é o `bloco_id`, que é a mesma coluna que a RPC de candidatas
   * devolve. Comparar por data e hora seria uma segunda definição de "é a mesma
   * sessão", e ela divergiria no primeiro atendimento sem `hora_inicial`.
   */
  const chavesNaGrade = useMemo(() => {
    const chaves = new Set<string>()
    for (const linha of linhas) {
      for (const dia of dias) {
        for (const cartao of linha.celulas[dia] ?? []) chaves.add(cartao.chave)
      }
    }
    return chaves
  }, [linhas, dias])

  const candidatas = vinculo?.candidatas
  const mapa = useMemo(
    () =>
      mapearCandidatas(
        candidatas ?? [],
        analise.semanasDoMes,
        analise.semanaInicio,
        chavesNaGrade
      ),
    [candidatas, analise.semanasDoMes, analise.semanaInicio, chavesNaGrade]
  )

  /**
   * A gaveta fecha quando o recorte atrás dela muda — abrir/fechar o modal,
   * trocar de paciente, trocar de semana, entrar ou sair do modo de vínculo.
   *
   * Fechar o modal NÃO desmonta este componente: ele renderiza `null` e a
   * instância continua viva, com o estado inteiro. Sem esta guarda, abrir a
   * gaveta, fechar o modal e abrir outro paciente trazia a gaveta já aberta —
   * mostrando o cartão do paciente anterior. Trocar de semana tinha o mesmo
   * defeito, com um cartão que não está mais na grade atrás.
   *
   * Ajustado durante o render e não num efeito: é o padrão que o React recomenda
   * para "resetar estado quando uma prop muda", e um efeito com setState
   * síncrono aqui causaria renderização em cascata.
   */
  const recorte = `${open}|${analise.pacienteNome ?? ''}|${analise.semanaInicio}|${
    vinculo?.guia.guia ?? ''
  }`
  const [recorteAnterior, setRecorteAnterior] = useState(recorte)
  if (recorteAnterior !== recorte) {
    setRecorteAnterior(recorte)
    setDetalhe(null)
  }

  if (!open || !analise.pacienteNome) return null

  const labelSemana = rotuloSemana(analise.semanaInicio, analise.semanaFim)
  const linha = analise.linhaSelecionada
  const { contagem } = analise
  const rotuloMes = new Date(
    Number(analise.mesRef.slice(0, 4)),
    Number(analise.mesRef.slice(5, 7)) - 1,
    1
  ).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 backdrop-blur-sm sm:p-4"
      onClick={onClose}
    >
      <div
        ref={refDialogo}
        {...propsDialogo}
        className="motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-150 flex h-[95dvh] w-full max-w-460 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* As cinco contagens não têm mais forma visual neste modal (os
            indicadores saíram a pedido), mas continuam ditas aqui: para quem lê
            por leitor de tela, elas são a única síntese da semana. */}
        <p className="sr-only" role="status" aria-live="polite">
          {analise.pacienteNome}, semana de {labelSemana}. {contagem.total} pendência(s):{' '}
          {PENDENCIAS.map((p) => `${contagem[p.chave]} ${p.rotulo.toLowerCase()}`).join(', ')}.
        </p>

        {/* ── Identidade + as semanas do mês ──────────────────────────────── */}
        <header className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-surface text-sm font-bold text-brand-fg"
            >
              {iniciais(analise.pacienteNome)}
            </span>
            <div className="min-w-0">
              <h2
                id={ID_TITULO}
                className="truncate text-lg leading-tight font-bold text-slate-900"
                title={analise.pacienteNome}
              >
                {analise.pacienteNome}
              </h2>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                <span className="tabular-nums">
                  {analise.carteirinhaDoPaciente ?? 'sem carteirinha'}
                </span>
                {linha?.plano && <> · {linha.plano}</>}
                {linha?.unidade && <> · {linha.unidade}</>}
                {analise.idsDoPaciente.length > 1 && (
                  /* Nome não é identidade. Dizer que são dois cadastros é melhor
                     que escolher um em silêncio e mostrar meia semana como se
                     fosse toda. */
                  <span className="text-amber-700">
                    {' '}· dois cadastros ({analise.idsDoPaciente.join(', ')}), somados aqui
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* A faixa É o seletor de semana — não há mais setas nem rótulo de
              intervalo ao lado. Duas formas de escolher a mesma coisa custavam
              a largura do cabeçalho e escondiam, atrás das setas, a informação
              que a faixa dá de graça: em qual semana está o trabalho. */}
          <div className="flex min-w-0 items-center gap-2 lg:shrink-0">
            <span className="hidden shrink-0 items-center gap-1.5 text-slate-500 sm:flex">
              <CalendarDays size={15} aria-hidden />
              {/* `capitalize` daria "Agosto De 2026" — ele sobe a inicial de cada
                  palavra. `first-letter` só pega em caixa de bloco, daí o
                  `inline-block`. */}
              <span className="inline-block text-[12px] font-semibold first-letter:uppercase">
                {rotuloMes}
              </span>
            </span>
            <FaixaDeSemanas
              semanas={
                vinculo
                  ? analise.semanasDoMes.map((s) => ({
                      ...s,
                      marcados: mapa.porSemana.get(s.inicio) ?? 0,
                    }))
                  : analise.semanasDoMes
              }
              atual={analise.semanaInicio}
              onEscolher={analise.irParaSemanaEm}
              tom={vinculo ? 'candidata' : 'pendencia'}
            />
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
            >
              <X size={20} />
            </button>
          </div>
        </header>

        {vinculo && (
          <BarraVinculo
            modo={vinculo}
            mapa={mapa}
            semanas={analise.semanasDoMes}
            semanaAtual={analise.semanaInicio}
            onIrParaSemana={analise.irParaSemanaEm}
            onIrParaData={(dia) => {
              // O mês primeiro, a semana depois: `irParaMesData` também mexe em
              // `semanaInicio` (leva para a semana de hoje, ou para a primeira
              // do mês), então a ordem inversa seria sobrescrita. Os dois são
              // setState do mesmo handler, e o React os aplica em lote.
              analise.irParaMesData(dia)
              analise.irParaSemanaEm(segundaDe(dia))
            }}
          />
        )}

        {/* ── A grade, e a gaveta ao lado dela ────────────────────────────── */}
        {/* O contêiner externo é `relative` para a gaveta se ancorar nele, e não
            no scroller: ancorada dentro do scroller, ela subiria junto com a
            grade ao rolar. */}
        <div className="relative flex min-h-0 flex-1">
          {/* Um scroller só, nos DOIS eixos, e `relative`. Os dois detalhes são
              medidos: com um `overflow-x` próprio dentro da grade, o cabeçalho
              dos dias deixa de grudar (o sticky passa a mirar o contêiner de
              dentro, que não rola na vertical); sem `relative`, a largura mínima
              da grade escapa e é o DOCUMENTO que rola de lado a 390px. */}
          <div className="relative min-h-0 flex-1 overflow-auto bg-white">
            {analise.erro ? (
              <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
                <AlertTriangle size={24} className="text-rose-600" />
                <p className="text-sm font-medium text-slate-700">{analise.erro}</p>
                <button
                  onClick={analise.recarregar}
                  className="mt-1 inline-flex h-11 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 transition hover:border-brand hover:bg-brand-hover hover:text-brand-fg focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  <RefreshCw size={13} />
                  Tentar novamente
                </button>
              </div>
            ) : /* As QUATRO cargas, e não só a das sessões: a grade lê
                   autorizações (o cartão da guia), órfãs (o estado "sem
                   vínculo") e triagens (os estados "vinculada" e "autorização
                   extra") tanto quanto lê sessões. Gatear numa só fazia a
                   semana pintar com guia vestida de "Outra semana" e trocar de
                   rótulo segundos depois — nas duas direções. */
              analise.loading ? (
              <div className="space-y-2 p-4 sm:p-6">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100" />
                ))}
              </div>
            ) : linhas.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-1 py-24 text-center">
                <CheckCircle2 size={22} className="text-slate-400" />
                <p className="text-sm font-medium text-slate-600">
                  Nenhum atendimento nem guia nesta semana
                </p>
                <p className="max-w-md text-xs text-slate-500">
                  Nem a clínica agendou, nem a ASSIM registrou nada de seg a sex para{' '}
                  {analise.pacienteNome}.
                </p>
              </div>
            ) : (
              <GradeSemana
                linhas={linhas}
                dias={dias}
                hoje={hojeLocal()}
                codigosGlosa={codigosGlosa}
                chaveAberta={detalhe?.chave ?? null}
                onAbrirDetalhe={setDetalhe}
                selecao={
                  vinculo
                    ? {
                        porBloco: mapa.naGrade,
                        guiaEmFoco: vinculo.guia.guia,
                        onEscolher: vinculo.onEscolher,
                      }
                    : undefined
                }
              />
            )}
          </div>

          {/* A gaveta não convive com o modo de vínculo: o `recorte` acima a
              fecha ao entrar, e este guarda impede que ela reapareça por cima
              da escolha se algo abrir um detalhe no meio do caminho. */}
          {detalhe && !vinculo && (
            <>
              {/* O véu é clicável e nomeado: fechar tocando fora da gaveta é o
                  gesto que se espera, e sem `aria-label` ele seria um botão sem
                  nome para o leitor de tela.

                  z-40/z-50 e não z-10/z-20: as células grudadas do cabeçalho da
                  grade são z-30, e `position: relative` sem z-index não abre
                  contexto de empilhamento — as duas competem no mesmo plano.
                  Medido a 390px, "Horário" aparecia POR CIMA da gaveta. */}
              <button
                type="button"
                aria-label="Fechar o detalhe"
                onClick={() => setDetalhe(null)}
                className="absolute inset-0 z-40 cursor-default bg-slate-900/10"
              />
              <DetalheCartao
                cartao={detalhe}
                codigosGlosa={codigosGlosa}
                conferencia={analise.conferenciasPorBloco.get(detalhe.chave)}
                nota={analise.notasPorBloco.get(detalhe.chave)}
                reclassificacao={analise.reclassificacoesPorBloco.get(detalhe.chave)}
                podeVincular={podeVincular}
                podeReclassificar={podeReclassificar}
                onVincular={onVincularGuia}
                onReclassificar={onReclassificar}
                onFechar={() => setDetalhe(null)}
              />
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
