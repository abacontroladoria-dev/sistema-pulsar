// Conferência de integridade da imagem da assinatura, antes de mandá-la ao
// navegador. Puro (testável).

import type { AssinaturaProfissional } from "@/types/exportarEvolucoes"

const TABELA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Uint8Array, inicio: number, fim: number): number {
  let c = 0xffffffff
  for (let i = inicio; i < fim; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * PNG íntegro: assinatura, IHDR primeiro, todo bloco com CRC certo, IEND no fim.
 * Não é zelo: o decodificador do pdf-lib entra em laço infinito com PNG
 * corrompido (medido em 19/10/2026) e congelaria a aba de quem exporta.
 */
export function pngIntegro(b: Uint8Array): boolean {
  const ASSINATURA = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (b.length < 8 || ASSINATURA.some((v, i) => b[i] !== v)) return false
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let pos = 8
  let primeiro = true
  while (pos + 12 <= b.length) {
    const tamanho = dv.getUint32(pos)
    const fim = pos + 8 + tamanho
    if (fim + 4 > b.length) return false
    const tipo = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7])
    if (primeiro && tipo !== "IHDR") return false
    if (crc32(b, pos + 4, fim) !== dv.getUint32(fim)) return false
    if (tipo === "IEND") return fim + 4 === b.length
    primeiro = false
    pos = fim + 4
  }
  return false
}

/** JPG: começa com SOI e termina com EOI. */
function jpgIntegro(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9
}

export function tipoDaImagem(bytes: Uint8Array): AssinaturaProfissional["tipo"] | null {
  if (pngIntegro(bytes)) return "png"
  if (jpgIntegro(bytes)) return "jpg"
  return null
}
