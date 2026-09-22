"use client"

// Vocabulário visual da Auditoria de Evoluções.
//
// docs/padrao-detalhamento-modal.md §3.5: um tom = um significado, e o tom de um
// conceito é o mesmo no KPI, no card do profissional, na aba e na coluna da
// tabela. Por isso risco e cobrança são traduzidos para `Tone` UMA vez, aqui, e
// nunca reescritos como classe solta lá na UI.
//
// A tela nasceu com uma paleta teal/emerald própria (teal-600 do Tailwind, que
// não é o teal da marca — este mora em --color-brand, oklch 217). Trocado pelos
// tokens do sistema: `brand` para ação, TONE_CHIP para significado.

import type { Tone } from "@/hooks/useToneColor"
import type { StatusRiscoEvolucao, StatusCobrancaEvolucao } from "@/types/auditoriaEvolucoes"

/** Risco → tom. A ordem de gravidade é a regra de negócio. */
export const TOM_RISCO: Record<StatusRiscoEvolucao, Tone> = {
  sem_risco: "green",
  risco_especifico: "amber",
  risco_relevante: "red",
}

export const ROTULO_RISCO: Record<StatusRiscoEvolucao, string> = {
  sem_risco: "Sem risco",
  risco_especifico: "Ponto específico",
  risco_relevante: "Risco relevante",
}

/**
 * Cobrança → tom. `pendente` é cinza de propósito: pendência é o estado normal
 * de quem ainda não foi cobrado, não um alarme (§3.5, "zero não tem cor").
 */
export const TOM_COBRANCA: Record<StatusCobrancaEvolucao, Tone> = {
  pendente: "gray",
  cobrado: "blue",
  aguardando_correcao: "amber",
  corrigido_tita: "green",
  ignorado: "gray",
}

export const ROTULO_COBRANCA: Record<StatusCobrancaEvolucao, string> = {
  pendente: "Pendente",
  cobrado: "Cobrado",
  aguardando_correcao: "Aguardando correção",
  corrigido_tita: "Corrigido no TiTa",
  ignorado: "Dispensado",
}

/** Gravidade do apontamento usa a mesma escala de risco. */
export const TOM_GRAVIDADE: Record<"alta" | "media" | "baixa", Tone> = {
  alta: "red",
  media: "amber",
  baixa: "gray",
}

/**
 * Tom da taxa de conformidade — a leitura do próprio percentual.
 * Não confundir com o tom do status (§3.6: dois sinais, duas cores). Sem
 * denominador não há percentual, e sem percentual não há cor.
 */
export function tomDaConformidade(pct: number | null): Tone {
  if (pct === null) return "gray"
  if (pct >= 85) return "green"
  if (pct >= 60) return "amber"
  return "red"
}

/** Colorir só o que é maior que zero; o zero fica cinza. */
export function tomSeHouver(valor: number, tone: Tone): Tone {
  return valor > 0 ? tone : "gray"
}

/** Classes compartilhadas, para os três arquivos não divergirem. */
export const CARTAO = "rounded-xl border border-border bg-card shadow-sm"
export const FOCO = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
export const CAMPO =
  "h-9 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground " +
  "placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
export const BOTAO_SECUNDARIO =
  "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border " +
  "bg-background px-2.5 text-xs font-semibold text-foreground transition hover:bg-muted/40 " +
  "disabled:opacity-40 disabled:hover:bg-background " +
  FOCO
// Botão preenchido usa `brand-fg` (o tom com AA ≥4.5:1 sobre claro) e escurece
// no hover — o par praticado em auditoria-assim, tv-avisos e central/chat.
// `bg-brand` puro é reservado a fills não-textuais (ícone, anel, barra).
export const BOTAO_PRIMARIO =
  "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs font-bold " +
  "text-white transition bg-brand-fg hover:bg-brand-dark disabled:opacity-50 " +
  FOCO

/** Rótulo de seção/coluna: o `text-[11px] uppercase tracking-wider` do sistema. */
export const ROTULO = "text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
