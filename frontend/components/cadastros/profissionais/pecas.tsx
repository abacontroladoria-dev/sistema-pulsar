"use client"

import type { CSSProperties } from "react"
import { iniciaisNome } from "@/lib/cadastros/profissionais"
import { varsDaCor } from "@/lib/cadastros/terapias"
import type { TerapiaDoProfissional } from "@/types/profissional"

// Peças visuais do Cadastro de Profissionais, usadas na lista e no detalhe.
// A cor da terapia entra sempre como DESTAQUE (fundo suave, anel, bolinha) e
// nunca como fundo de texto puro: há terapias quase brancas (Psicopedagogia
// #FFFB73) e quase pretas (Supervisão ABA #000000) no catálogo.

export function estiloCor(hex: string): CSSProperties {
  return varsDaCor(hex) as CSSProperties
}

/** Avatar com as iniciais no tom da terapia focal. */
export function AvatarProfissional({
  nome,
  cor,
  tamanho = "lg",
}: {
  nome: string
  cor: string
  /** "xl" no hero do detalhe (112px), "lg" no card (96px), "sm" na lista (40px). */
  tamanho?: "xl" | "lg" | "sm"
}) {
  const caixa =
    tamanho === "xl"
      ? "h-28 w-28 text-4xl ring-4"
      : tamanho === "lg"
        ? "h-24 w-24 text-3xl ring-[3px] transition-transform duration-200 ease-out group-hover:scale-105 motion-reduce:transform-none motion-reduce:transition-none"
        : "h-10 w-10 shrink-0 text-sm ring-2"
  return (
    <span
      style={estiloCor(cor)}
      className={`flex select-none items-center justify-center rounded-full bg-[var(--t-suave)] font-bold tracking-tight text-[var(--t-tinta)] ring-[var(--t-linha)] dark:text-[var(--t-tinta-escuro)] ${caixa}`}
      aria-hidden="true"
    >
      {iniciaisNome(nome)}
    </span>
  )
}

/** Chip de terapia: bolinha na cor + nome. `destaque` = a focal. */
export function ChipTerapia({
  terapia,
  destaque = false,
  tamanho = "sm",
}: {
  terapia: Pick<TerapiaDoProfissional, "nome" | "cor">
  destaque?: boolean
  tamanho?: "sm" | "md"
}) {
  return (
    <span
      style={estiloCor(terapia.cor)}
      title={terapia.nome}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border font-medium ${
        tamanho === "md" ? "px-2.5 py-1 text-sm" : "px-2 py-0.5 text-xs"
      } ${
        destaque
          ? "border-[var(--t-linha)] bg-[var(--t-suave)] text-[var(--t-tinta)] dark:text-[var(--t-tinta-escuro)]"
          : "border-border bg-card text-foreground"
      }`}
    >
      <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--t-cor)] ring-1 ring-black/10" aria-hidden="true" />
      <span className="truncate">{terapia.nome}</span>
    </span>
  )
}
