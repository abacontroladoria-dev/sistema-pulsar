"use client"

import type { CSSProperties } from "react"
import { useUrlAssinada } from "@/hooks/useUrlAssinada"
import { IconeTerapia } from "@/lib/cadastros/iconesTerapia"
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

/**
 * Avatar branco com anel na cor da terapia e, no meio, o ÍCONE da terapia
 * principal (escolhido no Cadastro de Terapias) no tom de texto — no lugar das
 * iniciais, como os bichinhos de Pacientes (pedido de 06/10/2026). Com foto de
 * perfil, a foto ocupa o círculo e o anel continua na cor da terapia.
 */
export function AvatarProfissional({
  icone,
  cor,
  fotoPath = null,
  tamanho = "lg",
  inativo = false,
}: {
  /** Path da foto de perfil no bucket privado; quando existe, substitui o ícone. */
  fotoPath?: string | null
  /** Chave do ícone da terapia principal; null = estrelinhas. */
  icone: string | null
  /** Cor cadastrada da terapia principal; null = neutro. */
  cor: string | null
  /** "xl" no hero do detalhe (112px), "lg" no card (76px), "sm" na lista (40px). */
  tamanho?: "xl" | "lg" | "sm"
  inativo?: boolean
}) {
  const [caixa, desenho] =
    tamanho === "xl"
      ? ["h-28 w-28 !border-4", "h-12 w-12"]
      : tamanho === "lg"
        ? ["h-[76px] w-[76px]", "h-9 w-9"]
        : ["h-10 w-10 !border-2", "h-5 w-5"]
  const foto = useUrlAssinada(fotoPath)
  return (
    <span
      style={estiloTons(cor)}
      className={`ua-tons ua-avatar overflow-hidden ${inativo ? "is-inactive" : ""} ${caixa}`}
      aria-hidden="true"
    >
      {foto ? (
        // <img> cru: o projeto não usa next/image, e a URL assinada é dinâmica.
        <img src={foto} alt="" className={`h-full w-full object-cover ${inativo ? "grayscale" : ""}`} />
      ) : (
        <IconeTerapia chave={icone} className={desenho} strokeWidth={1.75} />
      )}
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
