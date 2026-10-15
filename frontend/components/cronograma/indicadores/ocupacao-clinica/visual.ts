// Vocabulário visual e de texto da Ocupação Clínica — uma fonte só para barra,
// legenda, mapa da semana, painel e tabela não divergirem.
//
// As três situações "com profissional" usam UM tom de azul em três
// intensidades (paciente = mais forte): é uma sequência, não categorias
// independentes. Âmbar listrado é a única cor de alerta (reservada sem
// agenda), e a vaga sem profissional é o próprio trilho cinza da barra.
// Paleta validada para daltonismo nos dois temas (ordinal, um matiz, passos
// de luminosidade monotônicos) — não trocar uma cor sem trocar as três.
//
// Palavras: a unidade de medida que aparece na tela é "vaga" (o lugar de um
// profissional atendendo por 40 min numa sala — não um paciente; sessão em
// grupo é 1 vaga), nunca "cadeira" ou "bloco".

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
    descricao: "O profissional reservado na sala tem paciente agendado nesse horário.",
    acao: "",
    cor: "bg-[#1F4E79] dark:bg-[#9CC7E6]",
  },
  aberta: {
    rotulo: "Livre para agendar",
    descricao: "Tem profissional reservado na sala e ele está com horário livre no TiTa, ainda sem paciente.",
    acao: "Dá para agendar paciente novo nesses horários.",
    cor: "bg-[#3E8CC4] dark:bg-[#5BA6D9]",
  },
  administrativo: {
    rotulo: "Administrativo",
    descricao: "O profissional está na sala, mas em horário administrativo ou bloqueado no TiTa.",
    acao: "Indisponível para atendimentos.",
    cor: "bg-[#86B8DE] dark:bg-[#2F78B0]",
  },
  regularizar: {
    rotulo: "Reservada sem agenda",
    descricao: "A sala está reservada para o profissional, mas ele não tem nada no TiTa nesse horário: nem paciente, nem horário livre. A sala fica parada.",
    acao: "Tire a reserva na Ocupação de Salas ou abra a agenda no TiTa.",
    cor: "bg-[image:repeating-linear-gradient(45deg,#C98512_0_3px,#F1D49B_3px_6px)] dark:bg-[image:repeating-linear-gradient(45deg,#E0A642_0_3px,#5a4216_3px_6px)]",
  },
  vazia: {
    rotulo: "Sem profissional",
    descricao: "Ninguém está reservado nesse lugar da sala nesse horário, então não dá para agendar paciente aqui.",
    acao: "Primeiro é preciso colocar um profissional (ou contratar).",
    cor: "bg-slate-200 dark:bg-slate-700/70",
  },
}

/** Tela da Ocupação de Salas que lista, por profissional, reserva sem agenda e agenda sem reserva. */
export const LINK_REGULARIZACOES = "/relacionamento-prestador/ocupacao-salas?view=regularizacoes"

/** Fundo/texto de alerta (âmbar) dos chips de ajuste do mapa de salas. */
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

/**
 * Percentuais inteiros que SOMAM `alvo` (método do maior resto): arredonda
 * tudo para baixo e dá os pontos que faltam a quem tinha a maior fração.
 * Arredondar cada parte sozinha fazia a legenda mostrar 55 + 9 + 6 + 1 = 71
 * debaixo de um total de 70%.
 */
export function porcentagensQueSomam(partes: number[], total: number, alvo = 100): number[] {
  if (total <= 0) return partes.map(() => 0)
  const exatos = partes.map(p => (p / total) * 100)
  const pisos = exatos.map(Math.floor)
  let faltam = Math.round(alvo) - pisos.reduce((s, v) => s + v, 0)
  const ordem = exatos.map((v, i) => ({ i, resto: v - pisos[i] })).sort((a, b) => b.resto - a.resto)
  for (const { i } of ordem) {
    if (faltam <= 0) break
    pisos[i]++
    faltam--
  }
  return pisos
}

export function fmtNum(n: number): string {
  return n.toLocaleString("pt-BR")
}

export function plural(n: number, um: string, varios: string): string {
  return `${fmtNum(n)} ${n === 1 ? um : varios}`
}
