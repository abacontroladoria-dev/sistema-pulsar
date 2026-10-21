import { describe, expect, it } from "vitest"
import { montarPontosOcupacao, montarPontosPacientes } from "./evolucaoPontos"

describe("montarPontosOcupacao", () => {
  it("métricas das contagens e status pela linha da rede, em ordem de mês", () => {
    const base = { aberta: 10, administrativo: 5, regularizar: 5, vazia: 30 }
    const p = montarPontosOcupacao([
      { competencia: "2026-10", unidade: "__rede__", total: 100, paciente: 50, status: "parcial", ...base },
      { competencia: "2026-09", unidade: "__rede__", total: 100, paciente: 40, status: "aproximado", ...base },
      { competencia: "2026-09", unidade: "Realengo", total: 0, paciente: 0, status: "aproximado", ...base, vazia: 0 },
    ])
    expect(p.map(x => [x.competencia, x.status])).toEqual([["2026-09", "aproximado"], ["2026-10", "parcial"]])
    const rede = p[1].valores.__rede__
    expect(rede.pctPaciente).toBe(0.5)
    expect(rede.pctProfissional).toBe(0.7) // 50+10+5+5
    expect(rede.aproveitamento).toBeCloseTo(50 / 70, 6)
    expect(rede.vagasLivres).toBe(30)
    expect(p[0].valores.Realengo.pctPaciente).toBeNull() // total 0 → sem dado
  })
})

describe("montarPontosPacientes", () => {
  it("filtra o segmento", () => {
    const linhas = [
      { competencia: "2026-08", segmento: "multidisciplinar" as const, unidade: "__total__", pacientes: 272, sessoes: 10939, horas: 7277.33, status: "fechado" as const },
      { competencia: "2026-08", segmento: "diagnostico" as const, unidade: "__total__", pacientes: 44, sessoes: 112, horas: 107.33, status: "fechado" as const },
    ]
    expect(montarPontosPacientes(linhas, "diagnostico")[0].valores.__total__.sessoes).toBe(112)
    expect(montarPontosPacientes(linhas, "multidisciplinar")[0].valores.__total__.sessoes).toBe(10939)
  })
})
