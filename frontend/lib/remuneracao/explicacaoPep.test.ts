// Explicação da PEP apurada de um paciente (tooltip da coluna "PEP apurada").
//
//   npx vitest run lib/remuneracao/explicacaoPep.test.ts

import { describe, expect, test } from "vitest"

import { explicarPepPaciente } from "./explicacaoPep"
import { calcularPEPPaciente } from "./calculoPEP"
import type { PepCatalogoItem } from "@/types/pep"

const item = (extra: Partial<PepCatalogoItem>): PepCatalogoItem => ({
  id: extra.codigo ?? "x", codigo: "x", sigla: "X", nome: "Item", classe: "recorrente", tipo_registro: "POR_PACIENTE",
  periodicidade: "mensal", qtd_referencia_mes: 1, peso_mensal: 0.1, ativo: true, ...extra,
})

const catalogo: PepCatalogoItem[] = [
  item({ codigo: "STC", sigla: "STC", nome: "Supervisão técnica de caso", tipo_registro: "GERAL", periodicidade: "semanal", qtd_referencia_mes: null, peso_mensal: 0.30 }),
  item({ codigo: "ETC", sigla: "ETC", nome: "Estudo técnico de caso", tipo_registro: "GERAL", periodicidade: "semanal", qtd_referencia_mes: null, peso_mensal: 0.10 }),
  item({ codigo: "TAP", sigla: "TAP", nome: "Treino de aplicador", qtd_referencia_mes: 2, peso_mensal: 0.10 }),
  item({ codigo: "PEI", sigla: "PEI", nome: "Plano de ensino individualizado", classe: "semestral", periodicidade: "semestral", peso_mensal: 0.20 }),
  item({ codigo: "AVA", sigla: "AVA", nome: "Avaliação", classe: "semestral", periodicidade: "semestral", peso_mensal: 0.10 }),
]

/** Monta a linha gravada exatamente como apurarESalvarPEP grava. */
function apurado(input: Parameters<typeof calcularPEPPaciente>[0], devolucao = 0) {
  const r = calcularPEPPaciente(input)
  return {
    valor_bruto: r.valorBruto,
    valor_liquido: Math.round((r.valorLiquido + devolucao) * 100) / 100,
    ajuste_recorrentes: r.ajusteRecorrentes,
    ajuste_semestrais: r.ajusteSemestrais,
    saldo_remanescente_anterior: r.saldoRemanescenteAnteriorAplicado,
    saldo_remanescente_novo: r.saldoRemanescenteNovo,
    devolucao_valor: devolucao,
    modo_teste: r.modoTeste,
    estado: "apurado" as const,
  }
}

const V = 133.34
const gerais = [
  { itemCodigo: "STC", pesoMensal: 0.30, quantidadeEsperada: 4, quantidadeEntregue: 2 }, // STC 2/4
  { itemCodigo: "ETC", pesoMensal: 0.10, quantidadeEsperada: 4, quantidadeEntregue: 4 }, // ETC 4/4
]
const tapCompleto = { itemCodigo: "TAP", pesoMensal: 0.10, quantidadeEsperada: 2, quantidadeEntregue: 2 }

describe("explicarPepPaciente", () => {
  test("R$ 86,67 de R$ 133,34: STC geral faltando 2 de 4 + semestral de 20% vencido", () => {
    const e = explicarPepPaciente(apurado({
      valorBruto: V, entregasRecorrentes: [...gerais, tapCompleto],
      pendenciasSemestrais: [{ itemCodigo: "PEI", percentualAjuste: 0.20 }],
    }), catalogo, 4)

    expect(e.liquido).toBe(86.67)
    // Itens entregues por completo (ETC, TAP) não aparecem.
    expect(e.linhas).toEqual([
      { tipo: "recorrente", sigla: "STC", nome: "Supervisão técnica de caso", geral: true, faltantes: 2, esperadas: 4, percentual: 0.15, valor: 20 },
      { tipo: "semestral", sigla: "PEI", nome: "Plano de ensino individualizado", geral: false, percentual: 0.20, valor: 26.67 },
    ])
    expect(e.faltaPara100).toBeCloseTo(46.67)
    expect(e.recuperavelComEntregas).toBeCloseTo(46.67)
    // A conta fecha com o que está gravado.
    expect(e.potencial - e.linhas.reduce((s, l) => s + l.valor, 0)).toBeCloseTo(e.liquido)
  })

  test("R$ 100,01 de R$ 133,34: mesmo STC + semestral de 10%", () => {
    const e = explicarPepPaciente(apurado({
      valorBruto: V, entregasRecorrentes: [...gerais, tapCompleto],
      pendenciasSemestrais: [{ itemCodigo: "AVA", percentualAjuste: 0.10 }],
    }), catalogo, 4)
    expect(e.liquido).toBe(100.01)
    expect(e.linhas.map(l => [l.sigla, l.valor])).toEqual([["STC", 20], ["AVA", 13.33]])
  })

  test("saldo alto de meses anteriores: entregar não recupera o que o piso zero engoliu", () => {
    const e = explicarPepPaciente(apurado({
      valorBruto: V, entregasRecorrentes: gerais, pendenciasSemestrais: [], saldoRemanescenteAnterior: 150,
    }), catalogo, 4)
    expect(e.liquido).toBe(0)
    expect(e.linhas.map(l => l.tipo)).toEqual(["recorrente", "saldoAnterior"])
    expect(e.recuperavelComEntregas).toBe(0)
    expect(e.saldoParaProximoMes).toBeCloseTo(20 + 150 - V)
  })

  test("modo teste: ajustes aparecem, mas o mês paga 100% e não há o que recuperar", () => {
    const e = explicarPepPaciente(apurado({
      valorBruto: V, entregasRecorrentes: gerais, pendenciasSemestrais: [], modoTeste: true,
    }), catalogo, 4)
    expect(e.modoTeste).toBe(true)
    expect(e.liquido).toBe(V)
    expect(e.linhas).toHaveLength(1)
    expect(e.faltaPara100).toBe(0)
    expect(e.recuperavelComEntregas).toBe(0)
  })

  test("devolução soma; item fora do catálogo cai no código", () => {
    const e = explicarPepPaciente({
      ...apurado({ valorBruto: V, entregasRecorrentes: [{ itemCodigo: "ZZZ", pesoMensal: 0.1, quantidadeEsperada: 1, quantidadeEntregue: 0 }], pendenciasSemestrais: [] }, 10),
    }, catalogo, 4)
    expect(e.linhas[0]).toMatchObject({ sigla: "ZZZ", nome: "ZZZ", faltantes: undefined })
    expect(e.linhas.at(-1)).toMatchObject({ tipo: "devolucao", valor: 10 })
    expect(e.liquido).toBeCloseTo(V - 13.33 + 10)
  })
})
