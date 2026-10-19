import { describe, expect, it } from "vitest"
import { AREA_UTIL, LARGURA_TEXTO, MEDIDAS, alturaDoBloco, montarLayout, quebrarTexto } from "./layout"

// 5 pt por caractere: a largura da linha cabe ~100 caracteres.
const medir = (t: string) => t.length * 5
const porLinha = Math.floor(LARGURA_TEXTO / 5)
const texto = (linhas: number) => Array.from({ length: linhas }, (_, i) => `linha ${i + 1}`).join("\n")

describe("quebrarTexto", () => {
  it("respeita as quebras originais e as linhas em branco", () => {
    expect(quebrarTexto("a\n\nb", LARGURA_TEXTO, medir)).toEqual(["a", "", "b"])
  })

  it("quebra por palavra sem passar da largura", () => {
    const linhas = quebrarTexto(Array.from({ length: 300 }, () => "palavra").join(" "), LARGURA_TEXTO, medir)
    expect(linhas.length).toBeGreaterThan(1)
    for (const l of linhas) expect(medir(l)).toBeLessThanOrEqual(LARGURA_TEXTO)
    expect(linhas.join(" ")).toBe(Array.from({ length: 300 }, () => "palavra").join(" "))
  })

  it("corta palavra maior que a linha", () => {
    const linhas = quebrarTexto("x".repeat(porLinha * 2 + 3), LARGURA_TEXTO, medir)
    expect(linhas).toHaveLength(3)
    expect(linhas.join("")).toBe("x".repeat(porLinha * 2 + 3))
  })
})

describe("montarLayout", () => {
  it("nenhum bloco atravessa a página (exceto o maior que a página)", () => {
    const tamanhos = [3, 20, 35, 8, 39, 2, 30, 30, 30, 12, 40, 5] // até 41 linhas cabem numa página
    const paginas = montarLayout([tamanhos.map(texto)], medir)
    const vistos = new Map<number, number>()
    for (const p of paginas) {
      for (const parte of p.partes) {
        expect(parte.y + parte.altura).toBeLessThanOrEqual(AREA_UTIL + 0.001)
        expect(parte.continuacao).toBe(false)
        vistos.set(parte.indice, (vistos.get(parte.indice) ?? 0) + 1)
      }
    }
    // cada evolução aparece uma vez só, inteira, na ordem
    expect([...vistos.keys()]).toEqual(tamanhos.map((_, i) => i))
    expect([...vistos.values()].every(v => v === 1)).toBe(true)
    const ordem = paginas.flatMap(p => p.partes.map(x => x.indice))
    expect(ordem).toEqual(tamanhos.map((_, i) => i))
  })

  it("bloco que não cabe no que sobra vai inteiro para a próxima página", () => {
    const quaseCheia = Math.floor((AREA_UTIL - alturaDoBloco(0, true)) / MEDIDAS.linha) - 2
    const paginas = montarLayout([[texto(quaseCheia), texto(10)]], medir)
    expect(paginas).toHaveLength(2)
    expect(paginas[1].partes[0]).toMatchObject({ indice: 1, y: 0, continuacao: false })
    expect(paginas[1].partes[0].linhas).toHaveLength(10)
  })

  it("evolução maior que a página sai dividida, com continuação", () => {
    const enorme = texto(150)
    const paginas = montarLayout([[texto(5), enorme, texto(5)]], medir)
    const partes = paginas.flatMap(p => p.partes.filter(x => x.indice === 1).map(x => ({ ...x, pagina: p.paginaNoGrupo })))
    expect(partes.length).toBeGreaterThan(1)
    expect(partes[0].continuacao).toBe(false)
    expect(partes[0].y).toBe(0) // começa em página vazia
    expect(partes.slice(1).every(x => x.continuacao && x.y === 0)).toBe(true)
    expect(partes.flatMap(x => x.linhas)).toEqual(quebrarTexto(enorme, LARGURA_TEXTO, medir))
    for (const p of paginas) for (const x of p.partes) expect(x.y + x.altura).toBeLessThanOrEqual(AREA_UTIL + 0.001)
    // a seguinte continua na mesma página da última parte, se couber
    const ultima = paginas.find(p => p.partes.some(x => x.indice === 2))!
    expect(ultima.paginaNoGrupo).toBe(partes.at(-1)!.pagina)
  })

  it("cabeçalho mais alto (nome em várias linhas) cresce o bloco e continua sem atravessar a página", () => {
    const tamanhos = [30, 30, 30, 30]
    const sem = montarLayout([tamanhos.map(texto)], medir)
    const com = montarLayout([tamanhos.map(texto)], medir, [[20, 20, 20, 20]])
    expect(com[0].partes[0].altura).toBe(sem[0].partes[0].altura + 20)
    expect(com[0].partes[0].extra).toBe(20)
    for (const p of com) for (const x of p.partes) expect(x.y + x.altura).toBeLessThanOrEqual(AREA_UTIL + 0.001)
  })

  it("troca de paciente abre página nova", () => {
    const paginas = montarLayout([[texto(2)], [texto(2)], [texto(2)]], medir)
    expect(paginas.map(p => p.grupo)).toEqual([0, 1, 2])
    expect(paginas.every(p => p.partes[0].y === 0)).toBe(true)
  })

  it("'Página X de Y' é por paciente", () => {
    const muitos = Array.from({ length: 20 }, () => texto(20))
    const paginas = montarLayout([muitos, [texto(1)]], medir)
    const doPrimeiro = paginas.filter(p => p.grupo === 0)
    expect(doPrimeiro.length).toBeGreaterThan(1)
    expect(doPrimeiro.map(p => p.paginaNoGrupo)).toEqual(doPrimeiro.map((_, i) => i + 1))
    expect(doPrimeiro.every(p => p.totalNoGrupo === doPrimeiro.length)).toBe(true)
    const doSegundo = paginas.filter(p => p.grupo === 1)
    expect(doSegundo).toEqual([expect.objectContaining({ paginaNoGrupo: 1, totalNoGrupo: 1 })])
  })
})
