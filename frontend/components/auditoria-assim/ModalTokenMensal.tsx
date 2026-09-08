'use client'

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useModalDialog } from '@/hooks/useModalDialog'
import { AlertTriangle, Check, ChevronLeft, ChevronRight, ClipboardCheck, Copy, KeySquare, Loader2, RefreshCw, Search, X } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { listarTokensMensal, marcarTokenConferido } from '@/services/auditoria-assim.service'
import { LABEL_ERRO_FACIAL, erroReconhecimentoFacial } from './formaValidacao'
import type { TokenMensalItem } from './types'

type Props = {
  open: boolean
  onClose: () => void
}

type Aba = 'pendentes' | 'conferidas' | 'todas'

/**
 * As abas filtram o mesmo eixo que a lista pinta, então vestem o matiz do
 * estado que filtram — âmbar a conferir, esmeralda conferida, slate o conjunto.
 * Aqui o matiz não decora: é o estado.
 *
 * A ativa é tinta `-50` + borda + texto no matiz; a inativa é só o texto. É o
 * vocabulário dos KpiCards desta página. O preenchimento sólido que estava aqui
 * (`bg-amber-500 text-white`) media 2,15:1 — branco sobre âmbar-500 é ilegível —
 * e era a única chip da tela pintada assim.
 *
 * Os degraus são `-300`/`-700` e não `-400`/`-800` por causa do tema escuro: o
 * shim de `globals.css` só remapeia certos degraus, e um que ele não conhece
 * atravessa inteiro para o escuro — borda clara e texto quase branco sobre
 * fundo escuro. Ficar nos degraus cobertos é o que mantém a aba legível nos
 * dois temas sem duplicar regra de CSS.
 */
const ABA_TOM: Record<Aba, { ativa: string; inativa: string }> = {
  pendentes: {
    ativa: 'border-amber-300 bg-amber-50 text-amber-700',
    inativa: 'border-transparent text-amber-700 hover:bg-amber-50',
  },
  conferidas: {
    ativa: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    inativa: 'border-transparent text-emerald-700 hover:bg-emerald-50',
  },
  todas: {
    ativa: 'border-slate-300 bg-slate-100 text-slate-800',
    inativa: 'border-transparent text-slate-600 hover:bg-slate-100',
  },
}

function primeiroDiaDoMes(ref: Date) {
  return new Date(ref.getFullYear(), ref.getMonth(), 1)
}

function paramMes(ref: Date) {
  const ano = ref.getFullYear()
  const mes = String(ref.getMonth() + 1).padStart(2, '0')
  return `${ano}-${mes}-01`
}

function formatarDia(data: string | null) {
  if (!data) return '—'
  const [, mes, dia] = data.split('-')
  return `${dia}/${mes}`
}

function formatarDataHora(data: string | null) {
  if (!data) return null
  const d = new Date(data)
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

/** Sem acento e sem caixa: "joao" acha "João". */
function normalizar(valor: string) {
  return valor.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

/**
 * O que a linha mostra, em texto, para colar no ClickUp.
 *
 * Segue exatamente a coluna visível: dia, hora, paciente, terapias, quem
 * solicitou, guia e a identificação do papel (token, erro facial ou a ausência).
 * O ClickUp renderiza markdown, então a lista vai como tabela — colar num campo
 * de texto simples também continua legível porque as colunas são delimitadas.
 */
function identificacaoDoPapel(item: TokenMensalItem) {
  if (item.token) return item.token
  if (erroReconhecimentoFacial(item.forma_autorizacao)) return LABEL_ERRO_FACIAL
  return 'SEM TOKEN'
}

function montarTextoConferencia(
  itens: TokenMensalItem[],
  contexto: { labelMes: string; aba: Aba; busca: string }
) {
  const rotuloAba =
    contexto.aba === 'pendentes' ? 'Pendentes' : contexto.aba === 'conferidas' ? 'Conferidas' : 'Todas'

  const cabecalho = [
    `**Conferência de filipetas — ${contexto.labelMes}**`,
    `${rotuloAba}: ${itens.length} registro(s)${contexto.busca.trim() ? ` — busca “${contexto.busca.trim()}”` : ''}`,
  ]

  const linhas = [
    '| Dia | Hora | Paciente | Terapias | Solicitou | Guia | Token |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...itens.map((i) => {
      const celulas = [
        formatarDia(i.data_atendimento),
        i.hora_inicial?.slice(0, 5) ?? '—',
        i.paciente_nome ?? '—',
        i.terapias ?? '—',
        i.criado_por ?? '—',
        i.guia ?? '—',
        identificacaoDoPapel(i),
      ]
        // A barra vertical dentro do dado quebraria a coluna da tabela.
        .map((c) => String(c).replace(/\|/g, '/').trim())
      return `| ${celulas.join(' | ')} |`
    }),
  ]

  return [...cabecalho, '', ...linhas].join('\n')
}

/**
 * Uma linha da conferência, memoizada.
 *
 * Estava inline no `.map` e por isso TODA linha re-renderizava a cada marcação
 * — o `handleToggle` reconstrói o array inteiro. Medido antes: 423 ms para
 * marcar uma conferência com 600 linhas, 472 ms com 3000. Como marcar é a ação
 * central deste modal e a recepção marca uma atrás da outra, esse era o custo
 * que mais aparecia no uso real.
 *
 * O `memo` só vale porque `onToggle` é estável (useCallback com setState
 * funcional) e as outras props são primitivas — sem isso a comparação passa
 * sempre e não economiza nada.
 */
const LinhaConferencia = memo(function LinhaConferencia({
  item,
  ocupado,
  onToggle,
}: {
  item: TokenMensalItem
  ocupado: boolean
  onToggle: (item: TokenMensalItem) => void
}) {
  const conferido = Boolean(item.token_conferido)
  // O estado da linha vive no perímetro inteiro — borda âmbar mais tinta âmbar
  // quando falta conferir, branco sobre a base cinza quando já foi. Antes era um
  // trilho de 6px na borda esquerda, que é justamente o que o DESIGN.md proíbe
  // ("side-stripe"), e ainda repetia o que a borda da própria linha já dizia.
  // O que falta fazer se destaca; o pronto recua.
  return (
    <li
      className={`flex flex-col gap-2 rounded-xl border px-4 py-3 shadow-sm transition lg:flex-row lg:items-center lg:gap-4 lg:py-0 ${
        conferido ? 'border-slate-200 bg-white' : 'border-amber-300 bg-amber-50'
      }`}
    >
      {/* `lg:contents` dissolve os agrupadores no desktop, então a linha larga
          continua sendo exatamente a de antes; no celular eles viram as faixas
          do card empilhado. Sem isso a linha pedia 552px dentro de 293px e o
          `overflow-hidden` comia paciente, guia e o próprio botão de conferir. */}
      <div className="flex items-baseline gap-3 lg:contents">
        <span className="shrink-0 text-sm font-semibold text-slate-700 tabular-nums lg:w-16 lg:py-3.5">
          {formatarDia(item.data_atendimento)}
        </span>
        <span className="shrink-0 text-sm text-slate-500 tabular-nums lg:w-14">
          {item.hora_inicial?.slice(0, 5) ?? '—'}
        </span>
      </div>

      <div className="min-w-0 lg:flex-1">
        <p className="truncate text-sm font-medium text-slate-800">{item.paciente_nome ?? '—'}</p>
        <p className="truncate text-xs text-slate-500">{item.terapias ?? '—'}</p>
      </div>

      <div className="hidden lg:block lg:w-44 lg:shrink-0">
        <p className="truncate text-sm text-slate-600">{item.criado_por ?? '—'}</p>
        <p className="text-xs text-slate-500">Solicitou</p>
      </div>

      {/* No celular a identificação do papel e a ação dividem a última faixa;
          no desktop `lg:contents` devolve as duas a colunas independentes. */}
      <div className="flex items-center justify-between gap-3 lg:contents">
        {/* Guia primeiro: é a chave de conferência contra o papel; o token é o
            detalhe que a acompanha. Sem token, a forma de validação explica a
            ausência — e só quando não há explicação nenhuma é que o alerta
            vermelho aparece. */}
        <div className="min-w-0 lg:w-52 lg:shrink-0 lg:text-right">
          <p className="text-sm font-semibold text-slate-800 tabular-nums">
            <span className="mr-1 text-[11px] font-medium text-slate-500">Guia</span>
            {item.guia ?? '—'}
          </p>
          {item.token ? (
            <p className="font-mono text-[11px] text-slate-600 tabular-nums">
              <span className="mr-1 font-sans text-slate-500">Token</span>
              {item.token}
            </p>
          ) : erroReconhecimentoFacial(item.forma_autorizacao) ? (
            <p className="text-[11px] whitespace-nowrap text-slate-600">{LABEL_ERRO_FACIAL}</p>
          ) : (
            /* Rosa é a anomalia real: nem filipeta nem erro facial explica esta
               linha. -700 e não -600 pela regra que o SituacaoBadge já fixa
               (texto sempre no passo -700): -600 passava raspando, 4,53:1 sobre
               a linha âmbar. */
            <p className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700">
              <AlertTriangle size={10} />
              Sem token
            </p>
          )}
        </div>

        {/* Caixa de marcação, não botão preenchido.

            A tarefa é bater uma pilha de papel contra a lista, item por item —
            isso é uma checagem, e a caixinha diz isso sozinha. Como bloco
            colorido de 128x44 repetido em toda linha, a coluna virava uma
            parede que competia com a própria tinta de estado da linha (âmbar
            sobre âmbar) em vez de indicar onde clicar.

            O alvo de toque continua 44px: a área clicável é a `h-11` inteira,
            só o desenho é que encolheu para 18px. E `lg:w-32` mantém a coluna
            alinhada com o resto da linha no desktop. */}
        <button
          onClick={() => onToggle(item)}
          disabled={ocupado}
          aria-pressed={conferido}
          aria-label={
            conferido
              ? `Conferida${item.token_conferido_por_nome ? ` por ${item.token_conferido_por_nome}` : ''} — desmarcar`
              : `Marcar como conferida a guia ${item.guia ?? 'sem número'}`
          }
          title={
            conferido
              ? `Conferida${item.token_conferido_por_nome ? ` por ${item.token_conferido_por_nome}` : ''}${item.token_conferido_em ? ` em ${formatarDataHora(item.token_conferido_em)}` : ''} — clique para desmarcar`
              : 'Marcar este papel como conferido'
          }
          className="group inline-flex h-11 shrink-0 items-center justify-start gap-2 rounded-lg px-2 text-[11px] font-semibold transition focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none disabled:opacity-60 lg:w-32"
        >
          <span
            className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-[5px] border transition ${
              conferido
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-slate-500 bg-white group-hover:border-brand'
            }`}
          >
            {ocupado ? (
              <Loader2 size={11} className="animate-spin text-slate-600" />
            ) : conferido ? (
              <Check size={12} strokeWidth={3} />
            ) : null}
          </span>
          <span className={conferido ? 'text-emerald-700' : 'text-slate-600'}>
            {conferido ? 'Conferida' : 'A conferir'}
          </span>
        </button>
      </div>
    </li>
  )
})

export default function ModalTokenMensal({ open, onClose }: Props) {
  const [mesRef, setMesRef] = useState(() => primeiroDiaDoMes(new Date()))
  const [itens, setItens] = useState<TokenMensalItem[]>([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aba, setAba] = useState<Aba>('pendentes')
  const [busca, setBusca] = useState('')
  const [conferindoBloco, setConferindoBloco] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [montado, setMontado] = useState(false)

  useEffect(() => setMontado(true), [])

  // `useCallback` porque o hook depende da identidade de `aoFechar` para não
  // remontar o trap a cada render.
  const fechar = useCallback(() => onClose(), [onClose])
  const { refDialogo, propsDialogo } = useModalDialog(open && montado, fechar, 'titulo-conferencia-filipetas')

  // Estável de propósito: é a prop que sustenta o `memo` da LinhaConferencia.
  // Recriar a cada render faria toda linha re-renderizar a cada marcação, que
  // é exatamente o custo que o memo veio remover.
  const handleToggle = useCallback(async (item: TokenMensalItem) => {
    if (!item.bloco_id) return
    const alvo = item.bloco_id
    const proximo = !item.token_conferido
    setConferindoBloco(alvo)
    try {
      await marcarTokenConferido(alvo, proximo)
      setItens((prev) =>
        prev.map((i) =>
          i.bloco_id === alvo
            ? { ...i, token_conferido: proximo, token_conferido_em: proximo ? new Date().toISOString() : null }
            : i
        )
      )
    } catch {
      toast.error('Erro ao marcar conferência. Tente novamente.')
    } finally {
      setConferindoBloco(null)
    }
  }, [])

  async function carregar() {
    setLoading(true)
    setErro(null)
    try {
      const dados = await listarTokensMensal(paramMes(mesRef))
      setItens(dados)
    } catch {
      setErro('Não foi possível carregar as conferências deste mês.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mesRef])

  // A pilha de filipetas da recepção é conferida em ordem alfabética,
  // independentemente da data e do horário da sessão.
  const ordenados = useMemo(
    () =>
      [...itens].sort((a, b) =>
        (a.paciente_nome ?? '').localeCompare(b.paciente_nome ?? '', 'pt-BR')
      ),
    [itens]
  )

  // A busca recorta a base inteira — contagens das abas e progresso acompanham,
  // como os KPIs da página acompanham o filtro de paciente.
  const base = useMemo(() => {
    const termo = normalizar(busca.trim())
    if (!termo) return ordenados
    return ordenados.filter((i) =>
      // A forma entra no lastro para que a linha de erro facial seja
      // encontrável pelo texto que ela mostra no lugar do número.
      [i.paciente_nome, i.guia, i.token, i.forma_autorizacao].some(
        (campo) => campo && normalizar(campo).includes(termo)
      )
    )
  }, [ordenados, busca])

  const conferidas = useMemo(() => base.filter((i) => i.token_conferido), [base])
  const pendentes = useMemo(() => base.filter((i) => !i.token_conferido), [base])

  const visiveis = aba === 'pendentes' ? pendentes : aba === 'conferidas' ? conferidas : base

  // Copia exatamente o que a aba está mostrando, na mesma ordem da lista —
  // inclusive já recortado pela busca.
  async function copiarVisiveis() {
    if (visiveis.length === 0) return
    const texto = montarTextoConferencia(visiveis, {
      labelMes: mesRef
        .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
        .replace(/^\w/, (c) => c.toUpperCase()),
      aba,
      busca,
    })
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
      toast.success(`${visiveis.length} registro(s) copiado(s)`)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      toast.error('Não foi possível copiar. Verifique a permissão do navegador.')
    }
  }

  const total = base.length
  const totalMes = ordenados.length
  const buscando = busca.trim().length > 0
  const progresso = total > 0 ? Math.round((conferidas.length / total) * 100) : 0

  if (!open || !montado) return null

  const labelMes = mesRef
    .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    .replace(/^\w/, (c) => c.toUpperCase())

  const abas: { id: Aba; label: string; count: number }[] = [
    { id: 'pendentes', label: 'Pendentes', count: pendentes.length },
    { id: 'conferidas', label: 'Conferidas', count: conferidas.length },
    { id: 'todas', label: 'Todas', count: total },
  ]

  // Portal para document.body: o card de filtros que renderiza este modal tem
  // backdrop-blur, e backdrop-filter cria containing block para descendentes
  // `fixed` — sem o portal, o inset-0 se ancora na barra de filtros (~70px de
  // altura) em vez da viewport, e o modal colapsa.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={refDialogo}
        {...propsDialogo}
        className="motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-150 flex h-[94dvh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Estado da carga anunciado para leitor de tela. O PRODUCT.md pede
            explicitamente que carregamento, erro e contagem de resultados
            saiam por aria-live — a lista sozinha muda em silêncio quando se
            filtra, busca ou marca uma conferência. */}
        <p className="sr-only" role="status" aria-live="polite">
          {loading
            ? 'Carregando conferências do mês.'
            : erro
              ? erro
              : `${total} conferência(s) em ${labelMes}. ${conferidas.length} conferida(s), ${pendentes.length} pendente(s). Exibindo ${visiveis.length} na aba ${aba}.`}
        </p>

        {/* Header */}
        <div className="flex items-start justify-between px-4 pt-5 pb-4 sm:px-8 sm:pt-6 sm:pb-5">
          <div>
            <h2
              id="titulo-conferencia-filipetas"
              className="flex items-center gap-2 text-lg font-semibold text-slate-900"
            >
              <KeySquare size={19} className="text-brand" />
              Conferência de filipetas
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Atendimentos do mês com filipeta ou erro de reconhecimento facial. Marque cada papel conferido.
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
            aria-label="Fechar"
          >
            <X size={20} />
          </button>
        </div>

        {/* Mês + progresso da conferência */}
        {/* No celular o seletor de mês e o progresso não cabem lado a lado — a
            contagem era cortada em "3/10 confe…". Empilham abaixo de sm. */}
        <div className="flex flex-col gap-2 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:gap-6 sm:px-8 sm:py-4">
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => setMesRef((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
              aria-label="Mês anterior"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="w-36 text-center text-sm font-semibold text-slate-700">{labelMes}</span>
            <button
              onClick={() => setMesRef((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
              aria-label="Próximo mês"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {!loading && !erro && total > 0 && (
            /* A barra inteira é o mês: o que sobrou é âmbar, o que foi conferido
               é esmeralda. Não há trilho neutro porque não há terceiro estado. */
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div
                className="h-2 flex-1 overflow-hidden rounded-full bg-amber-100"
                role="progressbar"
                aria-valuenow={progresso}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${conferidas.length} de ${total} conferidas`}
              >
                <div
                  className="h-full rounded-full bg-emerald-600 transition-[width] duration-300 motion-reduce:transition-none"
                  style={{ width: `${progresso}%` }}
                />
              </div>
              {/* Zerar a pendência é o objetivo do modal, então o contador
                  fecha em esmeralda quando chega lá — mesmo eixo, não enfeite. */}
              <span
                className={`shrink-0 text-sm font-semibold whitespace-nowrap tabular-nums ${
                  progresso === 100 ? 'text-emerald-700' : 'text-slate-700'
                }`}
              >
                {conferidas.length}/{total} conferidas
              </span>
            </div>
          )}
        </div>

        {/* Abas + busca */}
        {!loading && !erro && totalMes > 0 && (
          <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:px-8">
            <div className="flex flex-1 flex-wrap gap-1.5">
              {abas.map((a) => {
                const ativa = aba === a.id
                const tom = ABA_TOM[a.id]
                return (
                  <button
                    key={a.id}
                    onClick={() => setAba(a.id)}
                    aria-pressed={ativa}
                    className={`inline-flex h-11 items-center rounded-lg border px-3.5 text-sm font-semibold transition focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none ${ativa ? tom.ativa : tom.inativa}`}
                  >
                    {a.label}
                    {/* Sem `opacity`: a contagem é o dado que decide para onde
                        ir, e opacidade sobre texto colorido derruba o contraste
                        abaixo do AA. O peso já separa rótulo de número. */}
                    <span className="ml-1.5 font-medium tabular-nums">{a.count}</span>
                  </button>
                )
              })}
            </div>

            {/* Copiar o que está em tela. Fica ao lado da busca porque copia o
                recorte que abas e busca produziram, não o mês inteiro. */}
            <button
              type="button"
              onClick={copiarVisiveis}
              disabled={visiveis.length === 0}
              title={`Copiar ${visiveis.length} registro(s) desta aba para colar no ClickUp`}
              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-700 transition hover:border-brand hover:bg-brand-hover hover:text-brand-fg focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none disabled:opacity-50 disabled:hover:border-slate-300 disabled:hover:bg-white disabled:hover:text-slate-700"
            >
              {copiado ? (
                <ClipboardCheck size={14} className="text-emerald-600" />
              ) : (
                <Copy size={14} />
              )}
              {copiado ? 'Copiado' : 'Copiar'}
              <span className="font-medium tabular-nums">{visiveis.length}</span>
            </button>

            <div className="relative w-full shrink-0 sm:w-72">
              <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-500" />
              <input
                // `type="text"`, não `search`: o Chrome desenha o próprio X e
                // ficariam dois botões de limpar lado a lado.
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Paciente, guia ou token"
                aria-label="Buscar por paciente, guia ou token"
                className="h-11 w-full rounded-lg border border-slate-200 bg-white pr-11 pl-9 text-sm text-slate-700 placeholder:text-slate-500 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
              />
              {buscando && (
                <button
                  type="button"
                  onClick={() => setBusca('')}
                  aria-label="Limpar busca"
                  className="absolute top-1/2 right-0 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Lista */}
        <div className="flex-1 overflow-y-auto border-t border-slate-100 bg-slate-50 px-3 py-4 sm:px-7">
          {loading && (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl bg-white" />
              ))}
              <p className="pt-3 text-center text-xs text-slate-500">
                Consultando o mês inteiro — isso pode levar alguns segundos.
              </p>
            </div>
          )}

          {!loading && erro && (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
              <AlertTriangle size={24} className="text-rose-600" />
              <div>
                <p className="text-sm font-medium text-slate-700">{erro}</p>
                <p className="text-xs text-slate-500">A consulta do mês inteiro pode demorar sob carga.</p>
              </div>
              <button
                onClick={carregar}
                className="mt-1 inline-flex h-11 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 transition hover:border-brand hover:bg-brand-hover hover:text-brand-fg focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <RefreshCw size={13} />
                Tentar novamente
              </button>
            </div>
          )}

          {!loading && !erro && totalMes === 0 && (
            <div className="flex flex-col items-center justify-center gap-1 py-20 text-center">
              <KeySquare size={22} className="text-slate-400" />
              <p className="text-sm font-medium text-slate-600">Nada para conferir neste mês</p>
              <p className="text-xs text-slate-500">
                Nenhuma filipeta nem erro de reconhecimento facial em {labelMes}.
              </p>
            </div>
          )}

          {!loading && !erro && totalMes > 0 && total === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
              <Search size={22} className="text-slate-400" />
              <div>
                <p className="text-sm font-medium text-slate-600">Nenhum resultado para “{busca.trim()}”</p>
                <p className="text-xs text-slate-500">
                  {totalMes} conferência(s) em {labelMes} — nenhuma bate com paciente, guia ou token.
                </p>
              </div>
              <button
                onClick={() => setBusca('')}
                className="mt-1 inline-flex h-11 items-center rounded-xl border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 transition hover:border-brand hover:bg-brand-hover hover:text-brand-fg focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                Limpar busca
              </button>
            </div>
          )}

          {!loading && !erro && total > 0 && visiveis.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-1 py-20 text-center">
              <Check size={22} className="text-emerald-600" />
              <p className="text-sm font-medium text-slate-600">
                {aba === 'pendentes' ? 'Tudo do mês já foi conferido' : 'Nada conferido ainda'}
              </p>
              <p className="text-xs text-slate-500">
                {aba === 'pendentes' ? `${total} de ${total} em ${labelMes}.` : 'Comece pela aba Pendentes.'}
              </p>
            </div>
          )}

          {!loading && !erro && visiveis.length > 0 && (
            <ul className="space-y-1.5">
              {visiveis.map((item) => (
                <LinhaConferencia
                  key={item.bloco_id}
                  item={item}
                  ocupado={conferindoBloco === item.bloco_id}
                  onToggle={handleToggle}
                />
              ))}
            </ul>
          )}
        </div>

      </div>
    </div>,
    document.body
  )
}
