import type { CSSProperties } from "react"

// Tons de uma terapia a partir da cor cadastrada em /cadastros/terapias —
// guia "Card de Profissional: guia de design e cores" (06/10/2026).
//
// A cor cadastrada não vai direto para borda/ponto/texto (cores claras somem no
// branco; escuras pesam). Dela sai só a MATIZ; a claridade de cada tom é fixa,
// então toda terapia fica com o mesmo peso visual e o texto é sempre legível:
//   50  fundo (faixa do card, fundo do chip)
//   300 linha (anel do avatar, borda do chip, borda do card no hover)
//   500 identidade (pontos) — NUNCA texto (~3:1)
//   700 texto colorido (iniciais, cargo, chip) — ≥ 6:1 no branco e no 50
// O guia só define o tema claro; os tons escuros seguem a mesma regra com a
// claridade invertida (fundo escuro, texto claro).

type Passos = Record<"50" | "300" | "500" | "700", [number, number]>

const PASSOS_CLARO: Passos = { 50: [0.975, 0.025], 300: [0.85, 0.11], 500: [0.68, 0.16], 700: [0.47, 0.14] }
const PASSOS_ESCURO: Passos = { 50: [0.27, 0.035], 300: [0.45, 0.09], 500: [0.66, 0.14], 700: [0.86, 0.09] }

export type Tons = Record<"50" | "300" | "500" | "700", string>

function hexParaOklch(hex: string): { L: number; C: number; H: number } {
  const h = hex.replace("#", "")
  const [r, g, b] = [0, 2, 4].map(i => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { L, C: Math.hypot(A, B), H: (Math.atan2(B, A) * 180 / Math.PI + 360) % 360 }
}

function oklchParaHex(L: number, C: number, H: number): string {
  const conv = (c: number) => {
    const a = c * Math.cos(H * Math.PI / 180), b = c * Math.sin(H * Math.PI / 180)
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ]
  }
  // Reduz o croma até a cor caber no sRGB (sem estourar canal).
  let c = C
  let rgb = conv(c)
  while (c > 0 && rgb.some(v => v < -1e-4 || v > 1 + 1e-4)) { c -= 0.002; rgb = conv(c) }
  return "#" + rgb.map(v => {
    v = Math.min(Math.max(v, 0), 1)
    v = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
    return Math.round(v * 255).toString(16).padStart(2, "0")
  }).join("").toUpperCase()
}

function gerar(hex: string, passos: Passos): Tons {
  const { C, H: matiz } = hexParaOklch(hex)
  const H = C < 0.005 ? 255 : matiz // preto, branco e cinza puro: cinza-azulado neutro
  // Cores quase cinzas continuam discretas (não ganham saturação artificial).
  const fator = C < 0.03 ? Math.max(C / 0.16, 0.18) : 1
  return Object.fromEntries(
    (Object.entries(passos) as [keyof Tons, [number, number]][]).map(([p, [L, Cmax]]) => [p, oklchParaHex(L, Cmax * fator, H)])
  ) as Tons
}

const cache = new Map<string, { claro: Tons; escuro: Tons }>()

/** Tons claro e escuro de uma cor cadastrada (memorizados por hex). null = cor inválida. */
export function tonsDaTerapia(hex: string | null | undefined): { claro: Tons; escuro: Tons } | null {
  const n = (hex ?? "").trim().toUpperCase()
  if (!/^#[0-9A-F]{6}$/.test(n)) return null
  let t = cache.get(n)
  if (!t) {
    t = { claro: gerar(n, PASSOS_CLARO), escuro: gerar(n, PASSOS_ESCURO) }
    cache.set(n, t)
  }
  return t
}

/**
 * Variáveis CSS dos tons para o elemento (`--tl-*` claro, `--td-*` escuro); a
 * classe `.ua-tons` (globals.css) escolhe as do tema. Sem cor válida devolve {}
 * e o CSS cai nos tons neutros (slate).
 */
export function estiloTons(hex: string | null | undefined): CSSProperties {
  const t = tonsDaTerapia(hex)
  if (!t) return {}
  const v: Record<string, string> = {}
  for (const p of ["50", "300", "500", "700"] as const) {
    v[`--tl-${p}`] = t.claro[p]
    v[`--td-${p}`] = t.escuro[p]
  }
  return v as CSSProperties
}

/** Contraste WCAG entre duas cores hex (para os testes de legibilidade). */
export function contraste(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map(i => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
