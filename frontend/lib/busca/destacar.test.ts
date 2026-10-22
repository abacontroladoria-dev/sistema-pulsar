import { describe, expect, it } from "vitest"
import { destacar } from "./destacar"

const marcado = (texto: string, termo: string) =>
  destacar(texto, termo).find((p) => p.casou)?.texto ?? null

describe("destacar", () => {
  it("marca o trecho do texto original, com o acento dele", () => {
    expect(destacar("Ana Láura Ribeiro", "laura")).toEqual([
      { texto: "Ana ", casou: false },
      { texto: "Láura", casou: true },
      { texto: " Ribeiro", casou: false },
    ])
  })

  it("ignora maiúscula e espaço repetido", () => {
    expect(marcado("Comparativo  de Sessões", "DE SESSOES")).toBe("de Sessões")
  })

  it("trecho no começo ou no fim não gera pedaço vazio", () => {
    expect(destacar("Laura", "laura")).toEqual([{ texto: "Laura", casou: true }])
  })

  it("sem casamento ou termo vazio: texto inteiro sem marca", () => {
    expect(destacar("João Pedro", "laura")).toEqual([{ texto: "João Pedro", casou: false }])
    expect(destacar("João Pedro", "  ")).toEqual([{ texto: "João Pedro", casou: false }])
  })

  it("cedilha e til casam com a letra simples", () => {
    expect(marcado("Conferência de Guias", "conferencia")).toBe("Conferência")
    expect(marcado("Solicitações", "solicitacoes")).toBe("Solicitações")
  })
})
