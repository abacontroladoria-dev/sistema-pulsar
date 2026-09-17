/**
 * O vocabulário visual dos KPIs — um só, para a tela diária e a visão gerencial.
 *
 * Antes isto morava dentro de `KpiCards.tsx`, como um array montado no corpo do
 * componente. Quando a visão gerencial passou a mostrar os MESMOS onze
 * indicadores, copiar as classes seria criar uma segunda paleta para o mesmo
 * significado — e o DESIGN.md é explícito: `SITUACAO_CONFIG` e as recipes de cor
 * são fonte, nunca coisa a redigitar. Duas cópias divergem no primeiro ajuste de
 * contraste que alguém fizer só de um lado.
 *
 * As cores obedecem à Status Lock Rule do DESIGN.md e à extensão de
 * `/auditoria-assim`: glosa é violeta (rejeição financeira terminal), faltas são
 * stone (ficam fora da rampa de autorização), e "Com Token" usa o steel da marca
 * porque não é um estágio do ciclo — é um atributo transversal.
 *
 * Sem variante `dark:` de propósito: esta superfície inteira depende do shim
 * global `.dark`, que remapeia `bg-`, `text-`, `border-` e `ring-`. Escrever
 * `dark:` aqui criaria uma terceira regra de tema convivendo com o shim.
 */

import {
  AlertCircle, AlertTriangle, Ban, CalendarX, CheckCircle2, RefreshCw,
  Ticket, UserMinus, UserX, XCircle,
} from 'lucide-react'

/** As dez métricas que viram card. `total` e `glosas_resolvidas` ficam fora:
 *  o primeiro é a âncora (TotalCard), o segundo é dica dentro de Glosas. */
export type MetricaKpi =
  | 'nao_solicitadas' | 'sincronizando' | 'retorno_nao_confirmado'
  | 'liberadas' | 'tokens' | 'glosas' | 'canceladas'
  | 'faltas' | 'faltas_terapeuta' | 'unidade_fechada'

export type VisualKpi = {
  key: string
  title: string
  hint?: string
  /** O valor que o filtro da tabela recebe ao clicar no card. */
  situacao: string
  tone: string
  iconTone: string
  barTone: string
  borderActive: string
  hoverBorder: string
  bgActive: string
  icon: typeof RefreshCw
}

/**
 * A ordem é a da rampa de severidade (`prioridade` da RPC), não alfabética: o
 * que exige ação primeiro aparece primeiro, e é a mesma ordem que ordena a
 * listagem. Mudar aqui muda a leitura das duas telas de uma vez.
 */
export const ORDEM_KPIS: MetricaKpi[] = [
  'nao_solicitadas', 'sincronizando', 'retorno_nao_confirmado',
  'liberadas', 'tokens', 'glosas', 'canceladas',
  'faltas', 'faltas_terapeuta', 'unidade_fechada',
]

export const KPI_VISUAL: Record<MetricaKpi, VisualKpi> = {
  nao_solicitadas: {
    key: 'nao-solicitadas',
    // 'NAO_SOLICITADA' aqui é o GRUPO: soma as que nunca foram enviadas e as
    // que tiveram a solicitação quebrada no meio (SOLICITACAO_CANCELADA). As
    // duas pedem a mesma coisa — solicitar de novo — e a régua vive em
    // situacoes.ts, uma só para a contagem e para o filtro que o clique aplica.
    situacao: 'NAO_SOLICITADA',
    title: 'Não Solicitadas',
    hint: 'inclui canceladas',
    tone: 'text-rose-700',
    iconTone: 'bg-rose-50 text-rose-700',
    barTone: 'bg-rose-500',
    borderActive: 'border-rose-400',
    hoverBorder: 'hover:border-rose-300',
    bgActive: 'bg-rose-50/60',
    icon: AlertCircle,
  },
  sincronizando: {
    key: 'sincronizando',
    situacao: 'SINCRONIZANDO',
    title: 'Sincronizando',
    hint: 'até 10 min',
    tone: 'text-sky-700',
    iconTone: 'bg-sky-50 text-sky-700',
    barTone: 'bg-sky-500',
    borderActive: 'border-sky-400',
    hoverBorder: 'hover:border-sky-300',
    bgActive: 'bg-sky-50/60',
    icon: RefreshCw,
  },
  retorno_nao_confirmado: {
    key: 'retorno-nao-confirmado',
    situacao: 'RETORNO_NAO_CONFIRMADO',
    title: 'Retorno Não\nConfirmado',
    hint: 'mais de 10 min',
    tone: 'text-amber-700',
    iconTone: 'bg-amber-50 text-amber-700',
    barTone: 'bg-amber-500',
    borderActive: 'border-amber-400',
    hoverBorder: 'hover:border-amber-300',
    bgActive: 'bg-amber-50/60',
    icon: AlertTriangle,
  },
  liberadas: {
    key: 'liberadas',
    situacao: 'LIBERADA',
    title: 'Liberadas',
    tone: 'text-emerald-700',
    iconTone: 'bg-emerald-50 text-emerald-700',
    barTone: 'bg-emerald-500',
    borderActive: 'border-emerald-400',
    hoverBorder: 'hover:border-emerald-300',
    bgActive: 'bg-emerald-50/60',
    icon: CheckCircle2,
  },
  tokens: {
    // "Com Token" não é uma situação — é um atributo transversal (toda liberada
    // pode ter filipeta) e o contador da feature que a Conferência de Filipetas
    // abre. Fica no steel da marca, fora da régua de situação, justamente para
    // não parecer mais um estado do ciclo.
    key: 'tokens',
    situacao: 'TOKENS',
    title: 'Com Token',
    tone: 'text-brand-fg',
    iconTone: 'bg-brand-surface text-brand-fg',
    barTone: 'bg-brand',
    borderActive: 'border-brand',
    hoverBorder: 'hover:border-brand/50',
    bgActive: 'bg-brand-surface',
    icon: Ticket,
  },
  glosas: {
    key: 'glosas',
    situacao: 'GLOSA',
    title: 'Glosas',
    tone: 'text-violet-700',
    iconTone: 'bg-violet-50 text-violet-700',
    barTone: 'bg-violet-500',
    borderActive: 'border-violet-400',
    hoverBorder: 'hover:border-violet-300',
    bgActive: 'bg-violet-50/60',
    icon: XCircle,
  },
  canceladas: {
    key: 'canceladas',
    situacao: 'CANCELADA',
    title: 'Canceladas',
    tone: 'text-slate-600',
    iconTone: 'bg-slate-100 text-slate-600',
    barTone: 'bg-slate-400',
    borderActive: 'border-slate-400',
    hoverBorder: 'hover:border-slate-300',
    bgActive: 'bg-slate-50/80',
    icon: Ban,
  },
  faltas: {
    // As duas faltas vivem em stone, fora da régua de autorização: sessão que
    // não aconteceu é outra categoria. Distinguem-se por peso (stone-600 vs
    // stone-700), ícone e título — não por matiz. Antes, "Faltas Terapeuta" era
    // red-600, idêntico a "Não Solicitadas".
    key: 'faltas',
    situacao: 'FALTA',
    title: 'Faltas Paciente',
    tone: 'text-stone-600',
    iconTone: 'bg-stone-100 text-stone-600',
    barTone: 'bg-stone-400',
    borderActive: 'border-stone-400',
    hoverBorder: 'hover:border-stone-300',
    bgActive: 'bg-stone-50',
    icon: UserX,
  },
  faltas_terapeuta: {
    key: 'faltas-terapeuta',
    situacao: 'FALTA_TERAPEUTA',
    title: 'Faltas Terapeuta',
    tone: 'text-stone-700',
    iconTone: 'bg-stone-200 text-stone-700',
    barTone: 'bg-stone-500',
    borderActive: 'border-stone-500',
    hoverBorder: 'hover:border-stone-400',
    bgActive: 'bg-stone-100/80',
    icon: UserMinus,
  },
  // Terceira em stone, e a última da rampa: não é falta de ninguém, então não
  // pede nada de ninguém. Separa-se das outras duas pelo título e pelo ícone de
  // calendário — o mesmo CalendarX que a Central usa para este estado
  // (severity.ts:171) e que o badge da situação carrega.
  unidade_fechada: {
    key: 'unidade-fechada',
    situacao: 'UNIDADE_FECHADA',
    title: 'Unidade Fechada',
    hint: 'a clínica não abriu',
    tone: 'text-stone-800',
    iconTone: 'bg-stone-200 text-stone-800',
    barTone: 'bg-stone-600',
    borderActive: 'border-stone-600',
    hoverBorder: 'hover:border-stone-400',
    bgActive: 'bg-stone-100',
    icon: CalendarX,
  },
}
