import { foco } from "@/components/cadastros/pacientes/ui/campos"
import { TONE_SOFT, type Tone } from "@/components/cronograma/ui/tones"

// Vocabulário visual da Grade — o design PADRÃO do Pulsar (o mesmo de
// /cadastros/profissionais e da Agenda do Connect), não o kit pastel da PEP.
// Tokens neutros (bg-card, border-border, text-muted-foreground, bg-muted),
// controles h-9, cantos rounded-md/xl, uma sombra só (shadow-sm), cor apenas
// para terapia e estado. Decisão do usuário (08/10/2026).

const base = `inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 ${foco}`

export const btnSecundario = `${base} h-9 border border-border bg-card px-2.5 text-foreground hover:bg-muted`
export const btnPrimario = `${base} h-9 bg-primary px-3 text-primary-foreground hover:bg-primary/90`
export const btnPerigo = `${base} h-9 border border-rose-300 bg-card px-2.5 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40`
export const btnPerigoCheio = `${base} h-9 bg-destructive px-3 text-white hover:bg-destructive/90`
export const btnIcone = `${base} h-9 w-9 border border-border bg-card text-foreground hover:bg-muted`

/** Cartão de seção — mesma moldura dos cards e da lista de Profissionais. */
export const cartao = "rounded-xl border border-border bg-card shadow-sm"

/** Seletor segmentado (Dia/Semana/Mês…) — receita da Agenda do Connect. */
export const seletorTrilha = "inline-flex rounded-full border border-border bg-muted p-0.5"
export const seletorOpcao = (ativa: boolean) =>
  `inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm transition-colors ${foco} ${
    ativa ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`

/** Opção de escolha num formulário (repetição, tipo, dias): botão com borda, ativa em bg-muted. */
export const opcaoForm = (ativa: boolean) =>
  `inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border px-3 text-sm transition-colors ${foco} ${
    ativa ? "border-foreground/30 bg-muted font-semibold text-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`

export const rotuloCampo = "block text-xs font-semibold text-muted-foreground"

/** Selo pequeno de estado (11 px — menor degrau do DESIGN.md). */
export const selo = (t: Tone) =>
  `inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 text-[11px] font-semibold leading-4 ${TONE_SOFT[t].bg} ${TONE_SOFT[t].text}`

/** Caixa de aviso dentro de painel (mesma do InlineNotice, para blocos com conteúdo rico). */
export const aviso = (t: Tone) => `flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${TONE_SOFT[t].bg} ${TONE_SOFT[t].text}`

/** Listras discretas do horário bloqueado (cor da borda do tema, claro e escuro). */
export const LISTRAS_BLOQUEIO = {
  backgroundImage: "repeating-linear-gradient(135deg, var(--border) 0 1px, transparent 1px 7px)",
} as const
