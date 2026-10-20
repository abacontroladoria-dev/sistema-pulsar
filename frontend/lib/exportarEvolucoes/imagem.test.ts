import { describe, expect, it } from "vitest"
import { deflateSync } from "zlib"
import { tipoDaImagem } from "./imagem"

function crc32(b: Buffer) {
  let c = ~0
  for (const x of b) {
    c ^= x
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
function bloco(tipo: string, dados: Buffer) {
  const tam = Buffer.alloc(4)
  tam.writeUInt32BE(dados.length)
  const td = Buffer.concat([Buffer.from(tipo), dados])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([tam, td, crc])
}
function png(w = 4, h = 2) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    bloco("IHDR", ihdr),
    bloco("IDAT", deflateSync(Buffer.alloc((w * 4 + 1) * h))),
    bloco("IEND", Buffer.alloc(0)),
  ])
}

describe("tipoDaImagem", () => {
  it("aceita PNG íntegro", () => {
    expect(tipoDaImagem(new Uint8Array(png()))).toBe("png")
  })

  it("recusa PNG com CRC errado (o pdf-lib travaria nele)", () => {
    const b = png()
    b[40] ^= 0xff
    expect(tipoDaImagem(new Uint8Array(b))).toBeNull()
  })

  it("recusa PNG truncado e PNG sem IEND", () => {
    const b = png()
    expect(tipoDaImagem(new Uint8Array(b.subarray(0, b.length - 6)))).toBeNull()
    expect(tipoDaImagem(new Uint8Array(b.subarray(0, b.length - 12)))).toBeNull()
  })

  it("JPG precisa de início e fim", () => {
    expect(tipoDaImagem(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9]))).toBe("jpg")
    expect(tipoDaImagem(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBeNull()
  })

  it("outro formato não passa", () => {
    expect(tipoDaImagem(new TextEncoder().encode("GIF89a..."))).toBeNull()
  })
})
