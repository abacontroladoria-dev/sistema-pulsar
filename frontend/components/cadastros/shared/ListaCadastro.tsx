"use client"

import { useEffect, useRef, useState } from "react"
import { Check, ChevronDown, IdCard, LayoutGrid, List, ListFilter } from "lucide-react"
import { foco } from "@/components/cadastros/pacientes/ui/campos"

// Peças da listagem de cadastros (Pacientes, Profissionais): barra A–Z, seletor
// grade/lista e a linha "rótulo: valor" dos cards. Saíram de PacientesCadastro
// sem mudança de comportamento para as duas telas falarem a mesma língua.

// Grade para reconhecer rosto, lista para varrer muitos nomes de uma vez.
export type ModoExibicao = "grade" | "lista"

const LETRAS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")

/**
 * Atalho para achar pela primeira letra do nome — útil quando se conhece o
 * paciente mas não lembra o suficiente pra digitar na busca. Fica acima da
 * grade OU da lista, então filtra os dois do mesmo jeito.
 *
 * Letra sem paciente no recorte atual fica desabilitada, com o mesmo tom das
 * outras (a barra lê como um alfabeto inteiro, não como um mapa de buracos) — não
 * some, porque sumir moveria toda letra depois dela, e o dedo que já mirou
 * "P" acertaria "Q" sem querer.
 */
export function BarraAlfabeto({
  value,
  disponiveis,
  onChange,
  rotuloTodos = "Todos",
  embutida = false,
}: {
  value: string | null
  disponiveis: Set<string>
  onChange: (v: string | null) => void
  /** Texto do botão que limpa a letra (Pacientes: "Todos"; Profissionais: "TUDO"). */
  rotuloTodos?: string
  /** Sem moldura própria, para morar dentro da barra de filtros. */
  embutida?: boolean
}) {
  return (
    <div
      role="group"
      aria-label="Filtrar pela primeira letra do nome"
      // Do tamanho das letras (w-fit) e centralizada. overflow-x: no celular as
      // 27 opções não cabem numa tela de 360px;
      // rolar de lado é melhor do que quebrar linha e virar um bloco confuso.
      className={
        embutida
          ? "max-w-full overflow-x-auto"
          : "mx-auto mb-4 w-fit max-w-full overflow-x-auto rounded-md border border-border bg-card"
      }
    >
      <div
        className={`flex w-max text-xs ${embutida ? "gap-0.5 font-medium" : "divide-x divide-border font-semibold"}`}
      >
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-pressed={value === null}
          className={`min-h-11 shrink-0 px-3 py-1.5 sm:min-h-0 ${
            embutida
              ? value === null
                ? "rounded-md bg-sidebar-primary text-sidebar-primary-foreground"
                : "rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              : value === null
                ? "bg-primary/10 text-primary"
                : "text-foreground hover:bg-muted"
          } ${foco} ${embutida ? "" : "focus-visible:ring-inset"}`}
        >
          {rotuloTodos}
        </button>
        {LETRAS.map((l) => {
          const tem = disponiveis.has(l)
          const ativa = value === l
          return (
            <button
              key={l}
              type="button"
              onClick={() => onChange(l)}
              disabled={!tem}
              aria-pressed={ativa}
              className={`min-h-11 w-11 shrink-0 py-1.5 transition-colors sm:min-h-0 sm:w-7 motion-reduce:transition-none ${
                embutida
                  ? ativa
                    ? "rounded-md bg-sidebar-primary text-sidebar-primary-foreground"
                    : tem
                      ? "rounded-md text-foreground/80 hover:bg-muted hover:text-foreground"
                      : "cursor-not-allowed text-muted-foreground/50"
                  : ativa
                    ? "bg-primary/10 text-primary"
                    : tem
                      ? "text-foreground hover:bg-muted"
                      : "cursor-not-allowed text-foreground"
              } ${foco} ${embutida ? "" : "focus-visible:ring-inset"}`}
            >
              {l}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Grade | lista — o "Modo de exibição" da tela, dois botões só de ícone. */
export function SeletorModo({
  value,
  onChange,
  destaque = false,
}: {
  value: ModoExibicao
  onChange: (v: ModoExibicao) => void
  /** Modo ativo em azul claro (Pacientes) em vez do cinza neutro. */
  destaque?: boolean
}) {
  const opcoes = [
    { valor: "grade" as const, icone: LayoutGrid, rotulo: "Exibir em grade" },
    { valor: "lista" as const, icone: List, rotulo: "Exibir em lista" },
  ]

  return (
    <div
      role="group"
      aria-label="Modo de exibição"
      className="inline-flex shrink-0 rounded-md border border-border p-0.5"
    >
      {opcoes.map(({ valor, icone: Icone, rotulo }) => {
        const ativo = value === valor
        return (
          <button
            key={valor}
            type="button"
            onClick={() => onChange(valor)}
            aria-pressed={ativo}
            aria-label={rotulo}
            title={rotulo}
            className={`inline-flex h-10 w-10 items-center justify-center rounded sm:h-8 sm:w-8 ${
              ativo
                ? destaque
                  ? "bg-sidebar-primary/10 text-sidebar-primary"
                  : "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            } ${foco}`}
          >
            <Icone className="h-4 w-4" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}

export function LinhaDado({
  icone: Icone,
  rotulo,
  valor,
  children,
}: {
  icone: typeof IdCard
  rotulo: string
  valor?: string | null
  /** Conteúdo próprio no lugar do valor em texto (ex.: o selo do contrato). */
  children?: React.ReactNode
}) {
  return (
    // Rótulo à esquerda, valor encostado à direita: a coluna de valores se lê
    // de cima a baixo sem o olho voltar ao rótulo. O valor não usa negrito para
    // não competir com o nome do card.
    <div className="flex items-center justify-between gap-3">
      <dt className="flex shrink-0 items-center gap-2 text-muted-foreground">
        <Icone className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        {rotulo}
      </dt>
      <dd
        className={`min-w-0 truncate text-right tabular-nums ${
          children || valor ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        {children ?? (valor || "—")}
      </dd>
    </div>
  )
}


/**
 * Gatilho + painel de opções marcáveis, compartilhado pelos filtros das listas de Pacientes e Profissionais.
 *
 * Teclado: abrir leva o foco à primeira opção; ↑/↓, Home/End navegam; Esc ou
 * Tab fecham e devolvem o foco ao gatilho. Clique fora também fecha.
 */
export function PopoverFiltro({
  icone: Icone,
  nome,
  valor,
  rotuloPainel,
  larguraPainel,
  children,
  rodape,
  unico = false,
}: {
  icone: typeof ListFilter
  /** "Situação", "Escola" — em tom apagado, antes do valor. */
  nome: string
  /** O recorte atual ("Todos", "Ativos"…). */
  valor: string
  rotuloPainel: string
  larguraPainel: string
  children: React.ReactNode
  rodape?: React.ReactNode
  /** Escolha única (ex.: ordenação): marcar uma opção fecha o painel. */
  unico?: boolean
}) {
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const gatilho = useRef<HTMLButtonElement>(null)
  const painel = useRef<HTMLDivElement>(null)

  const opcoes = () =>
    Array.from(painel.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])

  useEffect(() => {
    if (!aberto) return
    opcoes()[0]?.focus()
    function aoClicarFora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener("mousedown", aoClicarFora)
    return () => document.removeEventListener("mousedown", aoClicarFora)
  }, [aberto])

  function fechar() {
    setAberto(false)
    gatilho.current?.focus()
  }

  function aoTeclar(e: React.KeyboardEvent) {
    const lista = opcoes()
    const atual = lista.indexOf(document.activeElement as HTMLElement)
    let destino: number | null = null
    if (e.key === "ArrowDown") destino = (atual + 1) % lista.length
    else if (e.key === "ArrowUp") destino = (atual - 1 + lista.length) % lista.length
    else if (e.key === "Home") destino = 0
    else if (e.key === "End") destino = lista.length - 1
    else if (e.key === "Escape") {
      e.preventDefault()
      fechar()
      return
    } else if (e.key === "Tab") {
      setAberto(false)
      return
    }
    if (destino !== null) {
      e.preventDefault()
      lista[destino]?.focus()
    }
  }

  return (
    <div ref={ref} className="relative min-w-0 flex-1 sm:flex-none">
      <button
        ref={gatilho}
        type="button"
        onClick={() => setAberto((a) => !a)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !aberto) {
            e.preventDefault()
            setAberto(true)
          }
        }}
        aria-expanded={aberto}
        aria-haspopup="listbox"
        aria-label={`${nome}: ${valor}`}
        className={`inline-flex min-h-11 w-full items-center gap-2 rounded-lg border border-border/80 px-3 py-2 text-sm hover:bg-muted sm:min-h-0 sm:w-auto sm:min-w-44 ${foco}`}
      >
        <Icone className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        <span className="shrink-0 text-muted-foreground">{nome}</span>
        <span className="min-w-0 flex-1 truncate text-left font-medium text-foreground">{valor}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${aberto ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {aberto && (
        <div
          ref={painel}
          role="listbox"
          aria-multiselectable={!unico}
          aria-label={rotuloPainel}
          onKeyDown={aoTeclar}
          onClick={unico ? (e) => { if ((e.target as HTMLElement).closest("[role=\"option\"]")) fechar() } : undefined}
          className={`absolute left-0 top-[calc(100%+4px)] z-[100] ${larguraPainel} rounded-md border border-border bg-popover p-1 shadow-lg`}
        >
          {children}
          {rodape}
        </div>
      )}
    </div>
  )
}

/** Uma opção do `PopoverFiltro`: alvo de 44px no toque, marca à direita. */
export function OpcaoFiltro({
  marcado,
  onAlternar,
  children,
}: {
  marcado: boolean
  onAlternar: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={marcado}
      onClick={onAlternar}
      className={`flex min-h-11 w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted sm:min-h-0 ${foco}`}
    >
      {children}
      <Check
        className={`h-4 w-4 shrink-0 text-primary ${marcado ? "" : "invisible"}`}
        aria-hidden="true"
      />
    </button>
  )
}

export function alternarEm<T>(conjunto: Set<T>, item: T): Set<T> {
  const novo = new Set(conjunto)
  if (novo.has(item)) novo.delete(item)
  else novo.add(item)
  return novo
}
