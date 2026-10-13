"use client"

import { useState, type ReactNode } from "react"
import * as Popover from "@radix-ui/react-popover"
import {
  Activity,
  AlertOctagon,
  CalendarDays,
  Check,
  ChevronDown,
  ClockAlert,
  Flag,
  FilterX,
  Hourglass,
  Layers,
  PlayCircle,
  UserX,
  Users,
} from "lucide-react"
import { DIAS_LIST } from "@/lib/cronograma/constants"
import {
  filtrosAlterados,
  RECORTE_LABEL,
  ESPECIALISTAS_PDI,
  type FiltrosPdi as Filtros,
  type RecortePdi,
  type EspecialistaPdiId,
  type AtividadePdi,
} from "@/lib/pdi/filtros"
import type { StatusPdi, PrioridadePdi } from "@/lib/pdi/status"

// Os cards de KPI e o seletor de especialista. MOLDE de
// components/acompanhamento/laudos/FiltrosLaudos.tsx — dois grupos de card
// (Visão Geral / Atenção) com o MESMO desenho, e um único seletor
// complementar (aqui: Especialista, ali: Paciente).
//
// Ao contrário de Laudos, esta barra não tem janela de data nem ordenação —
// a tela ainda não pediu isso (ver o comentário de `filtrosIniciais` em
// lib/pdi/filtros.ts: "não tem uma fila de trabalho óbvia definida pelo
// usuário nesta etapa"). Só o essencial: os KPIs SÃO o filtro de recorte
// (clicar de novo no card ativo volta para "todos"), e Especialista é o
// único filtro secundário.

/** Nomes dos dois especialistas — só o rótulo; os ids vêm de `ESPECIALISTAS_PDI`. */
const ESPECIALISTA_LABEL: Record<EspecialistaPdiId, string> = {
  [ESPECIALISTAS_PDI.AMANDA]: "Amanda Ribeiro",
  [ESPECIALISTAS_PDI.GRACIELLE]: "Gracielle Rayane",
}

/** Rótulos do seletor "Atividade" — ver `FiltrosPdi.atividade`. */
const ATIVIDADE_LABEL: Record<AtividadePdi, string> = {
  todos: "Todos",
  ativos: "Ativos",
  inativos: "Inativos",
}

/** Os quatro valores possíveis de `StatusPdi`, na ordem em que aparecem no seletor. */
const STATUS_OPCOES: StatusPdi[] = [
  "Dentro do prazo",
  "Aguardando Implementação",
  "Atrasado",
  "Próximo do prazo",
]

/** Os três valores possíveis de `PrioridadePdi`, na ordem em que aparecem no seletor. */
const PRIORIDADE_OPCOES: PrioridadePdi[] = ["Alta", "Média", "Neutra"]

/** Abreviação de 3 letras para caber no resumo do botão "Dias" quando 1-2 estão marcados. */
function diaAbrev(dia: string): string {
  return dia.slice(0, 3)
}

/**
 * `DIAS_LIST` (lib/cronograma/constants.ts) inclui Sábado porque é
 * compartilhada com telas de cronograma que operam 6 dias — mas o PDI (ABA)
 * não atende sábado (pedido do usuário, 05/09/2026: "não existe"). Filtrado
 * SÓ aqui, sem tocar a constante global (usada em 10+ outros arquivos).
 */
const DIAS_FILTRO_PDI = DIAS_LIST.filter((d) => d !== "Sábado")

type CardKpiInfo = {
  recorte: RecortePdi
  icone: typeof Layers
  tom: string
  base: string
  ativo: string
}

/**
 * Dois grupos, mesmo raciocínio de FiltrosLaudos: VISÃO GERAL soma tudo (é o
 * "como estamos?"), maior e sempre colorido; ATENÇÃO é o recorte de trabalho
 * — "o que fazer agora?" —, menor e neutro em repouso.
 */
const GRUPO_VISAO_GERAL: CardKpiInfo[] = [
  {
    recorte: "todos",
    icone: Layers,
    tom: "text-slate-600 dark:text-slate-300",
    base: "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40",
    ativo: "border-slate-400 bg-slate-100 dark:border-slate-600 dark:bg-slate-800/60 ring-1 ring-slate-400/30",
  },
  {
    recorte: "em_andamento",
    icone: PlayCircle,
    tom: "text-[var(--status-ok)]",
    base: "border-emerald-100 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30",
    ativo: "border-emerald-400 bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/40 ring-1 ring-emerald-400/30",
  },
  {
    recorte: "aguardando_implementacao",
    icone: Hourglass,
    tom: "text-sky-600 dark:text-sky-400",
    base: "border-sky-100 bg-sky-50 dark:border-sky-900/60 dark:bg-sky-950/30",
    ativo: "border-sky-400 bg-sky-100 dark:border-sky-700 dark:bg-sky-900/40 ring-1 ring-sky-400/30",
  },
]

const GRUPO_ATENCAO: CardKpiInfo[] = [
  {
    recorte: "atrasado",
    icone: AlertOctagon,
    tom: "text-rose-600 dark:text-rose-400",
    base: "border-border bg-card",
    ativo: "border-rose-400 bg-rose-500/5",
  },
  {
    recorte: "proximo_prazo",
    icone: ClockAlert,
    tom: "text-[var(--status-atencao)]",
    base: "border-border bg-card",
    ativo: "border-amber-500 bg-amber-500/5",
  },
  {
    // Coordenador de Caso ausente ou duplicado na 1ª semana do mês seguinte —
    // não é um status, cruza com qualquer um deles (ver o comentário de
    // `RecortePdi` em lib/pdi/filtros.ts). Mesmo tom de alerta que "Próximo
    // do prazo" — os dois são avisos, não urgência consumada como "Atrasado" —,
    // diferenciado pelo ícone.
    recorte: "coordenador_irregular",
    icone: UserX,
    tom: "text-[var(--status-atencao)]",
    base: "border-border bg-card",
    ativo: "border-amber-500 bg-amber-500/5",
  },
]

function CardKpi({
  card,
  grande,
  selecionado,
  valor,
  carregando,
  onClick,
}: {
  card: CardKpiInfo
  grande: boolean
  selecionado: boolean
  valor: number
  carregando: boolean
  onClick: () => void
}) {
  const Icone = card.icone

  if (grande) {
    return (
      <button
        type="button"
        aria-pressed={selecionado}
        onClick={onClick}
        className={`flex flex-col items-center gap-1 rounded-2xl border px-4 py-4 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          selecionado ? card.ativo : card.base
        }`}
      >
        <Icone className={`h-5 w-5 ${card.tom}`} aria-hidden="true" />
        <span className={`text-3xl font-bold leading-none ${card.tom}`}>
          {carregando ? "—" : valor}
        </span>
        <span className="text-sm font-semibold text-muted-foreground">
          {RECORTE_LABEL[card.recorte]}
        </span>
      </button>
    )
  }

  return (
    <button
      type="button"
      aria-pressed={selecionado}
      onClick={onClick}
      className={`flex items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        selecionado ? card.ativo : card.base
      }`}
    >
      <Icone className={`h-5 w-5 shrink-0 ${card.tom}`} aria-hidden="true" />
      <span className="min-w-0">
        <span className={`block text-2xl font-bold leading-none ${card.tom}`}>
          {carregando ? "—" : valor}
        </span>
        <span className="mt-1 block truncate text-xs font-semibold text-muted-foreground">
          {RECORTE_LABEL[card.recorte]}
        </span>
      </span>
    </button>
  )
}

function SeparadorGrupo({ rotulo }: { rotulo: string }) {
  return (
    <div className="flex items-center gap-3 px-0.5" role="separator" aria-label={rotulo}>
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {rotulo}
      </span>
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  )
}

export function KpisPdi({
  contagens,
  recorte,
  carregando,
  onRecorte,
}: {
  contagens: Record<RecortePdi, number>
  recorte: RecortePdi
  carregando: boolean
  onRecorte: (r: RecortePdi) => void
}) {
  function clicar(r: RecortePdi) {
    onRecorte(recorte === r && r !== "todos" ? "todos" : r)
  }

  return (
    <div className="space-y-3">
      <section className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="Visão geral">
        {GRUPO_VISAO_GERAL.map((card) => (
          <CardKpi
            key={card.recorte}
            card={card}
            grande
            selecionado={recorte === card.recorte}
            valor={contagens[card.recorte]}
            carregando={carregando}
            onClick={() => clicar(card.recorte)}
          />
        ))}
      </section>

      <SeparadorGrupo rotulo="Atenção" />

      <section className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="Atenção">
        {GRUPO_ATENCAO.map((card) => (
          <CardKpi
            key={card.recorte}
            card={card}
            grande={false}
            selecionado={recorte === card.recorte}
            valor={contagens[card.recorte]}
            carregando={carregando}
            onClick={() => clicar(card.recorte)}
          />
        ))}
      </section>
    </div>
  )
}

/**
 * A barra do cabeçalho: só o seletor de Especialista (único filtro secundário
 * desta etapa) + Limpar. Mesmo formato compacto (`h-9`) de `BarraFiltros` em
 * FiltrosLaudos, para caber na faixa fixa de 80px do cabeçalho.
 */
export function BarraFiltrosPdi({
  filtros,
  onChange,
  onLimpar,
}: {
  filtros: Filtros
  onChange: (f: Filtros) => void
  onLimpar: () => void
}) {
  const podeLimpar = filtrosAlterados(filtros)
  const resumo =
    filtros.especialistaId === "todos" ? "Todos" : ESPECIALISTA_LABEL[filtros.especialistaId]

  return (
    <div className="flex shrink-0 flex-nowrap items-center gap-2">
      <Suspenso
        icone={Users}
        etiqueta="Especialista"
        resumo={resumo}
        larguraPainel="w-44"
      >
        {(fechar) => (
          <>
            <ItemSuspenso
              rotulo="Todos"
              marcado={filtros.especialistaId === "todos"}
              onClick={() => {
                onChange({ ...filtros, especialistaId: "todos" })
                fechar()
              }}
            />
            {(Object.values(ESPECIALISTAS_PDI) as EspecialistaPdiId[]).map((id) => (
              <ItemSuspenso
                key={id}
                rotulo={ESPECIALISTA_LABEL[id]}
                marcado={filtros.especialistaId === id}
                onClick={() => {
                  onChange({ ...filtros, especialistaId: id })
                  fechar()
                }}
              />
            ))}
          </>
        )}
      </Suspenso>

      <Suspenso
        icone={Activity}
        etiqueta="Pacientes"
        resumo={ATIVIDADE_LABEL[filtros.atividade]}
        larguraPainel="w-40"
      >
        {(fechar) => (
          <>
            {(Object.keys(ATIVIDADE_LABEL) as AtividadePdi[]).map((valor) => (
              <ItemSuspenso
                key={valor}
                rotulo={ATIVIDADE_LABEL[valor]}
                marcado={filtros.atividade === valor}
                onClick={() => {
                  onChange({ ...filtros, atividade: valor })
                  fechar()
                }}
              />
            ))}
          </>
        )}
      </Suspenso>

      <Suspenso
        icone={ClockAlert}
        etiqueta="Status"
        resumo={filtros.status === "todos" ? "Todos" : filtros.status}
        larguraPainel="w-52"
      >
        {(fechar) => (
          <>
            <ItemSuspenso
              rotulo="Todos"
              marcado={filtros.status === "todos"}
              onClick={() => {
                onChange({ ...filtros, status: "todos" })
                fechar()
              }}
            />
            {STATUS_OPCOES.map((valor) => (
              <ItemSuspenso
                key={valor}
                rotulo={valor}
                marcado={filtros.status === valor}
                onClick={() => {
                  onChange({ ...filtros, status: valor })
                  fechar()
                }}
              />
            ))}
          </>
        )}
      </Suspenso>

      <Suspenso
        icone={Flag}
        etiqueta="Prioridade"
        resumo={filtros.prioridade === "todos" ? "Todos" : filtros.prioridade}
        larguraPainel="w-40"
      >
        {(fechar) => (
          <>
            <ItemSuspenso
              rotulo="Todos"
              marcado={filtros.prioridade === "todos"}
              onClick={() => {
                onChange({ ...filtros, prioridade: "todos" })
                fechar()
              }}
            />
            {PRIORIDADE_OPCOES.map((valor) => (
              <ItemSuspenso
                key={valor}
                rotulo={valor}
                marcado={filtros.prioridade === valor}
                onClick={() => {
                  onChange({ ...filtros, prioridade: valor })
                  fechar()
                }}
              />
            ))}
          </>
        )}
      </Suspenso>

      <SuspensoDias
        selecionados={filtros.dias}
        onChange={(dias) => onChange({ ...filtros, dias })}
      />

      <button
        type="button"
        onClick={onLimpar}
        disabled={!podeLimpar}
        title={podeLimpar ? "Volta ao estado inicial: todos, sem busca nem especialista" : "Nenhum filtro alterado"}
        className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-background px-2.5 text-xs font-semibold text-foreground outline-none transition hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:hover:bg-background"
      >
        <FilterX className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        Limpar
      </button>
    </div>
  )
}

/** A moldura do seletor — mesmo desenho de `Suspenso` em FiltrosLaudos. */
function Suspenso({
  icone: Icone,
  etiqueta,
  resumo,
  larguraPainel,
  children,
}: {
  icone: typeof Users
  etiqueta: string
  resumo: string
  larguraPainel: string
  children: (fechar: () => void) => ReactNode
}) {
  const [aberto, setAberto] = useState(false)

  return (
    <Popover.Root open={aberto} onOpenChange={setAberto}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title={etiqueta}
          className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-background px-2.5 text-left text-xs font-semibold text-foreground outline-none transition hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icone className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="max-w-36 truncate" title={resumo}>{resumo}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          className={`z-[100] ${larguraPainel} overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95`}
        >
          {/* Cabeçalho do painel — pintado de `primary` (pedido do usuário,
              05/09/2026: "pinte o título dentro da caixa de listagem", não o
              botão do gatilho — desfeito depois de uma tentativa anterior que
              coloriu o botão inteiro). "Todos" sozinho, repetido em vários
              filtros, não dizia a que filtro pertencia. */}
          <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
            {etiqueta}
          </p>
          <div role="listbox" aria-label={etiqueta}>
            {children(() => setAberto(false))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/**
 * Filtro "em formato calendário" pedido pelo usuário (05/09/2026): um ou mais
 * dias da semana marcados ao mesmo tempo, sem fechar o popover a cada clique
 * (diferente de `Suspenso`/`ItemSuspenso`, que são de escolha única e fecham
 * na hora). Casa contra `ItemPdi.diasClinicos` — ver `PREDICADO_RECORTE`... na
 * verdade este filtro vive em `aplicarFiltrosSecundarios`, não em
 * `PREDICADO_RECORTE`, pelo mesmo motivo que Especialista/Atividade vivem lá:
 * é ortogonal ao recorte de status, não um recorte novo.
 */
function SuspensoDias({
  selecionados,
  onChange,
}: {
  selecionados: string[]
  onChange: (dias: string[]) => void
}) {
  const [aberto, setAberto] = useState(false)

  const resumo =
    selecionados.length === 0
      ? "Todos"
      : selecionados.length <= 2
        ? selecionados.map(diaAbrev).join(", ")
        : `${selecionados.length} dias`

  function alternar(dia: string) {
    onChange(
      selecionados.includes(dia) ? selecionados.filter((d) => d !== dia) : [...selecionados, dia],
    )
  }

  return (
    <Popover.Root open={aberto} onOpenChange={setAberto}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title="Dias clínicos"
          className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-background px-2.5 text-left text-xs font-semibold text-foreground outline-none transition hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="max-w-28 truncate">{resumo}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          className="z-[100] w-48 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
            Dias clínicos
          </p>
          <div role="listbox" aria-label="Dias clínicos" aria-multiselectable="true">
            {DIAS_FILTRO_PDI.map((dia) => {
              const marcado = selecionados.includes(dia)
              return (
                <button
                  key={dia}
                  type="button"
                  role="option"
                  aria-selected={marcado}
                  onClick={() => alternar(dia)}
                  className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {dia}
                  {marcado && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
                </button>
              )
            })}
          </div>
          {selecionados.length > 0 && (
            <div className="border-t border-border p-1">
              <button
                type="button"
                onClick={() => onChange([])}
                className="flex w-full items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <FilterX className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Limpar dias
              </button>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function ItemSuspenso({
  rotulo,
  marcado,
  onClick,
}: {
  rotulo: string
  marcado: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={marcado}
      onClick={onClick}
      className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {rotulo}
      {marcado && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
    </button>
  )
}
