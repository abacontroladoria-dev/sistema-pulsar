// Situação das entregas por analista (o que vira o status na Visão geral).
//
//   npx vitest run lib/remuneracao/situacaoEntregasPep.test.ts

import { describe, expect, test } from "vitest"
import { esperadasPorEntrega, evidenciasEsperadasPorAnalista, situacaoEntregasPorAnalista, somarMeses, type DadosSituacao } from "./situacaoEntregasPep"
import type { PepCatalogoItem } from "@/types/pep"

const item = (id: string, extra: Partial<PepCatalogoItem>): PepCatalogoItem => ({
  id, codigo: id, sigla: id.toUpperCase(), nome: id, classe: "recorrente", tipo_registro: "GERAL", periodicidade: "mensal",
  qtd_referencia_mes: 1, peso_mensal: 0.1, ativo: true, ...extra,
})
const STC = item("stc", { periodicidade: "semanal", qtd_referencia_mes: 4 })
const TAP = item("tap", { tipo_registro: "POR_PACIENTE", periodicidade: "quinzenal", qtd_referencia_mes: 2 })
const PIC = item("pic", { classe: "semestral", tipo_registro: "POR_PACIENTE", periodicidade: "semestral", qtd_referencia_mes: null })

const base = (extra: Partial<DadosSituacao> = {}): DadosSituacao => ({
  catalogo: [STC, TAP, PIC], registros: [], planos: [], entregasSemestrais: [], sugestoes: [], conferencias: [],
  semanasEsperadas: 4, ...extra,
})
const reg = (paciente: string | null, item_id: string, q: number, updated_at = "2026-09-10T10:00:00Z") =>
  ({ prestador_nome: "Ana", paciente_nome: paciente, item_id, status: "pendente" as const, quantidade_entregue: q, updated_at })
const ana = [{ nome: "Ana", pacientes: ["P1"] }]
const sit = (d: DadosSituacao) => situacaoEntregasPorAnalista(ana, d, "2026-09").get("Ana")!

describe("situacaoEntregasPorAnalista", () => {
  test("nada entregue: faltam as unidades de todos os itens recorrentes", () => {
    expect(sit(base()).unidadesFaltando).toBe(4 + 2) // STC 4 semanas + TAP 2 do P1
  })

  test("tudo entregue: nada falta", () => {
    const s = sit(base({ registros: [reg(null, "stc", 4), reg("P1", "tap", 2)] }))
    expect(s).toMatchObject({ unidadesFaltando: 0, semestraisVencidas: 0, sugestoesEsperando: 0, conferido: null })
  })

  test("mês de recesso espera 3 semanas", () => {
    expect(sit(base({ semanasEsperadas: 3, registros: [reg(null, "stc", 3), reg("P1", "tap", 2)] })).unidadesFaltando).toBe(0)
  })

  test("semestral vencida só conta sem entrega no ciclo", () => {
    const plano = [{ paciente_nome: "P1", item_id: "pic", competencia_planejada: "2026-09" }]
    const ok = [reg(null, "stc", 4), reg("P1", "tap", 2)]
    expect(sit(base({ registros: ok, planos: plano })).semestraisVencidas).toBe(1)
    expect(sit(base({ registros: ok, planos: plano, entregasSemestrais: [{ paciente_nome: "P1", item_id: "pic", competencia: "2026-06" }] })).semestraisVencidas).toBe(0)
    // entrega de antes do ciclo (mais de 5 meses) não vale
    expect(sit(base({ registros: ok, planos: plano, entregasSemestrais: [{ paciente_nome: "P1", item_id: "pic", competencia: "2026-03" }] })).semestraisVencidas).toBe(1)
    // planejada para depois: ainda não venceu
    expect(sit(base({ registros: ok, planos: [{ ...plano[0], competencia_planejada: "2026-12" }] })).semestraisVencidas).toBe(0)
  })

  test("sugestão que o robô entrega sozinho não espera pessoa; a fora do padrão espera", () => {
    const s = sit(base({ sugestoes: [
      { prestador_nome: "Ana", padrao: "ok", robo_obs: null },
      { prestador_nome: "Ana", padrao: "fora", robo_obs: null },
      { prestador_nome: "Ana", padrao: "ok", robo_obs: "excedente" },
      { prestador_nome: "Beto", padrao: "fora", robo_obs: null },
    ] }))
    expect(s.sugestoesEsperando).toBe(2)
  })

  test("conferência vale até alguém mexer nas entregas", () => {
    const conf = [{ prestador_nome: "Ana", conferido_em: "2026-09-20T12:00:00Z", conferido_por_nome: "Rita" }]
    const antes = sit(base({ conferencias: conf, registros: [reg(null, "stc", 4, "2026-09-19T12:00:00Z")] }))
    expect(antes.conferido).toEqual({ por: "Rita", em: "2026-09-20T12:00:00Z" })
    const depois = sit(base({ conferencias: conf, registros: [reg(null, "stc", 3, "2026-09-21T12:00:00Z")] }))
    expect(depois.conferido).toBeNull()
    expect(depois.conferenciaInvalidada).toBe(true)
  })

  test("somarMeses atravessa o ano", () => {
    expect(somarMeses("2026-02", -5)).toBe("2025-09")
    expect(somarMeses("2026-11", 3)).toBe("2027-02")
  })
})

describe("evidenciasEsperadasPorAnalista", () => {
  const ev = (sigla: string, paciente: string | null, padrao: string) => ({ prestador_nome: "Ana", paciente_nome: paciente, sigla, padrao })
  const esp = (evs: ReturnType<typeof ev>[], d = base()) => evidenciasEsperadasPorAnalista(ana, d, evs, "2026-09")[0]

  test("esperadas = STC 4 + TAP 2 do paciente; sem nada na pasta, tudo falta", () => {
    expect(esp([])).toMatchObject({ esperadas: 6, naPasta: 0, faltam: 6, foraDoPadrao: 0 })
  })

  test("só o nome no padrão conta, sem passar do esperado do item", () => {
    const r = esp([ev("STC", null, "ok"), ev("STC", null, "ok"), ev("TAP", "P1", "ok"), ev("TAP", "P1", "ok"), ev("TAP", "P1", "ok"), ev("TAP", "P1", "fora")])
    expect(r).toMatchObject({ esperadas: 6, naPasta: 4, faltam: 2, foraDoPadrao: 1 })
  })

  test("semestral vencida entra nas esperadas; sem entrega, nunca na pasta", () => {
    const d = base({ planos: [{ paciente_nome: "P1", item_id: "pic", competencia_planejada: "2026-09" }] })
    expect(esp([], d)).toMatchObject({ esperadas: 7, naPasta: 0, faltam: 7 })
  })

  test("evidência de outro analista não conta", () => {
    expect(esp([{ prestador_nome: "Beto", paciente_nome: null, sigla: "STC", padrao: "ok" }])).toMatchObject({ naPasta: 0 })
  })

  test("por entrega: soma dos analistas, com semestral vencida só no esperado", () => {
    const d = base({ planos: [{ paciente_nome: "P1", item_id: "pic", competencia_planejada: "2026-09" }] })
    const lista = evidenciasEsperadasPorAnalista(
      [{ nome: "Ana", pacientes: ["P1"] }, { nome: "Beto", pacientes: [] }], d,
      [ev("STC", null, "ok"), ev("TAP", "P1", "ok")], "2026-09")
    const porEntrega = esperadasPorEntrega(lista, d.catalogo)
    expect(porEntrega.map(e => [e.sigla, e.esperadas, e.naPasta])).toEqual([["STC", 8, 1], ["TAP", 2, 1], ["PIC", 1, 0]])
    expect(porEntrega.find(e => e.sigla === "PIC")!.faltam).toBe(1)
  })
})
