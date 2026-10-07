// Valor por sessão diferente por terapia dentro do MESMO contrato
// (ContratoAtualItem.valoresPorTerapia, migration 20261007150000).
//
// Caso real: Brena Alves Soares de Barros, contrato único PS.ABA-01-00000025 a
// R$ 30 por sessão, exceto Avaliação Neuropsicopedagógica a R$ 45. Antes da
// exceção existir, o contrato único pagava R$ 30 em tudo.

import { describe, expect, test } from "vitest"
import { resolverPARow, type CadastroContratual, type ContratoAtualItem } from "./calculo"

const TAXAS = { "Psicopedagogia": 30, "Avaliação Neuropsicopedagógica": 45, "Fonoaudiologia": 30 }
const cfg = (contratosAtuais: ContratoAtualItem[]) => ({
  ccPA: 35,
  taxasPA: TAXAS,
  cadastroContratual: { nome: "Brena Alves Soares de Barros", contratosAtuais } satisfies CadastroContratual,
})
const pa = (especialidade: string, contratos: ContratoAtualItem[]) =>
  resolverPARow({ especialidade }, undefined, cfg(contratos)).valor

const HISTORICO: ContratoAtualItem = {
  numero: "PS.ABA-2024-0304", funcao: "Psicopedagogia", valorPA: 0, vigente: false,
  modeloFaturamento: "banco_horas", valorTotal: 4800,
}
const BRENA: ContratoAtualItem = {
  numero: "PS.ABA-01-00000025", funcao: "", valorPA: 30, vigente: true, modeloFaturamento: "atendimento",
  valoresPorTerapia: [{ terapia: "Avaliação Neuropsicopedagógica", valorPA: 45 }],
}

describe("contrato único com valor por terapia", () => {
  test("a terapia da exceção paga o valor dela; o resto paga o PA do contrato", () => {
    expect(pa("Avaliação Neuropsicopedagógica", [HISTORICO, BRENA])).toBe(45)
    expect(pa("Psicopedagogia", [HISTORICO, BRENA])).toBe(30)
  })

  test("a exceção casa sem depender de caixa/acento/espaço", () => {
    expect(pa("  AVALIACAO neuropsicopedagogica ", [BRENA])).toBe(45)
  })

  test("a exceção vence a tabela de Taxas, como o PA do contrato já vencia", () => {
    const c = { ...BRENA, valoresPorTerapia: [{ terapia: "Psicopedagogia", valorPA: 50 }] }
    expect(pa("Psicopedagogia", [c])).toBe(50)
  })

  test("exceção de valor zero é respeitada (0 explícito), não cai no PA geral", () => {
    const c = { ...BRENA, valoresPorTerapia: [{ terapia: "Avaliação Neuropsicopedagógica", valorPA: 0 }] }
    expect(pa("Avaliação Neuropsicopedagógica", [c])).toBe(0)
  })

  test("sem exceção, nada muda: o PA do contrato único vale para tudo", () => {
    const semExcecao = { ...BRENA, valoresPorTerapia: null }
    expect(pa("Avaliação Neuropsicopedagógica", [semExcecao])).toBe(30)
    expect(pa("Psicopedagogia", [semExcecao])).toBe(30)
  })

  test("exceção em contrato histórico não vale", () => {
    const antigo = { ...HISTORICO, modeloFaturamento: "atendimento" as const, valorPA: 20,
      valoresPorTerapia: [{ terapia: "Avaliação Neuropsicopedagógica", valorPA: 99 }] }
    const atual = { ...BRENA, valoresPorTerapia: null }
    expect(pa("Avaliação Neuropsicopedagógica", [antigo, atual])).toBe(30)
  })

  test("explicação diz que o valor veio da exceção do contrato", () => {
    const info = resolverPARow({ especialidade: "Avaliação Neuropsicopedagógica" }, undefined, cfg([BRENA]))
    expect(info.explicacao).toContain("valor proprio para Avaliação Neuropsicopedagógica")
  })
})

describe("dois contratos vigentes", () => {
  const FONO: ContratoAtualItem = {
    numero: "F-1", funcao: "Fonoaudiologia", valorPA: 40, vigente: true, modeloFaturamento: "atendimento",
  }

  test("a sessão da terapia com exceção usa o contrato que tem a exceção", () => {
    expect(pa("Avaliação Neuropsicopedagógica", [FONO, BRENA])).toBe(45)
  })

  test("contrato que nomeia a função continua tendo prioridade", () => {
    expect(pa("Fonoaudiologia", [FONO, BRENA])).toBe(40)
  })

  test("terapia sem função nem exceção cai no contrato sem função", () => {
    expect(pa("Psicopedagogia", [FONO, BRENA])).toBe(30)
  })
})
