// Visão geral de Entregas PEP — conta do mês a partir da Grade + linhas já
// apuradas, sem apurar nada.
//
//   npx vitest run lib/remuneracao/visaoGeralPep.test.ts

import { describe, expect, test, vi } from "vitest"

import {
  analistasDaGrade, pacientesCCDoProfissional, resumoPepCompetencia, type AnalistaDaGrade,
} from "./visaoGeralPep"
import type { ProfRemunReal, SessaoComPapel } from "./calculo"
import type { PepApuracaoLinhaCompetencia } from "@/services/pepApuracao.service"

const sess = (especialidade: string, paciente: string) => ({ especialidade, paciente }) as unknown as SessaoComPapel
const prof = (nome: string, sessoes: SessaoComPapel[]) => ({ prof: nome, sessoes }) as unknown as ProfRemunReal

const linha = (
  prestador: string, paciente: string, extra: Partial<PepApuracaoLinhaCompetencia> = {}
): PepApuracaoLinhaCompetencia => ({
  prestador_nome: prestador, paciente_nome: paciente,
  valor_bruto: 100, valor_liquido: 100,
  ajuste_recorrentes_valor: 0, ajuste_semestrais_valor: 0, devolucao_valor: 0,
  saldo_remanescente_anterior: 0, saldo_remanescente_novo: 0,
  estado: "apurado", modo_teste: false,
  ...extra,
})

describe("roster da Grade", () => {
  test("só quem tem sessão de Coordenador de Caso, com os pacientes dessas sessões", () => {
    const r = analistasDaGrade([
      prof("Bia", [sess("Coordenador de Caso", "P2"), sess("Coordenador de Caso", "P1"), sess("Coordenador de Caso", "P1"), sess("Aplicador ABA", "P9")]),
      prof("Caio", [sess("Psicologia", "P3")]),
      prof("Ana", [sess("Coordenador de Caso", "P4")]),
    ])
    expect(r).toEqual([
      { nome: "Ana", pacientes: ["P4"] },
      { nome: "Bia", pacientes: ["P1", "P2"] },
    ])
  })

  test("paciente vazio não entra", () => {
    expect(pacientesCCDoProfissional(prof("X", [sess("Coordenador de Caso", "")]))).toEqual([])
  })
})

describe("resumoPepCompetencia", () => {
  const analistas: AnalistaDaGrade[] = [
    { nome: "Ana", pacientes: ["A1", "A2"] },          // liberado
    { nome: "Beto", pacientes: ["B1", "B2", "B3"] },   // parcial
    { nome: "Caio", pacientes: ["C1"] },               // não aberto
    { nome: "Duda", pacientes: ["D1"] },               // apurado, com desconto
  ]
  const linhas = [
    linha("Ana", "A1", { estado: "liberado" }),
    linha("Ana", "A2", { estado: "liberado" }),
    linha("Beto", "B1"),
    linha("Duda", "D1", { valor_liquido: 70, ajuste_recorrentes_valor: 20, ajuste_semestrais_valor: 10 }),
    linha("Eva", "E1", { valor_liquido: 80 }),           // fora da Grade
    linha("Beto", "A1", { valor_liquido: 50 }),          // paciente que não é do Beto na Grade
  ]
  const r = resumoPepCompetencia({ analistas, linhas, valorPorPaciente: 100, competencia: "2026-09" })

  test("totais e a conta do teto fecha", () => {
    expect(r.analistas).toBe(4)
    expect(r.pacientes).toBe(7)
    expect(r.pacientesPorAnalista).toEqual({ media: 7 / 4, min: 1, max: 3 })
    expect(r.teto).toBe(700)
    expect(r.apurado).toBe(100 + 100 + 100 + 70)
    expect(r.descontos.total).toBe(30)
    expect(r.naoApurado).toBe(300)
    expect(r.pacientesNaoApurados).toBe(3)
    expect(r.apurado + r.descontos.total + r.naoApurado).toBeCloseTo(r.teto)
    expect(r.descontos).toMatchObject({ recorrentes: 20, semestrais: 10 })
    expect(r.modoTeste).toBe(false)
  })

  test("status por analista e a ordem da tabela (o que falta fazer primeiro)", () => {
    expect(r.porAnalista.map(a => [a.nome, a.status])).toEqual([
      ["Caio", "nao_aberto"],
      ["Beto", "parcial"],
      ["Duda", "apurado"],
      ["Ana", "liberado"],
    ])
    expect(r.porStatus).toEqual({ nao_aberto: 1, parcial: 1, apurado: 1, liberado: 1 })
    const beto = r.porAnalista.find(a => a.nome === "Beto")!
    expect(beto).toMatchObject({ pacientes: 3, teto: 300, apurado: 100, naoApurado: 200, pacientesSemApuracao: ["B2", "B3"] })
    expect(beto.pctTeto).toBeCloseTo(100 / 3)
  })

  test("linhas fora da Grade ficam à parte e fora da conta", () => {
    expect(r.foraDaGrade).toEqual([
      { prestador: "Beto", paciente: "A1", valorLiquido: 50 },
      { prestador: "Eva", paciente: "E1", valorLiquido: 80 },
    ])
  })

  test("liberado só quando TODAS as linhas estão liberadas", () => {
    const misto = resumoPepCompetencia({
      analistas: [{ nome: "Ana", pacientes: ["A1", "A2"] }],
      linhas: [linha("Ana", "A1", { estado: "liberado" }), linha("Ana", "A2")],
      valorPorPaciente: 100, competencia: "2026-09",
    })
    expect(misto.porAnalista[0].status).toBe("apurado")
  })

  test("analista sem paciente e competência de teste", () => {
    const vazio = resumoPepCompetencia({
      analistas: [{ nome: "Zé", pacientes: [] }], linhas: [], valorPorPaciente: 100, competencia: "2026-08",
    })
    expect(vazio.porAnalista[0]).toMatchObject({ teto: 0, pctTeto: null, status: "nao_aberto" })
    expect(vazio.modoTeste).toBe(true)
    expect(vazio.teto).toBe(0)
  })

  test("valores numéricos que chegam como texto do PostgREST", () => {
    const texto = resumoPepCompetencia({
      analistas: [{ nome: "Ana", pacientes: ["A1"] }],
      linhas: [linha("Ana", "A1", { valor_bruto: "100.00" as unknown as number, valor_liquido: "90.50" as unknown as number })],
      valorPorPaciente: 100, competencia: "2026-09",
    })
    expect(texto.apurado).toBeCloseTo(90.5)
    expect(texto.descontos.total).toBeCloseTo(9.5)
  })
})

// ─── Serviço: paginação ──────────────────────────────────────────────────────

const ranges: [number, number][] = []
vi.mock("@/lib/supabase/client", () => {
  const TOTAL = 1200
  const builder = () => {
    let de = 0, ate = 0
    const q = {
      select: () => q, eq: () => q, order: () => q,
      range: (a: number, b: number) => { de = a; ate = b; ranges.push([a, b]); return q },
      then: (resolve: (v: unknown) => void) => {
        const fim = Math.min(ate, TOTAL - 1)
        const data = de > fim ? [] : Array.from({ length: fim - de + 1 }, (_, i) => ({ paciente_nome: `P${de + i}` }))
        resolve({ data, error: null })
      },
    }
    return q
  }
  return { getSupabaseClient: () => ({ from: builder }) }
})

describe("getApuracaoCompetencia", () => {
  test("pagina de 1000 em 1000 até a última página incompleta", async () => {
    const { getApuracaoCompetencia } = await import("@/services/pepApuracao.service")
    const { data, error } = await getApuracaoCompetencia("2026-09")
    expect(error).toBeNull()
    expect(data).toHaveLength(1200)
    expect(ranges).toEqual([[0, 999], [1000, 1999]])
  })
})
