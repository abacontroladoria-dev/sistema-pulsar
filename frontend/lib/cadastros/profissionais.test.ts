import { describe, expect, it } from "vitest"
import { corFocal, formatarCelular, iniciaisNome, registroCompleto, terapiasDoProfissional } from "./profissionais"
import { indicePorNome, separarTerapias } from "./terapias"
import type { CadastroTerapia } from "@/types/terapia"

const t = (id: number, nome: string, cor: string): CadastroTerapia => ({
  id, nome, cor_hex: cor, tipo: "terapia", tita_terapia_id: null, icone: null, ativo: true, atualizado_em: "",
})
const CATALOGO = [t(1, "Psicomotricidade", "#39A8F9"), t(2, "Psicopedagogia", "#FFFB73"), t(3, "Terapia Ocupacional", "#0B13CA")]
const porId = new Map(CATALOGO.map(c => [c.id, c]))
const porNome = indicePorNome(CATALOGO)

describe("separarTerapias", () => {
  it("separa o horário com várias terapias e ignora 'Ainda não selecionado'", () => {
    expect(separarTerapias("Aplicador ABA (AE), Arteterapia,  Psicopedagogia")).toEqual([
      "Aplicador ABA (AE)", "Arteterapia", "Psicopedagogia",
    ])
    expect(separarTerapias("Ainda não selecionado")).toEqual([])
    expect(separarTerapias(null)).toEqual([])
  })
})

describe("terapiasDoProfissional", () => {
  it("junta habilitadas e grade sem repetir, casando nome sem acento/caixa", () => {
    const r = terapiasDoProfissional(
      { terapia_focal_id: null },
      [2],
      [{ terapia: "psicopedagogia", horarios: 4 }, { terapia: "Psicomotricidade", horarios: 32 }, { terapia: "Arteterapia", horarios: 1 }],
      porId,
      porNome
    )
    expect(r.map(x => x.nome)).toEqual(["Psicomotricidade", "Psicopedagogia", "Arteterapia"])
    expect(r[1]).toMatchObject({ habilitada: true, horariosGrade: 4, terapiaId: 2 })
    expect(r[2]).toMatchObject({ habilitada: false, terapiaId: null })
  })

  it("a focal vem primeiro mesmo com menos horários", () => {
    const r = terapiasDoProfissional(
      { terapia_focal_id: 2 },
      [1, 2],
      [{ terapia: "Psicomotricidade", horarios: 32 }, { terapia: "Psicopedagogia", horarios: 4 }],
      porId,
      porNome
    )
    expect(r[0].nome).toBe("Psicopedagogia")
    expect(corFocal({ terapia_focal_id: 2 }, r).cor).toBe("#FFFB73")
  })
})

describe("corFocal", () => {
  it("sem escolha usa a de mais horários; sem terapia, cinza neutro", () => {
    const r = terapiasDoProfissional({ terapia_focal_id: null }, [], [{ terapia: "Terapia Ocupacional", horarios: 9 }], porId, porNome)
    expect(corFocal({ terapia_focal_id: null }, r).cor).toBe("#0B13CA")
    expect(corFocal({ terapia_focal_id: null }, []).cor).toBe("#CBD5E1")
  })
  it("focal que não é mais do profissional cai para a primeira", () => {
    const r = terapiasDoProfissional({ terapia_focal_id: 99 }, [1], [], porId, porNome)
    expect(corFocal({ terapia_focal_id: 99 }, r).terapia?.nome).toBe("Psicomotricidade")
  })
})

describe("formatação", () => {
  it("registro, celular e iniciais", () => {
    expect(registroCompleto({ tipo_registro: "CRP", codigo_registro: "05/12345", uf_registro: "RJ" })).toBe("CRP 05/12345 · RJ")
    expect(registroCompleto({ tipo_registro: null, codigo_registro: null, uf_registro: null })).toBeNull()
    expect(formatarCelular("21999998888")).toBe("(21) 99999-8888")
    expect(formatarCelular("2133334444")).toBe("(21) 3333-4444")
    expect(iniciaisNome("João Gabriel Barbosa de Souza")).toBe("JS")
    expect(iniciaisNome("Pauline")).toBe("P")
  })
})

describe("compararTom", () => {
  it("agrupa por família de cor e deixa os neutros no fim", async () => {
    const { compararTom } = await import("./terapias")
    const cores = ["#CBD5E1", "#39A8F9", "#E89D9D", "#FFFB73", "#0B13CA", "#000000", "#E0B00F", "#FFAD98", "#95EF9C"]
    const ordem = [...cores].sort(compararTom)
    // Vermelhos/salmões juntos, amarelos juntos, verde, azuis juntos; cinza e preto no fim.
    expect(ordem.slice(-2)).toEqual(["#CBD5E1", "#000000"])
    const iAzul1 = ordem.indexOf("#39A8F9"), iAzul2 = ordem.indexOf("#0B13CA")
    expect(Math.abs(iAzul1 - iAzul2)).toBe(1)
    const iAm1 = ordem.indexOf("#FFFB73"), iAm2 = ordem.indexOf("#E0B00F")
    expect(Math.abs(iAm1 - iAm2)).toBeLessThanOrEqual(1)
  })
})
