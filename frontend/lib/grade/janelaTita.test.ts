import { describe, expect, it } from "vitest"
import { janelaReleituraTita } from "./janelaTita"

describe("janelaReleituraTita", () => {
  it("vai de hoje até a sexta da primeira semana completa do mês seguinte", () => {
    // Novembro/2026 começa num domingo: primeira semana completa 02–06/11.
    expect(janelaReleituraTita("2026-10-20")).toEqual({ inicio: "2026-10-20", fim: "2026-11-06" })
  })

  it("mês seguinte começando na segunda usa essa própria semana", () => {
    // Fevereiro/2027 começa numa segunda.
    expect(janelaReleituraTita("2027-01-15")).toEqual({ inicio: "2027-01-15", fim: "2027-02-05" })
  })

  it("mês seguinte começando na sexta pula para a segunda seguinte", () => {
    // Janeiro/2027 começa numa sexta: primeira semana completa 04–08/01.
    expect(janelaReleituraTita("2026-12-10")).toEqual({ inicio: "2026-12-10", fim: "2027-01-08" })
  })
})
