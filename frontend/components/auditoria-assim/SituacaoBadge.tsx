import type { ReactNode } from 'react'
import {
  AlertCircle,
  AlertOctagon,
  Ban,
  CalendarX,
  CheckCircle2,
  Clock,
  RefreshCw,
  UserX,
  XCircle,
  type LucideIcon,
} from 'lucide-react'

/**
 * Vocabulário de situação da auditoria ASSIM.
 *
 * Um matiz = um significado. A ordem das entradas segue a `prioridade` que a
 * própria RPC devolve (1 = mais urgente), porque é ela que ordena a tela — a
 * cor codifica a mesma severidade que a lista já usa, em vez de ser arbitrária.
 *
 * Regras que este arquivo mantém:
 *
 * - Nenhum estado repete o par (fundo, texto) de outro. Antes, NAO_SOLICITADA e
 *   FALTA_TERAPEUTA eram os dois `red-50 / red-600 / ring-red-300`, distintos só
 *   por um dot red-600 vs red-500 — dois significados com a mesma aparência.
 * - As faltas não disputam a régua de autorização: sessão que não aconteceu é
 *   outra categoria, então vive em stone (fora da escala) e se diferencia pelo
 *   dot — âmbar quando a falta é do terapeuta, porque aí é lacuna de escala
 *   nossa, não do paciente.
 * - Texto em `-700` sobre fundo `-50`, nunca `-600`. A 11px o par -600/-50 fica
 *   entre 3.4:1 e 3.9:1 e reprova no AA (4.5:1). Medidos aqui: rose 6.5:1,
 *   violet 7.5:1, amber 5.5:1, sky 6.3:1, slate 6.9:1, emerald 6.4:1,
 *   stone 7.3:1. Os dois pares fora dessa régua são da família rose e passam no
 *   AA pela mesma medida: SOLICITACAO_CANCELADA em rose-800/rose-100 (6.7:1) e
 *   CANCELADA em rose-700/rose-100 (5.2:1).
 * - **Rose é a família da AÇÃO "vá buscar autorização"**, e por isso tem três
 *   entradas onde os outros matizes têm uma. NAO_SOLICITADA nunca começou,
 *   SOLICITACAO_CANCELADA quebrou no meio, CANCELADA saiu e foi desfeita — o
 *   enredo é outro, a resposta exigida é a mesma, e pintá-las de matizes
 *   diferentes afirmaria que pedem coisas diferentes. Dentro da família quem
 *   separa é o ícone (AlertCircle / AlertOctagon / Ban) e o rótulo.
 * - Violeta é semântico (glosa) e só. Setas de ordenação e focus ring usam o
 *   steel da marca (--color-brand), não violeta — senão o mesmo matiz significa
 *   "glosa" numa célula e "foco" na de cima.
 * - A cor nunca é o único sinal: todo badge carrega rótulo em texto.
 *
 * `surface` é o mesmo matiz um degrau mais fraco, para quando a situação
 * precisa tingir um contêiner inteiro em vez de um pill — o cabeçalho do
 * ModalDetalhamentoAtendimento e o bloco de status da listagem. Fica aqui, e
 * não nos consumidores, porque é o mesmo vocabulário: se um estado novo entrar,
 * ele nasce com todas as formas ou com nenhuma.
 *
 * `strong` e `icon` existem só para a terceira forma (`SituacaoBloco`), em que a
 * situação é o elemento de maior destaque da linha e por isso o rótulo é lido
 * no próprio matiz em cima de `surface` — é o mesmo par -700/-50 já medido acima
 * (≥5.5:1), não uma cor nova. Fora do bloco, `surface` continua sendo tinta de
 * fundo e o que se lê em cima dela é slate. A barra lateral do bloco reusa
 * `dot`: é o mesmo acento que diferencia FALTA de FALTA_TERAPEUTA no pill, então
 * a distinção sobrevive nas duas formas.
 */
type SituacaoConfigEntry = {
  label: string
  dot: string
  className: string
  surface: string
  strong: string
  icon: LucideIcon
}

export const SITUACAO_CONFIG: Record<string, SituacaoConfigEntry> = {
  // prioridade 1 — nada foi enviado; a lacuna mais urgente
  NAO_SOLICITADA: {
    label: 'Não Solicitada',
    dot: 'bg-rose-500',
    className: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
    surface: 'bg-rose-50 border-rose-200',
    strong: 'text-rose-700',
    icon: AlertCircle,
  },
  // prioridade 1 — houve tentativa e ela quebrou (aba da ASSIM fechada no meio
  // da identificação, envio não concluído, solicitação cancelada). Mesma régua
  // de NAO_SOLICITADA porque a ação exigida é a mesma — solicitar de novo — e
  // por isso o mesmo matiz, um degrau mais firme para não ser o mesmo estado.
  // O par (rose-100, rose-800) não se repete em nenhuma outra entrada, e o
  // ícone octogonal separa "quebrou no meio" de "nunca começou".
  SOLICITACAO_CANCELADA: {
    label: 'Solicitação Cancelada',
    dot: 'bg-rose-600',
    className: 'bg-rose-100 text-rose-800 ring-1 ring-rose-300',
    surface: 'bg-rose-100/70 border-rose-300',
    strong: 'text-rose-800',
    icon: AlertOctagon,
  },
  // prioridade 2 — recusa financeira; exige tratativa, não reenvio
  GLOSA: {
    label: 'Glosa',
    dot: 'bg-violet-500',
    className: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
    surface: 'bg-violet-50 border-violet-200',
    strong: 'text-violet-700',
    icon: XCircle,
  },
  // prioridade 6 — a ASSIM recusou E uma autorização externa passou a cobrir a
  // sessão (aba Reconciliação). Não pede nada: existe guia liberada.
  //
  // A composição diz as duas coisas de uma vez, e é por isso que ela não é só
  // "mais um verde": superfície esmeralda porque está resolvido, dot violeta
  // porque o que foi resolvido foi uma GLOSA. O violeta segue reservado à glosa
  // (ver a nota do topo) — aqui ele aparece como marca de procedência, não como
  // o matiz do estado. No SituacaoBloco esse dot vira a barra lateral, e a linha
  // fica lida como "resolvido, era glosa" sem depender de cor sozinha: o
  // CheckCircle2 carrega o mesmo significado.
  //
  // Degraus -50/-200/-700 e dot -500: os que o shim de tema escuro remapeia.
  GLOSA_RESOLVIDA: {
    label: 'Glosa Resolvida',
    dot: 'bg-violet-500',
    className: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    surface: 'bg-emerald-50 border-emerald-200',
    strong: 'text-emerald-700',
    icon: CheckCircle2,
  },
  // prioridade 3 — enviado, sem resposta da ASSIM
  RETORNO_NAO_CONFIRMADO: {
    label: 'Retorno Não Confirmado',
    dot: 'bg-amber-500',
    className: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    surface: 'bg-amber-50 border-amber-200',
    strong: 'text-amber-700',
    icon: Clock,
  },
  // alias legado — removível após migration aplicada
  AGUARDANDO_RETORNO: {
    label: 'Retorno Não Confirmado',
    dot: 'bg-amber-500',
    className: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    surface: 'bg-amber-50 border-amber-200',
    strong: 'text-amber-700',
    icon: Clock,
  },
  // prioridade 4 — em trânsito
  SINCRONIZANDO: {
    label: 'Sincronizando',
    dot: 'bg-sky-500',
    className: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
    surface: 'bg-sky-50 border-sky-200',
    strong: 'text-sky-700',
    icon: RefreshCw,
  },
  // prioridade 5 — a ASSIM DESFEZ a liberação (`status = 'Liberado *'`)
  //
  // Vivia em slate-100/slate-600 — o par exato de SITUACAO_FALLBACK, que
  // significa "situação nula ou fora do vocabulário". Um estado real, acionável
  // e que deixa a sessão descoberta estava pintado como "não sabemos o que é
  // isto", e slate lê como inerte: quem varria a grade passava por ela.
  //
  // Rose, e não um matiz novo, porque rose codifica a AÇÃO e não o enredo:
  // "nada cobre esta sessão, vá buscar autorização". É a mesma família de
  // NAO_SOLICITADA (nunca começou) e SOLICITACAO_CANCELADA (quebrou no meio) —
  // aqui, saiu e foi desfeita. Terceiro par da família, distinto dos dois
  // (rose-100/rose-700, 5.2:1) e separado deles pelo ícone e pelo rótulo.
  CANCELADA: {
    label: 'Cancelada',
    dot: 'bg-rose-600',
    className: 'bg-rose-100 text-rose-700 ring-1 ring-rose-300',
    surface: 'bg-rose-50 border-rose-300',
    strong: 'text-rose-700',
    icon: Ban,
  },
  // prioridade 6 — autorizado
  LIBERADA: {
    label: 'Liberada',
    dot: 'bg-emerald-500',
    className: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    surface: 'bg-emerald-50 border-emerald-200',
    strong: 'text-emerald-700',
    icon: CheckCircle2,
  },
  // fora da régua de autorização — a sessão não aconteceu
  FALTA: {
    label: 'Falta',
    dot: 'bg-stone-400',
    className: 'bg-stone-100 text-stone-600 ring-1 ring-stone-300',
    surface: 'bg-stone-50 border-stone-200',
    strong: 'text-stone-600',
    icon: UserX,
  },
  FALTA_TERAPEUTA: {
    label: 'Falta Terapeuta',
    dot: 'bg-amber-500',
    className: 'bg-stone-100 text-stone-700 ring-1 ring-stone-300',
    surface: 'bg-stone-50 border-stone-200',
    strong: 'text-stone-700',
    icon: UserX,
  },
  // fora da régua de autorização — a CLÍNICA não abriu, e ninguém faltou.
  //
  // Terceira entrada em stone pelo mesmo motivo das outras duas: sessão que não
  // aconteceu não disputa a escala de autorização. Quem separa dentro da família
  // é o dot e o ícone, como já separa FALTA de FALTA_TERAPEUTA — aqui o dot é
  // stone (nenhuma culpa a atribuir; o âmbar de FALTA_TERAPEUTA significa
  // "lacuna de escala nossa", e isto não é lacuna de ninguém) e o ícone é
  // CalendarX, o mesmo que a Central usa para este estado em severity.ts:171.
  //
  // O par (stone-100, stone-800) não se repete: FALTA é -600, FALTA_TERAPEUTA é
  // -700. Medido 8.9:1, acima dos 7.3:1 já registrados para a família.
  UNIDADE_FECHADA: {
    label: 'Unidade Fechada',
    dot: 'bg-stone-500',
    className: 'bg-stone-100 text-stone-800 ring-1 ring-stone-300',
    surface: 'bg-stone-50 border-stone-200',
    strong: 'text-stone-800',
    icon: CalendarX,
  },
}

/** Fallback dos dois consumidores: situação nula ou fora do vocabulário. */
export const SITUACAO_FALLBACK: Omit<SituacaoConfigEntry, 'label'> = {
  dot: 'bg-slate-400',
  className: 'bg-slate-100 text-slate-600 ring-1 ring-slate-300',
  surface: 'bg-slate-50 border-slate-200',
  strong: 'text-slate-600',
  icon: AlertCircle,
}

/**
 * Exportada porque a grade semanal precisa das MESMAS quatro formas (label,
 * surface, strong, icon) para vestir um cartão que não é pill nem bloco. Uma
 * quarta cópia do `?? fallback` é o jeito de um estado novo aparecer certo em
 * três lugares e cinza no quarto.
 */
export function resolverConfig(situacao: string): SituacaoConfigEntry {
  return SITUACAO_CONFIG[situacao] ?? { label: situacao, ...SITUACAO_FALLBACK }
}

export default function SituacaoBadge({ situacao }: { situacao: string | null }) {
  if (!situacao) return <span className="text-slate-400">—</span>

  const config = resolverConfig(situacao)

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap ${config.className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${config.dot}`} />
      {config.label}
    </span>
  )
}

/**
 * Terceira forma do vocabulário: a situação como bloco, para quando ela é o
 * elemento de maior destaque da linha (listagem da auditoria). Mesmo matiz do
 * pill — `surface` tinge o bloco, `dot` vira a barra lateral, `icon` repete o
 * significado sem depender de cor. `legenda` é a linha secundária (a fonte da
 * resposta ou o motivo real); `extra` recebe controles que pertencem ao estado,
 * como a conferência da filipeta.
 */
export function SituacaoBloco({
  situacao,
  legenda,
  extra,
}: {
  situacao: string | null
  legenda?: string | null
  extra?: ReactNode
}) {
  const config = resolverConfig(situacao ?? '—')
  const Icone = config.icon

  return (
    <div
      className={`relative flex min-h-11 items-center gap-2 overflow-hidden rounded-lg border py-1.5 pl-3 pr-2 ${config.surface}`}
    >
      <span aria-hidden className={`absolute inset-y-0 left-0 w-0.75 ${config.dot}`} />
      <Icone size={15} strokeWidth={2.25} className={`shrink-0 ${config.strong}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-[13px] font-semibold leading-tight ${config.strong}`}>
          {situacao ? config.label : '—'}
        </p>
        {legenda && (
          <p className="mt-0.5 truncate text-[11px] leading-tight text-slate-500" title={legenda}>
            {legenda}
          </p>
        )}
      </div>
      {extra}
    </div>
  )
}
