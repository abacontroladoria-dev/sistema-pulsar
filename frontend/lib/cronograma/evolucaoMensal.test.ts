import { describe, expect, it } from "vitest"
import { filtrarPorRange, formatarTickEixoY } from "./evolucaoMensal"

const serie = (n: number) => Array.from({ length: n }, (_, i) => ({ ano: 2024 + Math.floor(i / 12), mes: (i % 12) + 1 }))

describe("filtrarPorRange", () => {
  it("1A = últimos 12 meses", () => {
    const r = filtrarPorRange(serie(30), "1A")
    expect(r.length).toBe(12)
    expect(r[0]).toEqual({ ano: 2025, mes: 7 })
  })
  it("Máx = tudo", () => {
    expect(filtrarPorRange(serie(30), "MAX").length).toBe(30)
  })
  it("5A com menos de 60 meses = tudo", () => {
    expect(filtrarPorRange(serie(30), "5A").length).toBe(30)
  })
  it("mês selecionado anterior à janela estica a janela até ele", () => {
    const r = filtrarPorRange(serie(30), "1A", { ano: 2024, mes: 3 })
    expect(r[0]).toEqual({ ano: 2024, mes: 3 })
    expect(r.length).toBe(28)
  })
  it("série vazia", () => {
    expect(filtrarPorRange([], "1A")).toEqual([])
  })
})

describe("formatarTickEixoY", () => {
  it("abrevia acima de mil", () => {
    expect(formatarTickEixoY(12069)).toBe("12,1k")
    expect(formatarTickEixoY(3000)).toBe("3k")
    expect(formatarTickEixoY(850)).toBe("850")
  })
})
