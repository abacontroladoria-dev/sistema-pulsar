"use client"

import type { CSSProperties } from "react"
import { iniciaisNome } from "@/lib/cadastros/profissionais"
import { varsDaCor } from "@/lib/cadastros/terapias"
import { estiloTons } from "@/lib/cadastros/tonsTerapia"
import type { TerapiaDoProfissional } from "@/types/profissional"

// Peças visuais do Cadastro de Profissionais, usadas na lista e no detalhe.
//
// Avatar e chip seguem o guia do card (classes .ua-* em globals.css): a cor
// cadastrada em /cadastros/terapias vira 4 tons (fundo, linha, ponto, texto)
// por tonsDaTerapia(); nunca é usada crua em texto ou borda. Terapia sem cor
// no catálogo → tons neutros.

/** Variáveis antigas (--t-cor, --t-suave…) — ainda usadas no hero e nas abas da ficha. */
export function estiloCor(hex: string): CSSProperties {
  return varsDaCor(hex) as CSSProperties
}

/** A cor só vale se a terapia está no catálogo; fora dele, tons neutros. */
export const corDoCatalogo = (t: Pick<TerapiaDoProfissional, "cor" | "terapiaId"> | null | undefined) =>
  t && t.terapiaId !== null ? t.cor : null

/** Avatar branco com anel na cor da terapia e iniciais no tom de texto. */
export function AvatarProfissional({
  nome,
  cor,
  tamanho = "lg",
  inativo = false,
}: {
  nome: string
  /** Cor cadastrada da terapia principal; null = neutro. */
  cor: string | null
  /** "xl" no hero do detalhe (112px), "lg" no card (76px), "sm" na lista (40px). */
  tamanho?: "xl" | "lg" | "sm"
  inativo?: boolean
}) {
  const caixa =
    tamanho === "xl"
      ? "h-28 w-28 text-4xl !border-4"
      : tamanho === "lg"
        ? "h-[76px] w-[76px] text-[26px]"
        : "h-10 w-10 text-sm !border-2"
  return (
    <span
      style={estiloTons(cor)}
      className={`ua-tons ua-avatar ${inativo ? "is-inactive" : ""} ${caixa}`}
      aria-hidden="true"
    >
      {iniciaisNome(nome)}
    </span>
  )
}

/** Chip de terapia com os tons da PRÓPRIA terapia (fundo 50, borda 300, ponto 500, texto 700). */
export function ChipTerapia({
  terapia,
  inativo = false,
}: {
  terapia: Pick<TerapiaDoProfissional, "nome" | "cor" | "terapiaId">
  inativo?: boolean
}) {
  return (
    <span style={estiloTons(corDoCatalogo(terapia))} title={terapia.nome} className={`ua-tons ua-chip ${inativo ? "is-inactive" : ""}`}>
      <span className="truncate">{terapia.nome}</span>
    </span>
  )
}
