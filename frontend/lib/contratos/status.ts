// Regras puras dos contratos do paciente — usadas pela aba Contratos, pela tela
// Status Contratos e (fase 3) pelo webhook da D4Sign. Uma regra só.
//
// DOIS EIXOS, e eles não se misturam:
//
//   • STATUS da assinatura — gravado no banco (pacientes_contratos.status), só
//     muda pelas RPCs. Responde "em que pé está o processo de assinar?".
//   • VIGÊNCIA — calculada das datas aqui, nunca gravada. Responde "o contrato
//     está valendo?".
//
// "Expirado" (status) é o LINK de assinatura que venceu sem ninguém assinar.
// "Vencido" (vigência) é o CONTRATO que passou da data de vencimento.
//
// A matriz TRANSICOES é espelho de public.sp_contratos_transicao_ok
// (supabase/migrations/20261008160000_pacientes_contratos.sql). O teste de
// segurança compara as duas célula a célula; mudou num lugar, muda no outro.

import { dataBR, hojeBrasilia } from "@/lib/disponibilidadeProfissional"

export { dataBR, hojeBrasilia }

// ─── Tipo ────────────────────────────────────────────────────────────────────

export const TIPOS_CONTRATO = [
  "avaliacao_neuropsicologica",
  "terapias",
  "tecnico_terapeutico_particular",
  // Instrumento apartado, vinculado ao contrato de Terapias (20261009160000).
  "termo_uso_imagem",
] as const
export type TipoContrato = (typeof TIPOS_CONTRATO)[number]

export const ROTULO_TIPO: Record<TipoContrato, string> = {
  avaliacao_neuropsicologica: "Avaliação Neuropsicológica",
  terapias: "Terapias",
  tecnico_terapeutico_particular: "Técnico Terapêutico Particular",
  termo_uso_imagem: "Termo de Uso de Imagem",
}

/** Rótulo curto, para selo de cartão. */
export const ROTULO_TIPO_CURTO: Record<TipoContrato, string> = {
  avaliacao_neuropsicologica: "Avaliação",
  terapias: "Terapias",
  tecnico_terapeutico_particular: "Técnico Terapêutico",
  termo_uso_imagem: "Uso de Imagem",
}

// ─── Status da assinatura ────────────────────────────────────────────────────

export const STATUS_CONTRATO = [
  "rascunho",
  "enviado",
  "aguardando_assinatura",
  "assinado",
  "recusado",
  "cancelado",
  "expirado",
] as const
export type StatusContrato = (typeof STATUS_CONTRATO)[number]

export const ROTULO_STATUS: Record<StatusContrato, string> = {
  rascunho: "Rascunho",
  enviado: "Enviado",
  aguardando_assinatura: "Aguardando assinatura",
  assinado: "Assinado",
  recusado: "Recusado",
  cancelado: "Cancelado",
  expirado: "Link expirado",
}

/** Selo do status. Mesma família pastel -50/-950 das outras telas. */
export const TOM_STATUS: Record<StatusContrato, string> = {
  rascunho: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  enviado: "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  aguardando_assinatura: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  assinado: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  recusado: "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
  cancelado: "bg-muted text-muted-foreground line-through decoration-1",
  expirado: "bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300",
}

export const TRANSICOES: Record<StatusContrato, readonly StatusContrato[]> = {
  rascunho: ["enviado", "assinado", "cancelado"],
  enviado: ["aguardando_assinatura", "assinado", "recusado", "cancelado", "expirado"],
  aguardando_assinatura: ["assinado", "recusado", "cancelado", "expirado"],
  expirado: ["enviado", "aguardando_assinatura", "assinado", "cancelado"],
  recusado: ["cancelado"],
  assinado: ["cancelado"],
  cancelado: [],
}

export function transicaoPermitida(de: StatusContrato, para: StatusContrato): boolean {
  return TRANSICOES[de]?.includes(para) ?? false
}

/**
 * O status que a TELA mostra. Igual ao gravado, com uma exceção: link que já
 * passou de `link_expira_em` e ainda está esperando aparece como "expirado"
 * mesmo antes de o job diário (fase 3) gravar isso. É o "calcular na leitura
 * até o job existir" do plano.
 */
export function statusEfetivo(
  c: { status: StatusContrato; link_expira_em: string | null },
  agora: Date = new Date(),
): StatusContrato {
  if (
    (c.status === "enviado" || c.status === "aguardando_assinatura") &&
    c.link_expira_em &&
    new Date(c.link_expira_em).getTime() <= agora.getTime()
  ) {
    return "expirado"
  }
  return c.status
}

// ─── Vigência ────────────────────────────────────────────────────────────────

export const VIGENCIAS = ["nao_iniciado", "vigente", "a_vencer", "vencido"] as const
export type Vigencia = (typeof VIGENCIAS)[number]

/** Antecedência do "A vencer" — decisão 4 do plano. */
export const DIAS_A_VENCER = 30

export const ROTULO_VIGENCIA: Record<Vigencia, string> = {
  nao_iniciado: "Ainda não iniciado",
  vigente: "Vigente",
  a_vencer: "A vencer",
  vencido: "Vencido",
}

export const TOM_VIGENCIA: Record<Vigencia, string> = {
  nao_iniciado: "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  vigente: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  a_vencer: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  vencido: "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
}

/** Dias entre duas datas "AAAA-MM-DD" (b − a), sem fuso no meio. */
export function diasEntre(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number)
  const [yb, mb, db] = b.split("-").map(Number)
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000)
}

/**
 * Vigência pelas datas. O dia do vencimento ainda vale (vence no FIM do dia).
 * `hoje` em "AAAA-MM-DD", no fuso de Brasília (ver `hojeBrasilia`).
 */
export function vigencia(dataInicio: string, dataVencimento: string, hoje: string): Vigencia {
  if (hoje < dataInicio) return "nao_iniciado"
  if (hoje > dataVencimento) return "vencido"
  return diasEntre(hoje, dataVencimento) <= DIAS_A_VENCER ? "a_vencer" : "vigente"
}

/** Vigência que cobre hoje: o contrato está valendo agora. */
export function cobreHoje(v: Vigencia): boolean {
  return v === "vigente" || v === "a_vencer"
}

// ─── Contrato "atual" ────────────────────────────────────────────────────────

export type ContratoBase = {
  id: number
  tipo: TipoContrato
  data_inicio: string
  data_vencimento: string
  status: StatusContrato
  link_expira_em: string | null
}

/**
 * O contrato que vale para cada tipo: o mais recente (por início, depois por
 * id) que não foi cancelado. Decisão 1 do plano: um paciente pode ter vários do
 * mesmo tipo (renovação), e o anterior vira histórico.
 */
export function contratoAtualPorTipo<T extends ContratoBase>(contratos: T[]): Map<TipoContrato, T> {
  const atual = new Map<TipoContrato, T>()
  for (const c of contratos) {
    if (c.status === "cancelado") continue
    const vigente = atual.get(c.tipo)
    if (
      !vigente ||
      c.data_inicio > vigente.data_inicio ||
      (c.data_inicio === vigente.data_inicio && c.id > vigente.id)
    ) {
      atual.set(c.tipo, c)
    }
  }
  return atual
}

/** Texto curto de prazo: "vence em 12 dias", "venceu há 3 dias", "começa em 5 dias". */
export function textoPrazo(dataInicio: string, dataVencimento: string, hoje: string): string {
  const v = vigencia(dataInicio, dataVencimento, hoje)
  if (v === "nao_iniciado") {
    const d = diasEntre(hoje, dataInicio)
    return d === 1 ? "começa amanhã" : `começa em ${d} dias`
  }
  if (v === "vencido") {
    const d = diasEntre(dataVencimento, hoje)
    return d === 1 ? "venceu ontem" : `venceu há ${d} dias`
  }
  const d = diasEntre(hoje, dataVencimento)
  return d === 0 ? "vence hoje" : d === 1 ? "vence amanhã" : `vence em ${d} dias`
}

/**
 * Vencimento sugerido: `meses` depois do início, menos um dia (um contrato de
 * 12 meses que começa em 08/10/2026 vence em 07/10/2027). Dia que não existe no
 * mês de destino cai no último dia dele (31/01 + 1 mês → 28/02, menos um dia).
 */
export function vencimentoSugerido(dataInicio: string, meses: number): string {
  const [a, m, d] = dataInicio.split("-").map(Number)
  const ultimoDoMes = new Date(Date.UTC(a, m - 1 + meses + 1, 0)).getUTCDate()
  const alvo = new Date(Date.UTC(a, m - 1 + meses, Math.min(d, ultimoDoMes)))
  alvo.setUTCDate(alvo.getUTCDate() - 1)
  return alvo.toISOString().slice(0, 10)
}

/** "dd/mm/aaaa" de um timestamptz, no dia de Brasília (assinado_em, eventos). */
export function dataBRDeTimestamp(iso: string | null | undefined): string {
  if (!iso) return ""
  return dataBR(hojeBrasilia(new Date(iso)))
}
