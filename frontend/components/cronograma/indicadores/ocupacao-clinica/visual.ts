// Vocabulário visual da Ocupação Clínica — uma fonte só para barra, legenda,
// mapa da semana, painel e tabela não divergirem.
//
// As três situações "com profissional" usam UM tom de azul em três
// intensidades (paciente = mais forte): é uma sequência, não categorias
// independentes. Âmbar listrado é a única cor de alerta (a regularizar), e a
// cadeira vazia é o próprio trilho cinza da barra. Paleta validada para
// daltonismo nos dois temas (ordinal, um matiz, passos de luminosidade
// monotônicos) — não trocar uma cor sem trocar as três.

import type { SituacaoCadeira } from "@/lib/cronograma/ocupacaoClinica"

export interface InfoSituacao {
  rotulo: string
  /** O que significa, em uma frase. */
  descricao: string
  /** O que fazer com isso. */
  acao: string
  /** Fundo do segmento da barra / da bolinha da legenda. */
  cor: string
}

export const SITUACAO: Record<SituacaoCadeira, InfoSituacao> = {
  paciente: {
    rotulo: "Com paciente",
    descricao: "Sessão agendada do profissional alocado na cadeira, no horário exato.",
    acao: "Está funcionando.",
    cor: "bg-[#1F4E79] dark:bg-[#9CC7E6]",
  },
  aberta: {
    rotulo: "Agenda aberta",
    descricao: "O profissional está alocado e tem horário Livre no TiTa, sem paciente.",
    acao: "Dá para vender.",
    cor: "bg-[#3E8CC4] dark:bg-[#5BA6D9]",
  },
  administrativo: {
    rotulo: "Administrativo",
    descricao: "O profissional está alocado, mas em Horário Administrativo ou Bloqueado no TiTa.",
    acao: "Rever se precisa ocupar a sala.",
    cor: "bg-[#86B8DE] dark:bg-[#2F78B0]",
  },
  regularizar: {
    rotulo: "A regularizar",
    descricao: "O profissional está alocado na sala, mas não tem nada no TiTa nesse horário.",
    acao: "Corrigir o mapa de salas ou a agenda.",
    cor: "bg-[image:repeating-linear-gradient(45deg,#C98512_0_3px,#F1D49B_3px_6px)] dark:bg-[image:repeating-linear-gradient(45deg,#E0A642_0_3px,#5a4216_3px_6px)]",
  },
  vazia: {
    rotulo: "Sem profissional",
    descricao: "Cadeira sem ninguém alocado no mapa de salas.",
    acao: "Alocar alguém ou contratar.",
    cor: "bg-slate-200 dark:bg-slate-700/70",
  },
}

/** Cor do texto de alerta (âmbar) que acompanha "a regularizar"/"fora do mapa". */
export const COR_ALERTA = "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"

/** Escala do mapa da semana: mistura do azul forte sobre um fundo neutro, por tema. */
export const CLASSE_ESCALA_MAPA = "[--mapa-alto:#1F4E79] [--mapa-baixo:#eef2f7] dark:[--mapa-alto:#9CC7E6] dark:[--mapa-baixo:#1e2433]"

export function fundoMapa(pct: number): { background: string; escuro: boolean } {
  // 80% de paciente já é célula "cheia" — acima disso não precisa escurecer mais.
  const mistura = Math.round(Math.min(1, Math.max(0, pct) / 0.8) * 100)
  return { background: `color-mix(in oklab, var(--mapa-alto) ${mistura}%, var(--mapa-baixo))`, escuro: mistura > 55 }
}

export function fmtPct(v: number | null | undefined, casas = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—"
  return `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`
}

export function fmtNum(n: number): string {
  return n.toLocaleString("pt-BR")
}

export function plural(n: number, um: string, varios: string): string {
  return `${fmtNum(n)} ${n === 1 ? um : varios}`
}
