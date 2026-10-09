"use client"

import { IdCard, LayoutGrid, List } from "lucide-react"
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
