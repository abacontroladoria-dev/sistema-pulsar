// Migrado de calculadora-remuneracao/src/utils/formatacao.ts

export const fmt = (v: number): string =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

export const fmtPct = (v: number): string =>
  `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`

export const fmtH = (h: number | string): string => {
  const n = Number(h) || 0
  let horas = Math.floor(n)
  let mins = Math.round((n - horas) * 60)
  if (mins >= 60) { horas += Math.floor(mins / 60); mins = mins % 60 }
  return `${horas}h${String(mins).padStart(2, "0")}`
}

export const fmtHDec = (h: number | string, casas = 2): string =>
  `${fmtNumBR(Number(h) || 0, casas)}h`

export function fmtNumBR(v: unknown, casas = 1): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—"
  return Number(v).toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })
}

export function fmtPctOcup(v: number | null | undefined): string {
  return v === null || v === undefined
    ? "—"
    : `${(v * 100).toFixed(2).replace(".", ",")}%`
}

export function hhmm(min: number | null | undefined): string {
  if (min === null || min === undefined || Number.isNaN(min)) return "—"
  const h = String(Math.floor(min / 60)).padStart(2, "0")
  const m = String(Math.round(min % 60)).padStart(2, "0")
  return `${h}:${m}`
}

export function timeToMin(t: string | null | undefined): number | null {
  if (!t) return null
  const [h, m] = t.split(":").map(Number)
  return h * 60 + m
}

export const minToH = (m: number): number => m / 60

export const cleanTxt = (v: unknown): string =>
  String(v ?? "").replace(/\s+/g, " ").trim()

export const isSim = (v: unknown): boolean =>
  ["sim", "1", "true", "realizado", "evoluido"].includes(
    String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim()
  )

// `isCancelado` morava aqui. Saiu para lib/remuneracao/rotulosExecucao.ts junto
// com o resto do vocabulário de execução do TiTa: o que era um `includes` de
// formatação virou tradução de rótulo externo — versionado, medido e testado —
// depois que o TiTa renomeou 'Cancelado' em 24/08/2026. Importe de lá.

export const htmlEsc = (v: unknown): string =>
  String(v ?? "").replace(/[&<>"']/g, ch => (
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[ch]
  ))

export const onlyDigits = (v: unknown): string =>
  String(v ?? "").replace(/\D/g, "")

export function parseNumeroBR(v: string | undefined | null): number | null {
  if (!v) return null
  const limpo = String(v).trim().replace(/\./g, "").replace(",", ".")
  const n = Number(limpo)
  return Number.isFinite(n) ? n : null
}

// Número → texto editável em formato BR (vírgula decimal, sem separador de
// milhar) — pensado pra popular um <input> que o usuário continua editando,
// não pra exibição final (essa é a fmt/fmtNumBR).
export function numeroParaTextoBR(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return ""
  return String(v).replace(".", ",")
}

// Máscara de moeda "estilo caixa eletrônico": os últimos 2 dígitos digitados
// são sempre os centavos — cada tecla reformata o texto todo a partir dos
// dígitos brutos (ignora o que já estava formatado). Usado em <input> de
// valor (PA, valor total) pra digitar sem precisar saber onde fica a vírgula.
export function maskMoedaBR(raw: string): string {
  const digitos = onlyDigits(raw)
  if (!digitos) return ""
  const centavos = parseInt(digitos, 10)
  return (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Número → texto já mascarado (com separador de milhar), pra popular o
// mesmo <input> de maskMoedaBR com o valor vindo do servidor.
export function formatMoedaBRTexto(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return ""
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function validarCpfCnpj(v: unknown): boolean {
  const digitos = onlyDigits(v)
  if (!digitos) return true
  return digitos.length === 11 || digitos.length === 14
}

// Valida CPF com dígito verificador de verdade — mais rígida que
// `validarCpfCnpj`, que só confere a contagem de dígitos. Não endurecer a
// função existente: ela roda sobre dados sujos vindos de import (TiTa/CSV) e
// não pode passar a rejeitar o que já estava salvo. Esta valida só onde o
// CPF é DIGITADO na hora, no cadastro de responsáveis.
export function validarCpf(v: unknown): boolean {
  const d = onlyDigits(v)
  if (!d) return true
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false

  const digitoVerificador = (base: string): number => {
    let soma = 0
    for (let i = 0; i < base.length; i++) {
      soma += Number(base[i]) * (base.length + 1 - i)
    }
    const resto = (soma * 10) % 11
    return resto === 10 ? 0 : resto
  }

  const d1 = digitoVerificador(d.slice(0, 9))
  const d2 = digitoVerificador(d.slice(0, 10))
  return d1 === Number(d[9]) && d2 === Number(d[10])
}

// Documento → texto mascarado, escolhendo o formato pela contagem de dígitos:
// até 11 vira CPF, acima vira CNPJ. Formata parcialmente enquanto se digita
// (não espera o documento estar completo), e trunca em 14 dígitos. Usado em
// <input> de CPF/CNPJ pra que o operador consiga conferir o que digitou —
// 11 ou 14 dígitos corridos sem pontuação são ilegíveis de bater com um papel.
export function maskCpfCnpj(raw: string): string {
  const d = onlyDigits(raw).slice(0, 14)
  if (d.length <= 11) {
    return d
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2")
  }
  return d
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2")
}

// CPF puro — para campos que NUNCA aceitam CNPJ (pessoa física: paciente,
// responsável). Trunca em 11 dígitos, então não há como o texto formatado
// escorregar para o padrão de CNPJ (00.000.000/0000-00) no meio da digitação.
// maskCpfCnpj continua existindo à parte para os campos que são
// legitimamente PF-ou-PJ (profissional, contrato).
export function maskCpf(raw: string): string {
  const d = onlyDigits(raw).slice(0, 11)
  return d
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2")
}

// Documento único → cpf/cnpj separados pelo nº de dígitos, pra gravar nas duas
// colunas que o banco ainda mantém. 11 dígitos vira CPF, 14 vira CNPJ — a
// coluna que não bateu sempre volta null, nunca as duas preenchidas juntas.
export function splitDocumento(v: unknown): { cpf: string | null; cnpj: string | null } {
  const d = onlyDigits(v)
  if (d.length === 11) return { cpf: d, cnpj: null }
  if (d.length === 14) return { cpf: null, cnpj: d }
  return { cpf: null, cnpj: null }
}
