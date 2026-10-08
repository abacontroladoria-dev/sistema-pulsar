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
 * O TiTa grava num horário livre todas as terapias que o profissional pode
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

/** "#RRGGBB" → matiz (0–360), saturação e luminosidade (0–1). */
export function hexParaHsl(hex: string): { h: number; s: number; l: number } {
  const n = normalizarHex(hex) ?? COR_NEUTRA
  const r = parseInt(n.slice(1, 3), 16) / 255, g = parseInt(n.slice(3, 5), 16) / 255, b = parseInt(n.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  const l = (max + min) / 2
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s, l }
}

/**
 * Ordena cores "por tom": famílias de matiz em sequência (vermelho → laranja →
 * amarelo → verde → azul → roxo → rosa) e, dentro da família, do claro ao
 * escuro; cinzas, branco e preto vão para o fim, do claro ao escuro. As faixas
 * de 30° juntam cores que o olho lê como "da mesma família" mesmo com pequenas
 * diferenças de matiz.
 */
export function compararTom(a: string, b: string): number {
  const ka = chaveTom(a), kb = chaveTom(b)
  return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2]
}

function chaveTom(hex: string): [number, number, number] {
  const n = normalizarHex(hex) ?? COR_NEUTRA
  const { h, l } = hexParaHsl(n)
  // Neutro pela intensidade real (croma = maior canal − menor canal), não pela
  // saturação HSL: o cinza-azulado #CBD5E1 tem saturação 0,27 mas é cinza aos olhos.
  const canais = [1, 3, 5].map(i => parseInt(n.slice(i, i + 2), 16) / 255)
  const croma = Math.max(...canais) - Math.min(...canais)
  if (croma < 0.15) return [1, 0, -l]
  // Começa a roda em 345° para os vermelhos-rosados ficarem junto dos vermelhos.
  const familia = Math.floor(((h + 15) % 360) / 30)
  return [0, familia, -l]
}
