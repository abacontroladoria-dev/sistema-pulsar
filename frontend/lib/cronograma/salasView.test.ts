// Testes da camada 1 de Ocupação de Salas (salasView.ts).
//
// O que estes testes travam: os seletores da UI nunca podem produzir um número
// diferente do motor (salas.ts). O bug que eles previnem é o clássico desta
// tela — card dizendo "2/3", KPI dizendo "3 inconsistências" e o chip de filtro
// marcando outra coisa, porque cada um reimplementou a contagem.

import { describe, expect, it } from "vitest"
import {
  agruparPorDiasDisponiveis,
  chipsDeFiltro,
  contarFiltrosSecundarios,
  diasDaSala,
  gradeSemanalDaSala,
  profissionaisDaSala,
  removerChipDeFiltro,
  resumoCardSala,
  resumoSemanalDaSala,
  salaTemInconsistencia,
  seguePadraoSemanal,
  situacaoDaAlocacao,
  situacaoDaCelula,
  SALAS_FILTROS_VAZIO,
} from "./salasView"
import { DIAS_DISPONIVEIS_PADRAO } from "./salasTypes"
import type { AlocacaoCardSlot, Sala, SalaComOcupacao, SlotOcupacaoSala, StatusOcupacaoSlot } from "./salasTypes"

function sala(over: Partial<Sala> = {}): Sala {
  return {
    id: "s1",
    unidade_nome: "Realengo",
    nucleo: "Desenvolvimento",
    andar: "1º",
    numero_sala: "8",
    nome_exibicao: "Sala 8",
    capacidade: "duplo",
    status: "operacional",
    sala_nome_referencia: null,
    observacoes: null,
    dias_disponiveis: DIAS_DISPONIVEIS_PADRAO,
    horarios_customizados: {},
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...over,
  }
}

function card(over: Partial<AlocacaoCardSlot> = {}): AlocacaoCardSlot {
  return {
    alocacaoId: "a1",
    profissionalNome: "Késia Antunes",
    terapiaNome: "Fonoaudiologia",
    sessoesReais: 4,
    sessoesCapacidadeTurno: 6,
    pctOcupacao: 4 / 6,
    semCruzamentoCsv: false,
    violacaoExclusividade: null,
    ...over,
  }
}

function slot(over: Partial<SlotOcupacaoSala> = {}): SlotOcupacaoSala {
  const alocacoes = over.alocacoes ?? []
  const status: StatusOcupacaoSlot = over.status ?? (alocacoes.length ? "ocupado" : "livre")
  return {
    salaId: "s1",
    dow: 1,
    turno: "Manhã",
    capacidadeProjetada: 2,
    alocacoes,
    status,
    inconsistente: false,
    violaExclusividade: false,
    blocos: [],
    ...over,
    // `status` derivado acima só quando o caso não informou um — mantido depois
    // do spread para não ser sobrescrito pelo default do objeto literal.
    ...(over.status ? { status: over.status } : {}),
  }
}

function item(sl: SlotOcupacaoSala[], s: Sala = sala()): SalaComOcupacao {
  const relevantes = sl.filter(x => x.status !== "bloqueado" && x.status !== "inativo")
  const ocupados = relevantes.filter(x => x.status === "ocupado" || x.status === "parcial").length
  return { sala: s, slots: sl, pctOcupacaoSemanal: relevantes.length ? ocupados / relevantes.length : null }
}

// ─── AGRUPAMENTO POR DIAS ─────────────────────────────────────────────────────

describe("seguePadraoSemanal", () => {
  it("sala sem dias_disponiveis cai no padrão Seg-Sex", () => {
    expect(seguePadraoSemanal(sala({ dias_disponiveis: [] }))).toBe(true)
  })

  it("sala de sábado não segue o padrão", () => {
    const dias = [...DIAS_DISPONIVEIS_PADRAO, { dow: 6, turnos: ["Manhã" as const] }]
    expect(seguePadraoSemanal(sala({ dias_disponiveis: dias }))).toBe(false)
  })

  it("sala Seg-Sex só de manhã não segue o padrão (turno importa)", () => {
    const dias = [1, 2, 3, 4, 5].map(dow => ({ dow, turnos: ["Manhã" as const] }))
    expect(seguePadraoSemanal(sala({ dias_disponiveis: dias }))).toBe(false)
  })
})

describe("agruparPorDiasDisponiveis", () => {
  it("toda sala cai em exatamente um grupo", () => {
    const a = item([], sala({ id: "a", dias_disponiveis: [{ dow: 3, turnos: ["Manhã"] }] }))
    const b = item([], sala({ id: "b", dias_disponiveis: [{ dow: 3, turnos: ["Tarde"] }] }))
    const c = item([], sala({ id: "c", dias_disponiveis: [{ dow: 6, turnos: ["Manhã"] }] }))

    const grupos = agruparPorDiasDisponiveis([a, b, c])
    const ids = grupos.flatMap(g => g.itens.map(i => i.sala.id))

    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3)
  })

  it("agrupa pelo conjunto de DIAS, ignorando diferença de turno", () => {
    const manha = item([], sala({ id: "a", dias_disponiveis: [{ dow: 3, turnos: ["Manhã"] }] }))
    const tarde = item([], sala({ id: "b", dias_disponiveis: [{ dow: 3, turnos: ["Tarde"] }] }))

    const grupos = agruparPorDiasDisponiveis([manha, tarde])

    expect(grupos).toHaveLength(1)
    expect(grupos[0].dias.map(d => d.dow)).toEqual([3])
  })
})

describe("diasDaSala", () => {
  it("dedupe e ordena os dows", () => {
    const s = sala({ dias_disponiveis: [{ dow: 5, turnos: ["Manhã"] }, { dow: 1, turnos: ["Tarde"] }, { dow: 5, turnos: ["Tarde"] }] })
    expect(diasDaSala(s).map(d => d.dow)).toEqual([1, 5])
  })
})

// ─── INCONSISTÊNCIA ───────────────────────────────────────────────────────────

describe("salaTemInconsistencia", () => {
  it("é falso quando nenhum slot tem problema", () => {
    expect(salaTemInconsistencia(item([slot(), slot({ dow: 2 })]))).toBe(false)
  })

  it("pega conflito de capacidade", () => {
    expect(salaTemInconsistencia(item([slot({ inconsistente: true })]))).toBe(true)
  })

  it("pega violação de exclusividade (que não é excesso de capacidade)", () => {
    expect(salaTemInconsistencia(item([slot({ violaExclusividade: true })]))).toBe(true)
  })
})

// ─── SITUAÇÃO ─────────────────────────────────────────────────────────────────

describe("situacaoDaAlocacao", () => {
  it("sala bloqueada vence tudo", () => {
    const s = slot({ status: "bloqueado", inconsistente: true, alocacoes: [card()] })
    expect(situacaoDaAlocacao(s, card())).toBe("bloqueado")
  })

  it("violação de exclusividade é conflito mesmo com sessões reais", () => {
    const c = card({ violacaoExclusividade: { direcao: "sala_para_terapia", motivo: "x" } })
    expect(situacaoDaAlocacao(slot({ alocacoes: [c] }), c)).toBe("conflito")
  })

  it("sem cruzamento no CSV é 'sem-sessao'", () => {
    const c = card({ semCruzamentoCsv: true, sessoesReais: 0 })
    expect(situacaoDaAlocacao(slot({ alocacoes: [c] }), c)).toBe("sem-sessao")
  })

  it("agenda aberta na TiTa sem paciente NÃO vira 'sessão confirmada'", () => {
    // O caso que a distinção existe para cobrir: o profissional tem horário
    // 'Livre' reservado (semCruzamentoCsv = false), mas 0 paciente marcado.
    const c = card({ semCruzamentoCsv: false, sessoesReais: 0, pctOcupacao: 0 })
    expect(situacaoDaAlocacao(slot({ alocacoes: [c] }), c)).toBe("agenda-aberta")
  })

  it("com sessão real é confirmada", () => {
    const c = card({ sessoesReais: 3 })
    expect(situacaoDaAlocacao(slot({ alocacoes: [c] }), c)).toBe("confirmada")
  })
})

describe("situacaoDaCelula", () => {
  it("slot ausente é 'indisponivel', nunca 'livre'", () => {
    // Importa porque 'livre' oferece "Livre +" para alocar — num dia/turno que
    // a sala não atende, isso criaria uma alocação impossível.
    expect(situacaoDaCelula(undefined)).toBe("indisponivel")
  })

  it("slot sem alocação é livre", () => {
    expect(situacaoDaCelula(slot({ status: "livre" }))).toBe("livre")
  })

  it("uma alocação sem cruzamento contamina a célula", () => {
    const s = slot({ alocacoes: [card(), card({ alocacaoId: "a2", semCruzamentoCsv: true })] })
    expect(situacaoDaCelula(s)).toBe("sem-sessao")
  })
})

// ─── RESUMO SEMANAL ───────────────────────────────────────────────────────────

describe("resumoSemanalDaSala", () => {
  it("devolve um item por dia que a sala atende", () => {
    const s = sala({ dias_disponiveis: [{ dow: 3, turnos: ["Manhã"] }, { dow: 6, turnos: ["Manhã"] }] })
    const dias = resumoSemanalDaSala(item([slot({ dow: 3 }), slot({ dow: 6 })], s))
    expect(dias.map(d => d.dow)).toEqual([3, 6])
  })

  it("dia com conflito é 'conflito', mesmo com os outros turnos ocupados", () => {
    const dias = resumoSemanalDaSala(item([
      slot({ dow: 1, turno: "Manhã", status: "ocupado", alocacoes: [card()] }),
      slot({ dow: 1, turno: "Tarde", inconsistente: true }),
    ]))
    expect(dias.find(d => d.dow === 1)?.nivel).toBe("conflito")
  })

  it("dia inteiramente bloqueado é 'fora-de-operacao', não 'livre'", () => {
    const dias = resumoSemanalDaSala(item([
      slot({ dow: 1, turno: "Manhã", status: "bloqueado" }),
      slot({ dow: 1, turno: "Tarde", status: "bloqueado" }),
    ]))
    expect(dias.find(d => d.dow === 1)?.nivel).toBe("fora-de-operacao")
  })

  it("todos os turnos ocupados é 'cheio'; um só é 'parcial'", () => {
    const cheio = resumoSemanalDaSala(item([
      slot({ dow: 1, turno: "Manhã", status: "ocupado", alocacoes: [card()] }),
      slot({ dow: 1, turno: "Tarde", status: "ocupado", alocacoes: [card()] }),
    ]))
    expect(cheio.find(d => d.dow === 1)?.nivel).toBe("cheio")

    const parcial = resumoSemanalDaSala(item([
      slot({ dow: 1, turno: "Manhã", status: "ocupado", alocacoes: [card()] }),
      slot({ dow: 1, turno: "Tarde", status: "livre" }),
    ]))
    expect(parcial.find(d => d.dow === 1)?.nivel).toBe("parcial")
  })
})

// ─── RESUMO DO CARD ───────────────────────────────────────────────────────────

describe("resumoCardSala", () => {
  it("slotsOcupados nunca passa de slotsTotal", () => {
    const r = resumoCardSala(item([
      slot({ dow: 1, status: "ocupado", alocacoes: [card()] }),
      slot({ dow: 2, status: "parcial", alocacoes: [card()] }),
      slot({ dow: 3, status: "livre" }),
      slot({ dow: 4, status: "bloqueado" }),
    ]))
    expect(r.slotsOcupados).toBeLessThanOrEqual(r.slotsTotal)
    expect(r.slotsOcupados).toBe(2)
  })

  it("slot bloqueado e inativo saem do denominador (mesma regra de resumoOcupacaoDeItens)", () => {
    const r = resumoCardSala(item([
      slot({ dow: 1, status: "livre" }),
      slot({ dow: 2, status: "bloqueado" }),
      slot({ dow: 3, status: "inativo" }),
    ]))
    expect(r.slotsTotal).toBe(1)
  })

  it("sala sem slot relevante tem pctSemanal null, nunca 0%", () => {
    // "0%" diria que a sala está vazia; null diz que não há base para o número.
    const r = resumoCardSala(item([slot({ status: "bloqueado" })]))
    expect(r.pctSemanal).toBeNull()
  })

  it("lista as terapias distintas alocadas, ordenadas", () => {
    const r = resumoCardSala(item([
      slot({ dow: 1, alocacoes: [card({ terapiaNome: "Psicologia" }), card({ alocacaoId: "a2", terapiaNome: "Fonoaudiologia" })] }),
      slot({ dow: 2, alocacoes: [card({ alocacaoId: "a3", terapiaNome: "Fonoaudiologia" })] }),
    ]))
    expect(r.terapias).toEqual(["Fonoaudiologia", "Psicologia"])
  })
})

// ─── GRADE SEMANAL ────────────────────────────────────────────────────────────

describe("gradeSemanalDaSala", () => {
  it("cobre toda combinação (dia, turno) sem duplicar", () => {
    const s = sala({ dias_disponiveis: [{ dow: 1, turnos: ["Manhã", "Tarde"] }, { dow: 2, turnos: ["Manhã", "Tarde"] }] })
    const celulas = gradeSemanalDaSala(item([slot({ dow: 1 }), slot({ dow: 2 })], s))

    const chaves = celulas.map(c => `${c.dow}-${c.turno}`)
    expect(chaves).toHaveLength(4)
    expect(new Set(chaves).size).toBe(4)
  })

  it("turno que a sala não atende vira 'indisponivel' com 0 vagas", () => {
    const s = sala({ dias_disponiveis: [{ dow: 6, turnos: ["Manhã"] }] })
    const celulas = gradeSemanalDaSala(item([slot({ dow: 6, turno: "Manhã" })], s))

    const tarde = celulas.find(c => c.dow === 6 && c.turno === "Tarde")
    expect(tarde?.situacao).toBe("indisponivel")
    expect(tarde?.vagasLivres).toBe(0)
  })

  it("vagas livres = capacidade menos alocados, nunca negativo", () => {
    const excedido = gradeSemanalDaSala(item([
      slot({ dow: 1, turno: "Manhã", capacidadeProjetada: 1, alocacoes: [card(), card({ alocacaoId: "a2" })], inconsistente: true }),
    ], sala({ dias_disponiveis: [{ dow: 1, turnos: ["Manhã"] }] })))

    expect(excedido[0].vagasLivres).toBe(0)
  })
})

// ─── ABA PROFISSIONAIS ────────────────────────────────────────────────────────

describe("profissionaisDaSala", () => {
  it("agrupa a mesma pessoa em vários turnos numa linha só", () => {
    const linhas = profissionaisDaSala(item([
      slot({ dow: 1, turno: "Manhã", alocacoes: [card()] }),
      slot({ dow: 1, turno: "Tarde", alocacoes: [card({ alocacaoId: "a2" })] }),
    ]))

    expect(linhas).toHaveLength(1)
    expect(linhas[0].turnos).toHaveLength(2)
    expect(linhas[0].sessoesReais).toBe(8)
  })

  it("a situação da linha é a pior entre os turnos", () => {
    const linhas = profissionaisDaSala(item([
      slot({ dow: 1, turno: "Manhã", alocacoes: [card()] }),
      slot({ dow: 1, turno: "Tarde", alocacoes: [card({ alocacaoId: "a2", semCruzamentoCsv: true })] }),
    ]))
    expect(linhas[0].situacao).toBe("sem-sessao")
  })

  it("ordena por nome", () => {
    const linhas = profissionaisDaSala(item([
      slot({ dow: 1, alocacoes: [card({ profissionalNome: "Zuleica" }), card({ alocacaoId: "a2", profissionalNome: "Ana" })] }),
    ]))
    expect(linhas.map(l => l.profissionalNome)).toEqual(["Ana", "Zuleica"])
  })
})

// ─── CHIPS ────────────────────────────────────────────────────────────────────

describe("chipsDeFiltro", () => {
  it("filtro vazio não gera chip", () => {
    expect(chipsDeFiltro(SALAS_FILTROS_VAZIO)).toEqual([])
  })

  it("um chip por valor selecionado, não um por campo", () => {
    const chips = chipsDeFiltro({ ...SALAS_FILTROS_VAZIO, unidade: ["Realengo", "Fazendinha"] })
    expect(chips).toHaveLength(2)
  })

  it("inclui isolada e soInconsistentes, que vivem fora do estado de filtro", () => {
    const chips = chipsDeFiltro(SALAS_FILTROS_VAZIO, { isolada: "Sala 8", soInconsistentes: true })
    expect(chips.map(c => c.campo)).toEqual(["soInconsistentes", "isolada"])
  })

  it("busca só de espaços não vira chip", () => {
    expect(chipsDeFiltro({ ...SALAS_FILTROS_VAZIO, profissional: "   " })).toEqual([])
  })
})

describe("removerChipDeFiltro", () => {
  it("remove só o valor clicado, preservando os outros", () => {
    const antes = { ...SALAS_FILTROS_VAZIO, unidade: ["Realengo", "Fazendinha"] }
    const chip = chipsDeFiltro(antes).find(c => c.valor === "Realengo")!
    expect(removerChipDeFiltro(antes, chip).unidade).toEqual(["Fazendinha"])
  })

  it("todo chip gerado é removível (nenhum campo esquecido no switch)", () => {
    const cheio = {
      unidade: ["U"], nucleo: ["N"], andar: ["A"],
      capacidade: ["duplo" as const], turno: ["Manhã" as const], status: ["operacional"],
      profissional: "Ana", semSessao: true, comExclusividade: true,
    }
    const chips = chipsDeFiltro(cheio)
    const zerado = chips.reduce(removerChipDeFiltro, cheio)
    expect(zerado).toEqual(SALAS_FILTROS_VAZIO)
  })
})

describe("contarFiltrosSecundarios", () => {
  it("conta só o que fica escondido atrás de 'Mais filtros'", () => {
    const f = { ...SALAS_FILTROS_VAZIO, unidade: ["U"], andar: ["A"], turno: ["Manhã" as const], semSessao: true }
    // unidade é primário: não entra na conta.
    expect(contarFiltrosSecundarios(f)).toBe(3)
  })
})
