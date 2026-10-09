// Números, valores e datas por extenso, em português do Brasil, para os
// contratos do paciente (cláusula de valor e fecho "Rio de Janeiro, …").
// Puro: sem React, sem Supabase.

const UNIDADES = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove",
  "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"]
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"]
const CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos",
  "setecentos", "oitocentos", "novecentos"]

/** 0–999, sem "e" na frente. */
function ate999(n: number): string {
  if (n === 100) return "cem"
  const c = Math.floor(n / 100)
  const resto = n % 100
  const partes: string[] = []
  if (c) partes.push(CENTENAS[c])
  if (resto) {
    if (resto < 20) partes.push(UNIDADES[resto])
    else {
      const d = Math.floor(resto / 10)
      const u = resto % 10
      partes.push(u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d])
    }
  }
  return partes.join(" e ")
}

const GRUPOS: [singular: string, plural: string][] = [
  ["", ""],
  ["mil", "mil"],
  ["milhão", "milhões"],
  ["bilhão", "bilhões"],
]

/** Inteiro não negativo por extenso: 1755 → "mil setecentos e cinquenta e cinco". */
export function numeroPorExtenso(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new Error(`Número inválido para extenso: ${n}`)
  if (n === 0) return "zero"

  const grupos: number[] = []
  for (let r = n; r > 0; r = Math.floor(r / 1000)) grupos.push(r % 1000)
  if (grupos.length > GRUPOS.length) throw new Error(`Número grande demais para extenso: ${n}`)

  const partes: { texto: string; valor: number }[] = []
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i]
    if (!g) continue
    let texto: string
    if (i === 0) texto = ate999(g)
    else if (i === 1) texto = g === 1 ? "mil" : `${ate999(g)} mil`
    else texto = `${ate999(g)} ${g === 1 ? GRUPOS[i][0] : GRUPOS[i][1]}`
    partes.push({ texto, valor: g })
  }

  // Regra do "e" entre grupos: só antes do ÚLTIMO grupo, e quando ele é menor
  // que 100 ou é centena redonda ("mil e cem", "mil e cinquenta", mas "mil
  // setecentos e cinquenta e cinco").
  return partes
    .map((p, i) => {
      if (i === 0) return p.texto
      const ultimo = i === partes.length - 1
      const comE = ultimo && (p.valor < 100 || p.valor % 100 === 0)
      return `${comE ? "e " : ""}${p.texto}`
    })
    .join(" ")
}

/** "milhão"/"milhões" redondos pedem "de reais": um milhão de reais. */
function precisaDe(reais: number): boolean {
  return reais >= 1_000_000 && reais % 1_000_000 === 0
}

/**
 * Valor em reais por extenso: 1755 → "mil setecentos e cinquenta e cinco reais";
 * 1234.56 → "mil duzentos e trinta e quatro reais e cinquenta e seis centavos".
 */
export function valorPorExtenso(valor: number): string {
  if (!Number.isFinite(valor) || valor < 0) throw new Error(`Valor inválido para extenso: ${valor}`)
  const centavosTotais = Math.round(valor * 100)
  const reais = Math.floor(centavosTotais / 100)
  const centavos = centavosTotais % 100

  const partes: string[] = []
  if (reais) {
    partes.push(`${numeroPorExtenso(reais)}${precisaDe(reais) ? " de" : ""} ${reais === 1 ? "real" : "reais"}`)
  }
  if (centavos) partes.push(`${numeroPorExtenso(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`)
  return partes.length ? partes.join(" e ") : "zero real"
}

/** 1755 → "R$ 1.755,00". */
export function reais(valor: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor).replace(/ /g, " ")
}

/** 10 → "10 (dez)". */
export function quantidadeComExtenso(n: number): string {
  return `${n} (${numeroPorExtenso(n)})`
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto",
  "setembro", "outubro", "novembro", "dezembro"]

/** "2026-10-09" → "9 de outubro de 2026". */
export function dataPorExtenso(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number)
  if (!a || !m || !d || m > 12) throw new Error(`Data inválida: ${iso}`)
  return `${d} de ${MESES[m - 1]} de ${a}`
}
