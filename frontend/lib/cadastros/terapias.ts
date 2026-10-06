import { normTxt, tCor } from "@/lib/cronograma/constants"
import type { CadastroTerapia } from "@/types/terapia"

// Helpers puros do catálogo de terapias (Cadastro de Terapias / Profissionais).

/** Cinza neutro usado quando a terapia não está no catálogo nem tem cor antiga. */
export const COR_NEUTRA = "#CBD5E1"

const HEX = /^#[0-9A-F]{6}$/

/** "#abc" → "#AABBCC", "aabbcc" → "#AABBCC"; null quando não é cor válida. */
export function normalizarHex(valor: string): string | null {
  let v = valor.trim().toUpperCase()
  if (!v.startsWith("#")) v = `#${v}`
  if (/^#[0-9A-F]{3}$/.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`
  return HEX.test(v) ? v : null
}

/**
 * A TiTa grava num horário livre todas as terapias que o profissional pode
 * prestar nele, juntas: "Aplicador ABA (AE), Arteterapia, Psicopedagogia".
 * Nenhum nome de terapia do catálogo tem vírgula, então separar por ela é seguro.
 */
export function separarTerapias(terapiaNome: string | null | undefined): string[] {
  if (!terapiaNome) return []
  return terapiaNome
    .split(",")
    .map(t => t.trim())
    .filter(t => t && normTxt(t) !== "ainda nao selecionado")
}

/** Índice nome normalizado → terapia do catálogo. */
export function indicePorNome(catalogo: CadastroTerapia[]): Map<string, CadastroTerapia> {
  return new Map(catalogo.map(t => [normTxt(t.nome), t]))
}

/**
 * Cor de uma terapia pelo nome: catálogo primeiro; fora dele, a constante
 * antiga (TERAPIA_CORES); sem nenhuma das duas, cinza neutro.
 */
export function corDaTerapia(nome: string, indice: Map<string, CadastroTerapia>): string {
  const doCatalogo = indice.get(normTxt(nome))
  if (doCatalogo) return doCatalogo.cor_hex
  const antiga = tCor(nome)
  return antiga === "#f8fafc" ? COR_NEUTRA : antiga
}

/** Luminância relativa (WCAG) — decide texto escuro ou claro sobre a cor. */
export function luminancia(hex: string): number {
  const n = normalizarHex(hex) ?? COR_NEUTRA
  const canal = (i: number) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5)
}

/** Mistura a cor com branco (fator 0–1) — tinta legível sobre fundo escuro. */
export function clarearHex(hex: string, fator: number): string {
  const n = normalizarHex(hex) ?? COR_NEUTRA
  const canal = (i: number) => Math.round(parseInt(n.slice(i, i + 2), 16) + (255 - parseInt(n.slice(i, i + 2), 16)) * fator)
  return `#${[canal(1), canal(3), canal(5)].map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`
}

/** Mistura a cor com preto (fator 0–1) — tinta legível sobre fundo claro. */
export function escurecerCor(hex: string, fator: number): string {
  const n = normalizarHex(hex) ?? COR_NEUTRA
  const canal = (i: number) => Math.round(parseInt(n.slice(i, i + 2), 16) * (1 - fator))
  return `#${[canal(1), canal(3), canal(5)].map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`
}

/**
 * Variáveis CSS de uma cor de terapia para destaque sutil: `--t-suave` (fundo),
 * `--t-linha` (anel/borda), `--t-tinta` (texto no claro) e `--t-tinta-escuro`
 * (texto no escuro). O texto é sempre a cor puxada para o legível — cor de
 * terapia clara (amarelo-psicopedagogia) sobre branco sumiria.
 */
export function varsDaCor(hex: string): Record<string, string> {
  const n = normalizarHex(hex) ?? COR_NEUTRA
  const l = luminancia(n)
  const r = parseInt(n.slice(1, 3), 16), g = parseInt(n.slice(3, 5), 16), b = parseInt(n.slice(5, 7), 16)
  return {
    "--t-cor": n,
    "--t-suave": `rgba(${r}, ${g}, ${b}, 0.14)`,
    "--t-faixa": `rgba(${r}, ${g}, ${b}, 0.20)`,
    "--t-linha": `rgba(${r}, ${g}, ${b}, 0.55)`,
    "--t-tinta": l > 0.3 ? escurecerCor(n, 0.6) : l > 0.1 ? escurecerCor(n, 0.25) : n,
    "--t-tinta-escuro": l < 0.25 ? clarearHex(n, 0.6) : clarearHex(n, 0.15),
  }
}
