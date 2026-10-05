import { describe, expect, it } from "vitest"
import {
  calcularTotais,
  conflitoComEscola,
  deColunas,
  diferencas,
  disponibilidadeVazia,
  formatarHoras,
  lerRascunho,
  mudouQuemPreenche,
  nomeMascarado,
  opcoesFim,
  opcoesInicio,
  paraColunas,
  rascunhoDe,
  sessoesNaJanela,
  validar,
  type Disponibilidade,
} from "../disponibilidadePaciente"

function com(dias: Partial<Disponibilidade["dias"]>, extra: Partial<Disponibilidade> = {}): Disponibilidade {
  const d = disponibilidadeVazia()
  return { ...d, ...extra, dias: { ...d.dias, ...dias } }
}

describe("totais", () => {
  // Os seis casos em que `(fim − início) / 40` errava contra o CSV da Órbita:
  // todos atravessam o almoço. Horários reais da carga inicial, sem os nomes.
  it.each([
    [{ seg: ["09:20", "17:40"], ter: ["09:20", "17:40"], qua: ["09:20", "17:40"], qui: ["09:20", "17:40"] }, "33h20", 44],
    [{ seg: ["10:00", "15:40"], ter: ["13:40", "15:40"], qua: ["13:40", "15:40"] }, "9h40", 13],
    [{ seg: ["11:20", "14:20"], ter: ["11:20", "17:40"], qua: ["11:20", "14:20"], qui: ["11:20", "17:40"] }, "18h40", 22],
    [{ seg: ["10:00", "17:00"], ter: ["10:00", "17:00"], qua: ["10:00", "17:00"], qui: ["10:00", "17:00"], sex: ["10:00", "17:00"] }, "35h00", 45],
    [{ ter: ["08:00", "17:00"], qui: ["13:00", "17:00"], sex: ["08:00", "12:00"] }, "17h00", 24],
  ])("bate com o CSV da Órbita (%#)", (diasBrutos, horas, sessoes) => {
    const dias = Object.fromEntries(
      Object.entries(diasBrutos).map(([k, [inicio, fim]]) => [k, { inicio, fim }])
    )
    const t = calcularTotais(com(dias))
    expect(formatarHoras(t.minutosSemana)).toBe(horas)
    expect(t.sessoes40).toBe(sessoes)
  })

  it("janela que passa das 17:40 só soma sessões até 17:40", () => {
    // No CSV da Órbita este caso dava 33 sessões (grade até 19:40). A clínica
    // agora fecha às 17:40: as horas declaradas continuam, as sessões não.
    const t = calcularTotais(com({
      seg: { inicio: "10:00", fim: "19:00" },
      qui: { inicio: "13:00", fim: "19:00" },
      sex: { inicio: "10:00", fim: "19:00" },
    }))
    expect(formatarHoras(t.minutosSemana)).toBe("24h00")
    expect(t.sessoes40).toBe(27)
  })

  it("não conta sessão que termina depois do fim da janela", () => {
    expect(sessoesNaJanela({ inicio: "08:00", fim: "09:00" })).toBe(1)
    expect(sessoesNaJanela({ inicio: "17:00", fim: "17:40" })).toBe(1)
  })

  it("horário fora da grade conta só as sessões que cabem", () => {
    // 15:20–17:40: começa entre duas sessões; cabem 15:40, 16:20, 17:00.
    expect(sessoesNaJanela({ inicio: "15:20", fim: "17:40" })).toBe(3)
  })

  it("dia vazio não soma nada", () => {
    expect(calcularTotais(disponibilidadeVazia())).toEqual({ minutosSemana: 0, sessoes40: 0, diasDisponiveis: 0 })
  })
})

describe("opções de horário", () => {
  it("a grade vai das 08:00 até a sessão das 17:00 (termina 17:40), sem o almoço", () => {
    const inicios = opcoesInicio().map((o) => o.valor)
    expect(inicios[0]).toBe("08:00")
    expect(inicios).toContain("11:20")
    expect(inicios).not.toContain("12:00")
    expect(inicios).toContain("13:00")
    expect(inicios.at(-1)).toBe("17:00")
    expect(inicios).not.toContain("17:40")
  })

  it("fim só oferece horários depois do início", () => {
    const fins = opcoesFim("13:00").map((o) => o.valor)
    expect(fins[0]).toBe("13:40")
    expect(fins.at(-1)).toBe("17:40")
  })

  it("mantém um valor importado fora da grade, marcado", () => {
    const opcoes = opcoesInicio("15:30:00")
    const fora = opcoes.find((o) => o.valor === "15:30")
    expect(fora?.foraDaGrade).toBe(true)
    expect(opcoes.filter((o) => o.foraDaGrade)).toHaveLength(1)
  })
})

describe("validação", () => {
  it("recusa fim antes do início", () => {
    const erros = validar(com({ seg: { inicio: "13:00", fim: "08:40" } }))
    expect(erros).toEqual([{ campo: "seg", mensagem: "Segunda-feira: o fim precisa ser depois do início." }])
  })

  it("escola só é validada quando frequenta", () => {
    expect(validar(com({}, { frequenta_escola: false, escola: { inicio: "12:00", fim: "07:00" } }))).toEqual([])
    expect(validar(com({}, { frequenta_escola: true, escola: { inicio: "12:00", fim: "07:00" } }))).toHaveLength(1)
  })
})

describe("banco ↔ tela", () => {
  it("ida e volta preserva os horários e corta os segundos do Postgres", () => {
    const d = deColunas({
      frequenta_escola: true,
      escola_inicio: "07:30:00",
      escola_fim: "12:00:00",
      seg_inicio: "13:00:00",
      seg_fim: "17:00:00",
    })
    expect(d.escola).toEqual({ inicio: "07:30", fim: "12:00" })
    expect(d.dias.seg).toEqual({ inicio: "13:00", fim: "17:00" })
    expect(Object.keys(d.dias)).toEqual(["seg", "ter", "qua", "qui", "sex"])
    expect(paraColunas(d)).toMatchObject({ escola_inicio: "07:30", seg_inicio: "13:00", seg_fim: "17:00", sex_inicio: null })
    expect(paraColunas(d)).not.toHaveProperty("sab_inicio")
  })

  it("não frequenta escola zera o horário da escola ao gravar", () => {
    const colunas = paraColunas(com({}, { frequenta_escola: false, escola: { inicio: "07:00", fim: "12:00" } }))
    expect(colunas.escola_inicio).toBeNull()
    expect(colunas.escola_fim).toBeNull()
  })
})

describe("histórico", () => {
  it("descreve o que mudou entre duas versões", () => {
    const pai = com(
      { seg: { inicio: "08:00", fim: "12:00" }, qua: { inicio: "14:20", fim: "17:40" } },
      { frequenta_escola: true, escola: { inicio: "07:30", fim: "12:00" } }
    )
    const mae = com(
      { seg: { inicio: "13:00", fim: "17:00" }, sex: { inicio: "08:00", fim: "12:00" } },
      { frequenta_escola: true, escola: { inicio: "13:00", fim: "17:30" } }
    )
    expect(diferencas(pai, mae)).toEqual([
      "Escola: 07:30–12:00 → 13:00–17:30",
      "Seg: 08:00–12:00 → 13:00–17:00",
      "Qua: removido (era 14:20–17:40)",
      "Sex: incluído 08:00–12:00",
    ])
  })

  it("versão idêntica não tem diferença", () => {
    const d = com({ ter: { inicio: "08:00", fim: "12:00" } })
    expect(diferencas(d, structuredClone(d))).toEqual([])
  })

  it("passar a não frequentar a escola vira uma frase só", () => {
    const antes = com({}, { frequenta_escola: true, escola: { inicio: "07:30", fim: "12:00" } })
    const depois = com({}, { frequenta_escola: false, escola: null })
    expect(diferencas(antes, depois)).toEqual(["Escola: passou a não frequentar"])
  })

  it("detecta troca de quem preencheu (pai → mãe)", () => {
    expect(mudouQuemPreenche({ nome: "Aldrin Nery", parentesco: "Pai" }, { nome: "Josiane Rangel", parentesco: "Mãe" })).toBe(true)
  })

  it("mesma pessoa com grafia diferente não é troca", () => {
    expect(mudouQuemPreenche({ nome: "Josiane  Rangel", parentesco: "Mãe" }, { nome: "josiane rangel", parentesco: "Mãe" })).toBe(false)
    expect(mudouQuemPreenche({ nome: "Élen Cristina", parentesco: "Mãe" }, { nome: "Elen Cristina", parentesco: "Mãe" })).toBe(false)
  })

  it("sem nome numa das versões não acusa troca", () => {
    expect(mudouQuemPreenche({ nome: null, parentesco: null }, { nome: "Josiane", parentesco: "Mãe" })).toBe(false)
  })
})

describe("rascunho", () => {
  it("dia marcado sem horário vira erro, não dia vazio", () => {
    const r = rascunhoDe(disponibilidadeVazia())
    r.dias.seg = { ativo: true, inicio: "08:00", fim: "" }
    const { disponibilidade, erros } = lerRascunho(r)
    expect(disponibilidade.dias.seg).toBeNull()
    expect(erros).toEqual([{ campo: "seg", mensagem: "Segunda-feira: escolha o horário de início e de fim." }])
  })

  it("frequenta escola exige entrada e saída", () => {
    const r = rascunhoDe(disponibilidadeVazia())
    r.frequenta_escola = true
    expect(lerRascunho(r).erros.map((e) => e.campo)).toEqual(["escola"])
  })

  it("dia desmarcado é ignorado mesmo com horário preenchido", () => {
    const r = rascunhoDe(com({ ter: { inicio: "08:00", fim: "12:00" } }))
    r.dias.ter.ativo = false
    const { disponibilidade, erros } = lerRascunho(r)
    expect(disponibilidade.dias.ter).toBeNull()
    expect(erros).toEqual([])
  })

  it("ida e volta preserva a disponibilidade", () => {
    const d = com({ qui: { inicio: "13:00", fim: "17:00" } }, { frequenta_escola: true, escola: { inicio: "07:30", fim: "12:00" } })
    expect(lerRascunho(rascunhoDe(d))).toEqual({ disponibilidade: d, erros: [] })
  })
})

describe("conflito com a escola", () => {
  // O caso do print: escola 06:30–11:20.
  const d = com(
    {
      seg: { inicio: "13:00", fim: "17:40" },
      ter: { inicio: "08:00", fim: "12:00" },
      qua: { inicio: "15:00", fim: "17:00" },
    },
    { frequenta_escola: true, escola: { inicio: "06:30", fim: "11:20" } }
  )

  it("aponta o trecho sobreposto", () => {
    expect(conflitoComEscola(d, "ter")).toEqual({ inicio: "08:00", fim: "11:20" })
  })

  it("janela no outro turno não é conflito", () => {
    expect(conflitoComEscola(d, "seg")).toBeNull()
    expect(conflitoComEscola(d, "qua")).toBeNull()
  })

  it("encostar no fim da escola não é conflito", () => {
    const e = com({ seg: { inicio: "11:20", fim: "12:00" } }, { frequenta_escola: true, escola: { inicio: "07:00", fim: "11:20" } })
    expect(conflitoComEscola(e, "seg")).toBeNull()
  })

  it("quem não frequenta escola nunca tem conflito", () => {
    expect(conflitoComEscola({ ...d, frequenta_escola: false, escola: null }, "ter")).toBeNull()
  })
})

describe("nome mascarado", () => {
  it.each([
    ["Maria Silva Oliveira", "Maria S. O."],
    ["ANA CLARA DOS SANTOS", "Ana C. S."],
    ["joão", "João"],
    ["  Pedro   de  Souza ", "Pedro S."],
    ["", ""],
  ])("%s → %s", (nome, esperado) => {
    expect(nomeMascarado(nome)).toBe(esperado)
  })
})
