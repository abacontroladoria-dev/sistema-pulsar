import { describe, expect, it } from "vitest"
import { contraste, estiloTons, tonsDaTerapia } from "./tonsTerapia"

// Cores reais do catálogo: claríssima (Psicopedagogia), escura (Terapia
// Ocupacional), preta (Supervisão ABA), cinza neutro e médias.
const CORES = ["#FFFB73", "#0B13CA", "#000000", "#CBD5E1", "#39A8F9", "#E0B00F", "#D4A9F5", "#E9FECE", "#946D05", "#C81ED5"]

describe("tonsDaTerapia", () => {
  it("texto 700 tem contraste ≥ 6:1 no branco e no fundo 50 (tema claro)", () => {
    for (const c of CORES) {
      const t = tonsDaTerapia(c)!.claro
      expect(contraste(t["700"], "#FFFFFF"), c).toBeGreaterThanOrEqual(6)
      expect(contraste(t["700"], t["50"]), c).toBeGreaterThanOrEqual(6)
    }
  })

  it("texto 700 tem contraste ≥ 6:1 no fundo 50 (tema escuro)", () => {
    for (const c of CORES) {
      const t = tonsDaTerapia(c)!.escuro
      expect(contraste(t["700"], t["50"]), c).toBeGreaterThanOrEqual(6)
    }
  })

  it("fundo 50 é quase branco no claro, independentemente da cor cadastrada", () => {
    for (const c of CORES) expect(contraste(tonsDaTerapia(c)!.claro["50"], "#FFFFFF"), c).toBeLessThan(1.15)
  })

  it("cor inválida devolve null e o estilo fica vazio (CSS cai no neutro)", () => {
    expect(tonsDaTerapia("vermelho")).toBeNull()
    expect(tonsDaTerapia(null)).toBeNull()
    expect(estiloTons("xyz")).toEqual({})
    expect(Object.keys(estiloTons("#39A8F9"))).toEqual(
      expect.arrayContaining(["--tl-50", "--tl-300", "--tl-500", "--tl-700", "--td-50", "--td-700"])
    )
  })
})
