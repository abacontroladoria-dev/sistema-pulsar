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
}: {
  value: string | null
  disponiveis: Set<string>
  onChange: (v: string | null) => void
  /** Texto do botão que limpa a letra (Pacientes: "Todos"; Profissionais: "TUDO"). */
  rotuloTodos?: string
}) {
  return (
    <div
      role="group"
      aria-label="Filtrar pela primeira letra do nome"
      // Do tamanho das letras (w-fit) e centralizada. overflow-x: no celular as
      // 27 opções não cabem numa tela de 360px;
      // rolar de lado é melhor do que quebrar linha e virar um bloco confuso.
      className="mx-auto mb-4 w-fit max-w-full overflow-x-auto rounded-md border border-border bg-card"
    >
      <div className="flex w-max divide-x divide-border text-xs font-semibold">
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-pressed={value === null}
          className={`shrink-0 px-3 py-1.5 ${
            value === null ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"
          } ${foco} focus-visible:ring-inset`}
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
              className={`w-7 shrink-0 py-1.5 transition-colors motion-reduce:transition-none ${
                ativa
                  ? "bg-primary/10 text-primary"
                  : tem
                    ? "text-foreground hover:bg-muted"
                    : "cursor-not-allowed text-foreground"
              } ${foco} focus-visible:ring-inset`}
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
}: {
  value: ModoExibicao
  onChange: (v: ModoExibicao) => void
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
            className={`inline-flex h-8 w-8 items-center justify-center rounded ${
              ativo ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
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
}: {
  icone: typeof IdCard
  rotulo: string
  valor: string | null
}) {
  return (
    <div className="flex items-center gap-2">
      <dt className="flex w-24 shrink-0 items-center gap-1.5 text-muted-foreground">
        <Icone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {rotulo}
      </dt>
      <dd className="truncate text-left font-semibold text-foreground">{valor || "—"}</dd>
    </div>
  )
}
