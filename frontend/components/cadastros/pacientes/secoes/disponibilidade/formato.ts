import type { OrigemDisponibilidade, VersaoDisponibilidade } from "@/services/pacienteDisponibilidade.service"

export function formatarDataHora(iso: string | null | undefined): string {
  if (!iso) return "—"
  const data = new Date(iso)
  if (Number.isNaN(data.getTime())) return "—"
  return data.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function formatarData(iso: string | null | undefined): string {
  if (!iso) return "—"
  const data = new Date(iso)
  if (Number.isNaN(data.getTime())) return "—"
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

/** "há 3 meses" — se o dado ainda descreve a família é a primeira pergunta de quem abre a aba. */
export function tempoDecorrido(iso: string): string {
  const data = new Date(iso)
  if (Number.isNaN(data.getTime())) return "—"
  const dias = Math.floor((Date.now() - data.getTime()) / 86_400_000)
  if (dias < 0) return "data futura"
  if (dias === 0) return "hoje"
  if (dias === 1) return "ontem"
  if (dias < 30) return `há ${dias} dias`
  const meses = Math.floor(dias / 30)
  if (meses < 12) return meses === 1 ? "há 1 mês" : `há ${meses} meses`
  const anos = Math.floor(dias / 365)
  return anos === 1 ? "há 1 ano" : `há ${anos} anos`
}

export const ROTULO_ORIGEM: Record<OrigemDisponibilidade, string> = {
  formulario: "Formulário",
  equipe: "Equipe",
  importacao_orbita: "Importação Órbita",
}

export const COR_ORIGEM: Record<OrigemDisponibilidade, string> = {
  formulario: "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  equipe: "bg-muted text-muted-foreground",
  importacao_orbita: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
}

/** "Josiane (Mãe)" — ou null quando a versão não diz quem da família declarou. */
export function declarante(v: Pick<VersaoDisponibilidade, "preenchido_por_nome" | "preenchido_por_parentesco">): string | null {
  if (!v.preenchido_por_nome) return null
  return v.preenchido_por_parentesco
    ? `${v.preenchido_por_nome} (${v.preenchido_por_parentesco})`
    : v.preenchido_por_nome
}
