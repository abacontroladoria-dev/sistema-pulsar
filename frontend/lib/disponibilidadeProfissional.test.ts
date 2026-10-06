import { describe, expect, it } from "vitest"
import {
  conflitosDeLocal, copiarDia, dataBR, diferencasEntreVersoes, faixasDaGrade, faixasParaRpc, foraDaExclusividade,
  hojeBrasilia, mesmoConteudo, novaFaixa, periodoBR, resumoSemana, sessoesDaFaixa, sobraDaFaixa, somarDias, totaisDaSemana, validarRascunho,
} from "./disponibilidadeProfissional"
import type { LocalDisponivel, RascunhoDisponibilidade } from "@/types/disponibilidadeProfissional"

const S19 = "s19"
const local = (id: string, capacidade: string, exclusividades: LocalDisponivel["exclusividades"] = []): LocalDisponivel => ({
  id, nome_exibicao: id, unidade_nome: "Realengo", numero_sala: "19", capacidade, status: null, sala_nome_referencia: null, exclusividades,
})

describe("sessoesDaFaixa", () => {
  it("08:00–17:40, 40 min, intervalo 12–13 → 6 de manhã + 7 à tarde (exemplo do pedido)", () => {
    expect(sessoesDaFaixa(novaFaixa(1))).toEqual([
      "08:00", "08:40", "09:20", "10:00", "10:40", "11:20",
      "13:00", "13:40", "14:20", "15:00", "15:40", "16:20", "17:00",
    ])
  })
  it("sem intervalo, 08:00–12:00 de 40 → 6", () => {
    expect(sessoesDaFaixa(novaFaixa(1, { fim: "12:00", intervaloAtivo: false })).length).toBe(6)
  })
  it("fim antes do início → nada", () => {
    expect(sessoesDaFaixa(novaFaixa(1, { inicio: "10:00", fim: "09:00", intervaloAtivo: false }))).toEqual([])
  })
  it("sobra: 08:00–12:30 de 40 → sobram 30 min", () => {
    expect(sobraDaFaixa(novaFaixa(1, { fim: "12:30", intervaloAtivo: false }))).toBe(30)
    expect(sobraDaFaixa(novaFaixa(1))).toBe(0)
  })
})

describe("validarRascunho", () => {
  const hab = new Set([1, 2])
  it("faixa completa passa", () => {
    const r: RascunhoDisponibilidade = { diasAtivos: [1], faixas: [novaFaixa(1, { localId: S19, terapias: [1, 2] })] }
    expect(validarRascunho(r, hab).bloqueia).toBe(false)
  })
  it("acusa sem local, sem terapia, terapia não habilitada, sobreposição e intervalo fora", () => {
    const a = novaFaixa(1, { terapias: [], localId: null })
    const b = novaFaixa(1, { inicio: "10:00", fim: "11:00", intervaloAtivo: false, localId: S19, terapias: [9] })
    const c = novaFaixa(2, { localId: S19, terapias: [1], intervaloInicio: "07:00" })
    const v = validarRascunho({ diasAtivos: [1, 2], faixas: [a, b, c] }, hab)
    expect(v.bloqueia).toBe(true)
    expect(v.erros.get(a.chave)).toEqual(expect.arrayContaining(["Escolha ao menos uma terapia.", "Escolha o local."]))
    expect(v.erros.get(b.chave)?.some(e => e.includes("não está habilitada"))).toBe(true)
    expect(v.erros.get(b.chave)?.some(e => e.startsWith("Cruza"))).toBe(true)
    expect(v.erros.get(c.chave)).toContain("O intervalo precisa ficar dentro da faixa.")
  })
  it("nenhum dia ativo com faixa é erro geral", () => {
    const v = validarRascunho({ diasAtivos: [2], faixas: [novaFaixa(1, { localId: S19, terapias: [1] })] }, hab)
    expect(v.gerais.length).toBe(1)
  })
})

describe("totais e cópia", () => {
  it("dia desligado não conta; faixa com 2 terapias conta para as duas", () => {
    const r: RascunhoDisponibilidade = {
      diasAtivos: [1],
      faixas: [novaFaixa(1, { terapias: [1, 2] }), novaFaixa(6, { terapias: [1] })],
    }
    const t = totaisDaSemana(r)
    expect(t.sessoes).toBe(13)
    expect(t.minutos).toBe(13 * 40)
    expect(t.porTerapia.get(2)).toBe(13)
  })
  it("copiar segunda para quarta e sexta substitui e liga os dias", () => {
    const r: RascunhoDisponibilidade = { diasAtivos: [1], faixas: [novaFaixa(1, { terapias: [1] }), novaFaixa(3, { inicio: "14:00" })] }
    const c = copiarDia(r, 1, [3, 5])
    expect(c.diasAtivos).toEqual([1, 3, 5])
    expect(c.faixas.filter(f => f.dia === 3).map(f => f.inicio)).toEqual(["08:00"])
    expect(new Set(c.faixas.map(f => f.chave)).size).toBe(c.faixas.length)
  })
  it("mesmoConteudo ignora chave e ordem das faixas, mas vê qualquer mudança", () => {
    const a: RascunhoDisponibilidade = { diasAtivos: [2, 1], faixas: [novaFaixa(2, { terapias: [3, 1] }), novaFaixa(1)] }
    const b: RascunhoDisponibilidade = { diasAtivos: [1, 2], faixas: [novaFaixa(1), novaFaixa(2, { terapias: [1, 3] })] }
    expect(mesmoConteudo(a, b)).toBe(true)
    expect(mesmoConteudo(a, { ...b, diasAtivos: [1] })).toBe(false)
    expect(mesmoConteudo(a, { ...b, faixas: [novaFaixa(1), novaFaixa(2, { terapias: [1, 3], fim: "17:00" })] })).toBe(false)
    expect(mesmoConteudo(a, copiarDia(a, 1, [3]))).toBe(false)
  })
  it("faixasParaRpc ordena e zera o intervalo desligado", () => {
    const r: RascunhoDisponibilidade = { diasAtivos: [1, 2], faixas: [novaFaixa(2), novaFaixa(1, { intervaloAtivo: false })] }
    const p = faixasParaRpc(r)
    expect(p.map(f => f.dia_semana)).toEqual([1, 2])
    expect(p[0].intervalo_inicio).toBeNull()
  })
})

describe("conflitos de local e exclusividade", () => {
  const r: RascunhoDisponibilidade = { diasAtivos: [1], faixas: [novaFaixa(1, { localId: S19, terapias: [1] })] }
  const occ = [{ local_id: S19, dia_semana: 1, hora_inicio: "08:00:00", hora_fim: "12:00:00", profissional_id: 7, vigente_de: "2026-01-01", vigente_ate: null }]
  it("sala única com outro profissional no horário excede", () => {
    const c = conflitosDeLocal(r, { de: "2026-11-01", ate: null }, occ, new Map([[S19, local(S19, "unico")]]), () => "Fulana")
    expect(c.get(r.faixas[0].chave)).toMatchObject({ excedeu: true, outros: ["Fulana (08:00–12:00)"] })
  })
  it("local múltiplo só informa; período que não cruza não conta", () => {
    const m = conflitosDeLocal(r, { de: "2026-11-01", ate: null }, occ, new Map([[S19, local(S19, "multiplo")]]), () => "Fulana")
    expect(m.get(r.faixas[0].chave)?.excedeu).toBe(false)
    const n = conflitosDeLocal(r, { de: "2026-11-01", ate: null }, [{ ...occ[0], vigente_ate: "2026-10-31" }], new Map([[S19, local(S19, "unico")]]), () => "Fulana")
    expect(n.size).toBe(0)
  })
  it("exclusividade obrigatória", () => {
    const l = local(S19, "unico", [{ terapia_id: 2253, terapia_nome: "Psicomotricidade", modo: "obrigatoria" }])
    expect(foraDaExclusividade(l, [2253])).toBeNull()
    expect(foraDaExclusividade(l, [2253, 2254])).toEqual(["Psicomotricidade"])
    expect(foraDaExclusividade(local(S19, "unico"), [1])).toBeNull()
  })
})

describe("faixasDaGrade", () => {
  it("junta a semana da Pauline: manhã+tarde na Sala 19 com intervalo, 17:00 na Sala 24", () => {
    const h = (inicio: string, fim: string, localId: string) => ({ dia: 1, inicio, fim, terapias: [5], localId, salaTita: null })
    const manha = ["08:00", "08:40", "09:20", "10:00", "10:40", "11:20"].map(i => h(i, addMin(i, 40), "s19"))
    const tarde = ["13:00", "13:40", "14:20", "15:00", "15:40", "16:20"].map(i => h(i, addMin(i, 40), "s19"))
    const { faixas } = faixasDaGrade([...manha, ...tarde, h("17:00", "17:40", "s24")])
    expect(faixas.map(f => [f.inicio, f.fim, f.intervaloAtivo, f.localId])).toEqual([
      ["08:00", "17:00", true, "s19"],
      ["17:00", "17:40", false, "s24"],
    ])
    expect(faixas[0].intervaloInicio).toBe("12:00")
  })
  it("terapias diferentes quebram a faixa; sala sem casamento é listada", () => {
    const { faixas, salasSemCasamento } = faixasDaGrade([
      { dia: 2, inicio: "08:00", fim: "08:40", terapias: [1], localId: null, salaTita: "AT Externo Escola" },
      { dia: 2, inicio: "08:40", fim: "09:20", terapias: [2], localId: null, salaTita: "AT Externo Escola" },
    ])
    expect(faixas.length).toBe(2)
    expect(salasSemCasamento).toEqual(["AT Externo Escola"])
  })
})

describe("diferenças e datas", () => {
  it("detecta dia ligado, faixa alterada e removida", () => {
    const a: RascunhoDisponibilidade = { diasAtivos: [1], faixas: [novaFaixa(1, { localId: "s19", terapias: [1] }), novaFaixa(2)] }
    const b: RascunhoDisponibilidade = { diasAtivos: [1, 3], faixas: [novaFaixa(1, { localId: "s19", terapias: [1], fim: "12:00", intervaloAtivo: false })] }
    const d = diferencasEntreVersoes(a, b, id => `T${id}`, id => id ?? "—")
    expect(d.map(x => `${x.dia}:${x.tipo}`)).toEqual(["1:alterada", "2:removida", "3:dia"])
  })
  it("datas brasileiras", () => {
    expect(dataBR("2026-11-01")).toBe("01/11/2026")
    expect(periodoBR("2026-11-01", null)).toBe("01/11/2026 → indeterminado")
    expect(somarDias("2026-11-01", -1)).toBe("2026-10-31")
    // 23h em Brasília de 06/10 = 02h UTC de 07/10.
    expect(hojeBrasilia(new Date("2026-10-07T02:00:00Z"))).toBe("2026-10-06")
  })
})

function addMin(h: string, m: number) {
  const [hh, mm] = h.split(":").map(Number)
  const t = hh * 60 + mm + m
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`
}

describe("resumoSemana", () => {
  const f = (dia: number, ini: string, fim: string) => ({ dia_semana: dia, hora_inicio: `${ini}:00`, hora_fim: `${fim}:00` })
  it("dias soltos e turno", () => {
    expect(resumoSemana([1, 3, 5], [f(1, "08:00", "12:00"), f(3, "08:00", "11:20"), f(5, "08:40", "12:00")])).toBe("Seg, Qua, Sex · Manhã")
  })
  it("sequência de 3+ dias vira intervalo; manhã e tarde", () => {
    expect(resumoSemana([1, 2, 3, 4, 6], [f(1, "08:00", "17:40"), f(2, "13:00", "17:00"), f(3, "08:00", "12:00"), f(4, "08:00", "12:00"), f(6, "13:00", "15:00")]))
      .toBe("Seg a Qui, Sáb · Manhã e Tarde")
  })
  it("dia desligado não conta; sem faixa ativa = null", () => {
    expect(resumoSemana([2], [f(1, "13:00", "17:00"), f(2, "13:00", "17:00")])).toBe("Ter · Tarde")
    expect(resumoSemana([], [f(1, "08:00", "12:00")])).toBeNull()
  })
})
