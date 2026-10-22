import { describe, expect, it } from "vitest"
import { buscarFerramentas } from "./buscarFerramentas"

const tudo = () => true

describe("buscarFerramentas", () => {
  it("termo vazio não devolve nada", () => {
    expect(buscarFerramentas("   ", tudo)).toEqual([])
  })

  it("ignora acento e maiúscula, e mostra o caminho com a área", () => {
    const [r] = buscarFerramentas("COMPARATIVO de sessoes", tudo)
    expect(r.item.codigo).toBe("indicadores_comparativo_sessoes")
    expect(r.caminho).toBe("Relatórios › Indicadores")
  })

  it("acha pela palavra-chave", () => {
    expect(buscarFerramentas("faltas", tudo).map((r) => r.item.codigo)).toContain("reposicao_faltas")
    expect(buscarFerramentas("insumos", tudo).map((r) => r.item.codigo)).toEqual(["insumos"])
  })

  it("nome que começa com o termo vem antes de nome que só contém", () => {
    const codigos = buscarFerramentas("pac", tudo).map((r) => r.item.codigo)
    expect(codigos.indexOf("cadastros_pacientes")).toBeLessThan(codigos.indexOf("indicadores_pacientes"))
  })

  it("só devolve tela que a pessoa pode abrir", () => {
    const soInsumos = (path: string) => path === "/insumos"
    expect(buscarFerramentas("remuneração", soInsumos)).toEqual([])
    expect(buscarFerramentas("solicitações", soInsumos).map((r) => r.item.codigo)).toEqual(["insumos"])
  })

  it("respeita o limite", () => {
    expect(buscarFerramentas("a", tudo, 3)).toHaveLength(3)
  })
})
