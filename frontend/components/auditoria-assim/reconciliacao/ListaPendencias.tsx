'use client'

import { useMemo, useState } from 'react'
import {
  AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, RefreshCw, Search, X,
} from 'lucide-react'
import { DatePicker } from '@/components/ui/date-picker'
import Paginacao from '../Paginacao'
import type { PacientePendencias, TipoPendencia } from '../types'
import { PENDENCIAS } from './pendencias'
import { formatarDia, normalizar } from './datas'

const PAGE_SIZE = 20

/**
 * Um badge da linha: o número e a palavra, nesta ordem.
 *
 * O número vem PRIMEIRO, como no chip logo acima ("3 Glosas"): as duas fileiras
 * dizem a mesma coisa, e invertê-las obrigaria o olho a ler cada badge em duas
 * direções conforme a altura da tela. Com o número à esquerda ele cai sempre na
 * borda do badge, que é o que permite varrer a coluna pelos algarismos em vez de
 * ler cada rótulo.
 *
 * A palavra é a do chip, nunca uma abreviação: a tabela anterior escrevia
 * "Cancel." no cabeçalho e "Cancelamentos" no chip que filtrava aquela mesma
 * coluna, duas palavras para uma espécie na mesma tela.
 *
 * A base traz só a LARGURA da borda; a cor vem inteira de `tom`, porque duas
 * classes de `border-color` no mesmo elemento se decidem pela ordem do CSS
 * gerado, não pela ordem no `className` — ver a nota em `pendencias.ts`.
 */
function Badge({ rotulo, valor, tom, ajuda }: {
  rotulo: string
  valor: number
  tom: string
  ajuda?: string
}) {
  return (
    <span
      title={ajuda}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs leading-4 font-medium ${tom}`}
    >
      <span className="font-semibold tabular-nums">{valor}</span>
      {rotulo}
    </span>
  )
}

/**
 * Uma linha da listagem — um paciente, três zonas, uma faixa só.
 *
 * A linha era uma `<tr>` de nove colunas, cinco delas ocupadas por um número
 * que na esmagadora maioria das vezes era zero. O olho varria 180 células para
 * achar as poucas com valor, e a tela lia planilha. Aqui a ausência não ocupa
 * espaço: só a espécie que tem valor ganha um badge, e a linha vazia de
 * pendência diz isso por extenso em vez de alinhar cinco zeros.
 *
 * Tudo mora numa faixa horizontal: nome e matrícula lado a lado, plano e
 * unidade lado a lado, badges. Empilhar matrícula sob o nome dobrava a altura
 * de toda linha para caber um dado que quase nunca é lido — e com a identidade
 * numa linha só, deixar plano/unidade em duas deixaria a zona da esquerda
 * flutuando no meio de um bloco alto. Uma faixa, um ritmo.
 *
 * A altura NÃO cai junto: `py-3` sobre uma faixa de 20px mantém o alvo de
 * clique nos 44px que o DESIGN.md exige de tudo que se toca. O que se ganha é
 * densidade real (mais pacientes por tela), não linhas finas demais para o dedo.
 *
 * As zonas seguem a prioridade da leitura, não a ordem dos dados — nome,
 * pendência, plano/unidade —, e é essa ordem que a grade reproduz quando quebra
 * no celular.
 *
 * Sem pílula de total (2026-08-27, revertido — chegou a existir uma pílula
 * contornada somando as espécies). Reportado da tela: o número não batia com o
 * que estava ao lado dele, porque `total` deliberadamente não soma cancelamento
 * (ver `contarPendencias`) — "2 Pendências · 1 Glosas · 1 Cancelamentos" lia
 * como conta errada. Cada espécie diz o próprio número; a soma não aparece em
 * nenhum paciente.
 */
function LinhaPaciente({ paciente, onAbrir }: {
  paciente: PacientePendencias
  onAbrir: (paciente: PacientePendencias) => void
}) {
  const especies = PENDENCIAS.filter((e) => paciente.contagem[e.chave] > 0)
  const carteirinha = paciente.carteirinhas[0] ?? 'sem carteirinha'
  const extras = paciente.carteirinhas.length - 1

  return (
    <li>
      <button
        type="button"
        onClick={() => onAbrir(paciente)}
        aria-label={`${paciente.nome} — ${paciente.contagem.total} ${
          paciente.contagem.total === 1 ? 'pendência' : 'pendências'
        }. Abrir a semana.`}
        // A faixa de plano/unidade tem largura FIXA, e é ela que mantém a
        // listagem alinhada sem voltar a ser tabela: cada linha é uma grade
        // independente, então uma coluna em `fr` ou `auto` se resolve pelo
        // conteúdo DAQUELA linha — medido, o plano dançava 24px de uma linha
        // para a outra conforme o vizinho fosse mais curto ou mais longo. Com
        // ela fixa, o resto que sobra é o mesmo em toda linha e as duas colunas
        // em `fr` caem no mesmo lugar.
        className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 text-left transition hover:bg-brand-hover focus-visible:bg-brand-hover focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset focus-visible:outline-none md:grid-cols-[minmax(0,1.5fr)_11rem_minmax(0,1.6fr)_auto]"
      >
        {/* Identidade — nome e matrícula na mesma linha, separados por peso e
            tamanho em vez de por quebra. `baseline` para que os dois assentem
            sobre a mesma reta apesar dos 3px de diferença de corpo.
            A matrícula é `shrink-0`: um número de carteirinha cortado no meio
            não identifica ninguém, então quem cede é o nome — que ao menos
            continua reconhecível truncado, e chega inteiro pelo `title` e pelo
            rótulo do botão. É por isso que a coluna do nome é a mais larga da
            grade: é ela que paga essa conta. */}
        <span className="col-start-1 row-start-1 flex min-w-0 items-baseline gap-2">
          <span className="truncate text-md leading-tight font-semibold text-slate-900" title={paciente.nome}>
            {paciente.nome}
          </span>
          <span className="shrink-0 text-xs leading-tight tabular-nums text-slate-500">
            {carteirinha}
            {extras > 0 && ` +${extras}`}
          </span>
        </span>

        {/* Pendências — a segunda leitura, e no celular a segunda linha.

            SEM a pílula de total (2026-08-27, reportado da tela: "não quero
            esse badge de total... em nenhum paciente"). Cada espécie já diz o
            próprio número, e a soma era uma quinta leitura que ninguém pediu
            — inclusive porque `total` deliberadamente NÃO soma cancelamento
            (ver `contarPendencias`), então "2 Pendências" ao lado de "1
            Glosas · 1 Cancelamentos" já tinha gerado a pergunta de "por que
            não bate". Tirar a soma tira a pergunta. */}
        <span className="col-span-2 col-start-1 row-start-2 flex min-w-0 flex-wrap items-center gap-1 md:col-span-1 md:col-start-3 md:row-start-1">
          {especies.length === 0 ? (
            <span className="text-xs text-slate-500">sem pendências</span>
          ) : (
            especies.map((e) => (
              <Badge
                key={e.chave}
                rotulo={e.rotulo}
                valor={paciente.contagem[e.chave]}
                tom={e.badge}
                ajuda={e.ajuda}
              />
            ))
          )}
        </span>

        {/* Plano e unidade — a informação de menor prioridade, logo a última a
            aparecer quando a linha quebra. Um ponto médio os separa, como no
            resto da superfície. */}
        <span className="col-span-2 col-start-1 row-start-3 flex min-w-0 items-center gap-1.5 text-sm leading-tight md:col-span-1 md:col-start-2 md:row-start-1">
          <span className="truncate text-slate-600">{paciente.plano ?? '—'}</span>
          {/* `slate-300` mede 1,49:1 sobre branco — o mesmo valor que já havia
              sido recusado nesta tela para o número zero. Separador é enfeite
              para o leitor de tela (`aria-hidden`), mas para o olho ele tem uma
              tarefa, e a 1,49:1 ele não a cumpre. `slate-400` mede 2,6:1:
              visível, e ainda dois degraus atrás do texto que separa. */}
          <span className="shrink-0 text-slate-400" aria-hidden>·</span>
          <span className="truncate text-slate-500">{paciente.unidade ?? '—'}</span>
        </span>

        {/* A seta: o único sinal de que a linha vai a algum lugar. */}
        <ChevronRight
          size={16}
          aria-hidden
          className="col-start-2 row-start-1 shrink-0 justify-self-end text-slate-300 transition group-hover:text-brand-fg md:col-start-4"
        />
      </button>
    </li>
  )
}

type Props = {
  pacientes: PacientePendencias[]
  unidades: string[]
  mesRef: string
  mesFimEfetivo: string
  mesAtual: string
  podeAvancarMes: boolean
  carregando: boolean
  erro: string | null
  onMes: (delta: number) => void
  onIrParaMesData: (mes: string) => void
  onRecarregar: () => void
  onAbrir: (paciente: PacientePendencias) => void
}

/** "agosto de 2026" a partir de "2026-08-01". */
function rotuloMesLongo(mesIso: string): string {
  const [ano, mes] = mesIso.split('-').map(Number)
  return new Date(ano, (mes ?? 1) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

/**
 * Autorizações com pendências — a fila de trabalho do mês.
 *
 * A pergunta que a tela abre é "quem precisa de mim neste mês?" — mês fechado
 * é dia 1 ao último, mês vigente é dia 1 até hoje (2026-08-24: a listagem era
 * semanal; a auditoria do mês pedia navegar mês a mês, ordem alfabética e
 * paginação, não um ranking por volume de pendência). A listagem não é um
 * índice de guias soltas: é um paciente por linha, ordenado por nome, com as
 * espécies de pendência que ele TEM ditas por extenso, e o clique abre a
 * semana dele dentro do mês carregado (o modal continua semanal — é o que cabe
 * numa grade de horários × dias).
 *
 * Foi uma tabela de nove colunas até 2026-08-26, e cinco delas eram um número
 * que quase sempre valia zero: a tela lia planilha, e achar as poucas células
 * com valor era varrer uma malha. Agora a ausência não ocupa lugar — ver
 * `LinhaPaciente`.
 *
 * Cada espécie é também um chip no topo, e o chip filtra exatamente a espécie
 * que nomeia, pela MESMA palavra que o badge da linha usa — é o que permite ir
 * de "há trabalho" para "qual trabalho" sem sair da tela.
 *
 * A busca atravessa o filtro de pendência de propósito: quem digita um nome
 * está procurando uma pessoa específica, e escondê-la porque o mês dela está
 * limpo seria responder "não existe" a uma pergunta que era "como ela está".
 */
export default function ListaPendencias({
  pacientes, unidades, mesRef, mesFimEfetivo, mesAtual, podeAvancarMes, carregando, erro,
  onMes, onIrParaMesData, onRecarregar, onAbrir,
}: Props) {
  const [filtro, setFiltro] = useState<TipoPendencia | null>(null)
  const [unidade, setUnidade] = useState<string>('')
  const [busca, setBusca] = useState('')
  const [pagina, setPagina] = useState(1)

  // Trocar de mês, unidade, busca ou filtro reabre na primeira página — senão
  // a pessoa pode ficar numa página que não existe mais no recorte novo.
  // Ajustado durante o render (padrão recomendado pelo React para "resetar
  // estado quando uma prop muda"), não num efeito: um efeito disparando
  // setState síncrono aqui causaria uma renderização em cascata.
  const chaveRecorte = `${mesRef}|${unidade}|${busca}|${filtro ?? ''}`
  const [chaveRecorteAnterior, setChaveRecorteAnterior] = useState(chaveRecorte)
  if (chaveRecorteAnterior !== chaveRecorte) {
    setChaveRecorteAnterior(chaveRecorte)
    setPagina(1)
  }

  const naUnidade = useMemo(
    () => (unidade ? pacientes.filter((p) => p.unidade === unidade) : pacientes),
    [pacientes, unidade]
  )

  const comPendencia = useMemo(() => naUnidade.filter((p) => p.contagem.total > 0), [naUnidade])

  // Os chips somam DISCREPÂNCIAS, não pacientes: um paciente com 3 glosas conta
  // 3 no chip de Glosas. "Todas" soma `contagem.total`, que já deixa o
  // cancelamento de fora (ver `contarPendencias`).
  const contagemChips = useMemo(() => {
    const mapa = new Map<TipoPendencia, number>(PENDENCIAS.map((p) => [p.chave, 0]))
    for (const p of comPendencia) {
      for (const { chave } of PENDENCIAS) {
        mapa.set(chave, (mapa.get(chave) ?? 0) + p.contagem[chave])
      }
    }
    return mapa
  }, [comPendencia])

  const totalDiscrepancias = useMemo(
    () => comPendencia.reduce((soma, p) => soma + p.contagem.total, 0),
    [comPendencia]
  )

  const visiveis = useMemo(() => {
    const termo = normalizar(busca.trim())
    // Busca preenchida = universo inteiro do mês, inclusive quem está limpo.
    const base = termo ? naUnidade : filtro ? comPendencia.filter((p) => p.contagem[filtro] > 0) : comPendencia
    if (!termo) return base
    return base.filter((p) =>
      normalizar(`${p.nome} ${p.carteirinhas.join(' ')}`).includes(termo)
    )
  }, [naUnidade, comPendencia, filtro, busca])

  const totalPaginas = Math.max(1, Math.ceil(visiveis.length / PAGE_SIZE))
  const visiveisPagina = useMemo(
    () => visiveis.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE),
    [visiveis, pagina]
  )

  const buscando = busca.trim().length > 0
  const labelMes = `${formatarDia(mesRef)} a ${formatarDia(mesFimEfetivo)}/${mesFimEfetivo.slice(0, 4)}`

  return (
    <div className="flex flex-col gap-3">
      {/* ── Cabeçalho: mês, unidade, busca ──────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2.5">
        {/* `flex-wrap`: o botão "Mês atual" é `shrink-0` e o período é
            `nowrap`, então numa faixa rígida os dois somavam 369px numa tela de
            360 e era a PÁGINA que rolava de lado (medido em 320/344/360).
            Quebrando aqui, o botão desce sozinho e nada estoura. */}
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => onMes(-1)}
            aria-label="Mês anterior"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
          >
            <ChevronLeft size={16} />
          </button>

          {/* O mês é o rótulo E o seletor: o próprio texto é o gatilho do
              calendário padrão em modo mês. Um segundo controle ao lado diria a
              mesma coisa duas vezes. */}
          <DatePicker
            apenasMes
            value={mesRef}
            onChange={(v) => v && onIrParaMesData(v.slice(0, 7))}
            rotuloGatilho="Ir para outro mês"
            classeGatilho="relative flex h-11 items-center gap-2 rounded-lg px-2 text-left transition hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
            conteudoGatilho={<>
            <CalendarDays size={15} className="text-slate-400" aria-hidden />
            <span>
              {/* `capitalize` sobe a inicial de CADA palavra e escrevia "Agosto
                  De 2026". `first-letter` só pega em caixa de bloco — e esta
                  span já é `block`, então dispensa o `inline-block` que o mesmo
                  conserto exigiu em ModalSemanaPaciente. */}
              <span className="block text-sm leading-tight font-semibold text-slate-700 first-letter:uppercase">
                {rotuloMesLongo(mesRef)}
              </span>
              {/* `nowrap`: em 390px "01/08 a 26/08/2026" quebrava em duas
                  linhas e empurrava a barra inteira para baixo. */}
              <span className="block text-xs leading-tight tabular-nums whitespace-nowrap text-slate-500">
                {labelMes}
              </span>
            </span>
            </>}
          />

          <button
            type="button"
            onClick={() => onMes(1)}
            disabled={!podeAvancarMes}
            aria-label="Próximo mês"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronRight size={16} />
          </button>

          {mesRef !== mesAtual && (
            <button
              type="button"
              onClick={() => onIrParaMesData(mesAtual)}
              className="inline-flex h-11 shrink-0 items-center rounded-lg border border-slate-300 px-3 text-sm font-semibold whitespace-nowrap text-slate-600 transition hover:border-brand hover:bg-brand-hover hover:text-brand-fg focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              Mês atual
            </button>
          )}
        </div>

        {/* No celular os três controles compartilham a linha em vez de a busca
            tomar a largura toda e empurrar seletor e refresh para linhas
            próprias — três faixas de um controle cada. */}
        <div className="flex flex-1 flex-wrap items-center gap-2 sm:justify-end">
          <label className="flex items-center gap-2">
            <span className="sr-only">Unidade</span>
            <select
              value={unidade}
              onChange={(e) => setUnidade(e.target.value)}
              className="h-11 rounded-lg border border-slate-300 bg-white px-2.5 text-md text-slate-700 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
            >
              <option value="">Todas as unidades</option>
              {unidades.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </label>

          <div className="relative min-w-40 flex-1 sm:max-w-64 sm:flex-none sm:basis-64">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar paciente…"
              aria-label="Buscar paciente por nome ou carteirinha"
              className="h-11 w-full rounded-lg border border-slate-300 pr-11 pl-9 text-md text-slate-700 placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
            />
            {busca && (
              <button
                type="button"
                onClick={() => setBusca('')}
                aria-label="Limpar a busca"
                // 44x44 encostado na borda, e o `pr-11` do input reserva
                // exatamente esta largura: o texto digitado para onde o botão
                // começa. Era 36x36 com `right-1`, abaixo do piso de toque.
                className="absolute top-1/2 right-0 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:text-slate-700"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onRecarregar}
            disabled={carregando}
            aria-label="Atualizar o mês"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-300 text-slate-600 transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none disabled:opacity-60"
          >
            <RefreshCw size={15} className={carregando ? 'animate-spin' : ''} aria-hidden />
          </button>
        </div>
      </div>

      {/* ── Chips: quantas discrepâncias de cada espécie há no mês ─────────── */}
      {/* Os contadores das chips vivem FORA do ramo do esqueleto, então eles
          pintavam número parcial mesmo com o esqueleto na tela — a outra metade
          do defeito relatado ("pisca e traz os valores reais"). Enquanto carrega
          eles mostram "—": o traço não é ausência de dado, é a recusa de afirmar
          um número que vai mudar. A largura da chip fica estável e nada salta
          quando o valor chega. */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setFiltro(null)}
          aria-pressed={filtro === null}
          className={`flex h-11 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none ${
            filtro === null
              ? 'border-brand bg-brand-surface text-brand-fg'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          <span className="font-semibold tabular-nums">
            {carregando ? '—' : totalDiscrepancias}
          </span>
          Todas
        </button>

        {PENDENCIAS.map(({ chave, rotulo, Icone, ativo, inativo, ajuda }) => {
          const n = contagemChips.get(chave) ?? 0
          const selecionado = filtro === chave
          return (
            <button
              key={chave}
              type="button"
              title={ajuda}
              onClick={() => setFiltro(selecionado ? null : chave)}
              aria-pressed={selecionado}
              // Zero continua visível e clicável: "nenhuma glosa neste mês" é
              // informação, e esconder o contador faria a ausência parecer com a
              // tela ainda carregando. O atenuado do zero também espera o
              // carregamento — atenuar por um zero que ainda vai mudar diria
              // "não há nada aqui" antes de a tela saber.
              className={`flex h-11 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none ${
                selecionado ? ativo : inativo
              } ${!carregando && n === 0 && !selecionado ? 'opacity-60' : ''}`}
            >
              <Icone size={13} aria-hidden />
              <span className="font-semibold tabular-nums">{carregando ? '—' : n}</span>
              {rotulo}
            </button>
          )
        })}

        <span className="ml-auto text-sm text-slate-500" role="status" aria-live="polite">
          {carregando
            ? 'carregando o mês…'
            : buscando
              ? `${visiveis.length} ${visiveis.length === 1 ? 'paciente' : 'pacientes'} na busca`
              : `${visiveis.length} de ${comPendencia.length} com pendência`}
        </span>
      </div>

      {/* ── Listagem ───────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {erro ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <AlertTriangle size={24} className="text-rose-600" aria-hidden />
            <p className="text-sm font-medium text-slate-700">{erro}</p>
            <button
              onClick={onRecarregar}
              className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 transition hover:border-brand hover:bg-brand-hover hover:text-brand-fg focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <RefreshCw size={13} aria-hidden />
              Tentar novamente
            </button>
          </div>
        ) : /*
             Gate SÓ em `carregando` (2026-08-27, reportado da tela).

             Havia um `&& pacientes.length === 0` aqui, e ele produzia o defeito
             relatado: "a página renderiza os pacientes com valores totais, depois
             pisca e traz os valores reais". As quatro cargas do mês correm em
             paralelo e `pacientesDoMes` fica não-vazio assim que UMA chega — as
             autorizações vêm numa requisição, as sessões em lotes de 6 dias. Com
             a lista já não-vazia o esqueleto saía de cena e a tela pintava com
             `agendadas = 0`, o que faz toda guia liberada parecer excedente, zera
             "Não solicitada" e não desconta a glosa que um vínculo cobriu. Depois
             as sessões chegavam e cada número se corrigia na frente de quem lia.

             A metade `pacientes.length === 0` existia por um motivo real: as
             quatro flags nasciam `false`, então no primeiro render `loading` era
             falso e o esqueleto não aparecia na abertura. Isso foi corrigido na
             origem — elas nascem `true` (ver `useAnaliseReincidencia`) —, e o
             gate volta a ser o que a nota de `loading` sempre descreveu.
           */
        carregando ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : visiveis.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1.5 py-20 text-center">
            <CheckCircle2 size={24} className="text-emerald-500" aria-hidden />
            <p className="text-sm font-semibold text-slate-700">
              {buscando
                ? 'Nenhum paciente com esse nome neste mês'
                : filtro
                  ? 'Nada nesta espécie de pendência'
                  : 'Mês limpo'}
            </p>
            <p className="max-w-md text-xs text-slate-500">
              {buscando
                ? 'A busca cobre o mês inteiro, não só quem tem pendência.'
                : filtro
                  ? 'Limpe o filtro para ver as outras pendências do mês.'
                  : `Nenhum cancelamento, glosa ou divergência de cota entre ${labelMes}.`}
            </p>
          </div>
        ) : (
          // Lista, não tabela — e por isso sem `overflow-x-auto` nenhum. A
          // tabela anterior tinha nove colunas e um `min-w-248` que, medido em
          // 390px, escapava do contêiner e fazia a PÁGINA rolar de lado; a
          // defesa era um `relative` e uma primeira coluna grudada. Uma linha
          // que reflui não precisa de nenhum dos três: nada aqui tem largura
          // mínima maior que a tela.
          <ul className="divide-y divide-slate-100">
            {visiveisPagina.map((p) => (
              <LinhaPaciente key={p.chave} paciente={p} onAbrir={onAbrir} />
            ))}
          </ul>
        )}
      </div>

      <Paginacao
        pagina={pagina}
        totalPaginas={totalPaginas}
        totalFiltrados={visiveis.length}
        onChange={setPagina}
        rotuloItem={visiveis.length === 1 ? 'paciente' : 'pacientes'}
      />
    </div>
  )
}
