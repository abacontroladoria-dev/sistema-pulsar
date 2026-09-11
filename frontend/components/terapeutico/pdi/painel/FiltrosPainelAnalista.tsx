"use client"

import { useState, type ReactNode } from "react"
import * as Popover from "@radix-ui/react-popover"
import { Check, ChevronDown, FilterX, ListFilter, Search, Users } from "lucide-react"
import type { LinhaAnalista } from "@/lib/pdi/painelAnalista"
import type { RecortePainel } from "./tipos"

// A barra de filtros do "PDI — Painel por Analista". Reúne num só lugar os
// controles que estavam espalhados: o recorte de status vivia só no clique dos
// cards executivos (invisível para quem não descobrisse que eles eram
// clicáveis) e a busca ficava solta ao lado do título da seção.
//
// TRÊS controles, não quatro. A referência visual trazia também "Todos os
// períodos", e ele não existe: a janela desta tela é fixa no servidor (1ª
// semana do mês seguinte para a população, 45 dias para a grade — ver
// services/pdi/prazos.ts). Um seletor de período aqui não teria dado por trás,
// e um controle que não controla nada é pior que a ausência dele.
//
// `Suspenso`/`ItemSuspenso` são o MESMO desenho de FiltrosPdi.tsx (tela irmã,
// Controle de Prazos): mesma altura h-9, mesmo popover do Radix, mesmo
// cabeçalho em `primary`, mesmo `Check` no selecionado. Duplicar ~40 linhas de
// moldura mantém as duas telas idênticas aos olhos sem criar uma abstração
// compartilhada que teria de servir a dois conjuntos de filtros bem diferentes.

const OPCOES_STATUS: { chave: RecortePainel; rotulo: string }[] = [
  { chave: "totalPacientes", rotulo: "Todos os status" },
  { chave: "atrasados", rotulo: "Atrasados" },
  { chave: "proximoPrazo", rotulo: "Próximos do prazo" },
  { chave: "emAndamento", rotulo: "Dentro do prazo" },
  { chave: "aguardandoImplementacao", rotulo: "Aguardando implementação" },
]

export function FiltrosPainelAnalista({
  linhas,
  recorte,
  onRecorte,
  busca,
  onBusca,
  analistaId,
  onAnalista,
  temFiltro,
  onLimpar,
  desabilitado,
}: {
  /** Todos os coordenadores dos dados — as opções do seletor saem daqui, não de uma lista fixa. */
  linhas: LinhaAnalista[]
  recorte: RecortePainel
  onRecorte: (r: RecortePainel) => void
  busca: string
  onBusca: (v: string) => void
  /** `null` = todos os analistas. 0 é um id válido: "Sem Coordenador de Caso". */
  analistaId: number | null
  onAnalista: (id: number | null) => void
  temFiltro: boolean
  onLimpar: () => void
  desabilitado: boolean
}) {
  const nomeAnalista = analistaId === null ? null : (linhas.find((l) => l.profissionalId === analistaId)?.nome ?? null)
  const rotuloStatus = OPCOES_STATUS.find((o) => o.chave === recorte)?.rotulo ?? "Todos os status"

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm">
      <Suspenso
        icone={Users}
        etiqueta="Analista"
        resumo={nomeAnalista ?? "Todos os analistas"}
        larguraPainel="w-64"
        desabilitado={desabilitado}
      >
        {(fechar) => (
          <>
            <ItemSuspenso
              rotulo="Todos os analistas"
              marcado={analistaId === null}
              onClick={() => {
                onAnalista(null)
                fechar()
              }}
            />
            {linhas.map((l) => (
              <ItemSuspenso
                key={l.profissionalId}
                rotulo={l.nome}
                marcado={analistaId === l.profissionalId}
                onClick={() => {
                  onAnalista(l.profissionalId)
                  fechar()
                }}
              />
            ))}
          </>
        )}
      </Suspenso>

      {/* A busca cresce e ocupa a sobra: é o controle que mais se usa, e o
          único que não cabe num rótulo curto. */}
      <div className="relative min-w-48 flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <label htmlFor="busca-analista" className="sr-only">
          Buscar paciente ou analista
        </label>
        <input
          id="busca-analista"
          type="search"
          value={busca}
          onChange={(e) => onBusca(e.target.value)}
          disabled={desabilitado}
          placeholder="Buscar paciente ou analista…"
          className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        />
      </div>

      <Suspenso
        icone={ListFilter}
        etiqueta="Status"
        resumo={rotuloStatus}
        larguraPainel="w-56"
        desabilitado={desabilitado}
      >
        {(fechar) => (
          <>
            {OPCOES_STATUS.map((o) => (
              <ItemSuspenso
                key={o.chave}
                rotulo={o.rotulo}
                marcado={recorte === o.chave}
                onClick={() => {
                  onRecorte(o.chave)
                  fechar()
                }}
              />
            ))}
          </>
        )}
      </Suspenso>

      <button
        type="button"
        onClick={onLimpar}
        disabled={!temFiltro}
        title={temFiltro ? "Limpar analista, busca e status" : "Nenhum filtro aplicado"}
        className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-background px-2.5 text-xs font-semibold text-foreground outline-none transition hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:hover:bg-background"
      >
        <FilterX className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Limpar
      </button>
    </div>
  )
}

/** A moldura do seletor — mesmo desenho de `Suspenso` em FiltrosPdi.tsx. */
function Suspenso({
  icone: Icone,
  etiqueta,
  resumo,
  larguraPainel,
  desabilitado,
  children,
}: {
  icone: typeof Users
  etiqueta: string
  resumo: string
  larguraPainel: string
  desabilitado: boolean
  children: (fechar: () => void) => ReactNode
}) {
  const [aberto, setAberto] = useState(false)

  return (
    <Popover.Root open={aberto} onOpenChange={setAberto}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title={etiqueta}
          disabled={desabilitado}
          className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-background px-2.5 text-left text-xs font-semibold text-foreground outline-none transition hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          <Icone className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="max-w-40 truncate" title={resumo}>
            {resumo}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className={`z-[100] ${larguraPainel} max-h-80 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95`}
        >
          <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">{etiqueta}</p>
          <div role="listbox" aria-label={etiqueta}>
            {children(() => setAberto(false))}
          </div>
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
      <span className="min-w-0 truncate">{rotulo}</span>
      {marcado && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
    </button>
  )
}
