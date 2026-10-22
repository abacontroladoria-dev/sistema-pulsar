// Regras de Coordenador de Caso em Ocupação · Paciente — ver coordenadorCaso.ts.

import { describe, expect, it } from "vitest"
import {
  COORDENADOR_CASO, contarSessoesCCSemana, coordenadoresDoPaciente, montarCarteira,
  profPodeReceber, somarBundlesConfirmados, validarSelecaoCC, type LinhaCC,
} from "./coordenadorCaso"
import { alternarTurno, buildSugestoesManual } from "./novoCronograma"
import type { AceitePacBundle } from "@/types/acompanhamento"
import type { CsvRow, LaudoRow } from "@/types/cronograma"

/** `n` pacientes reais (ids 1000…) coordenados por `prof`. */
function carteiraCom(prof: string, n: number, extras: LinhaCC[] = []) {
  const linhas: LinhaCC[] = Array.from({ length: n }, (_, i) => ({
    profissional: prof, pacienteId: 1000 + i, pacienteNome: `Paciente ${i}`,
  }))
  return montarCarteira([...linhas, ...extras])
}

describe("teto de pacientes por Coordenador de Caso", () => {
  it("com 17 pacientes ainda recebe mais um", () => {
    const c = carteiraCom("Ana Lima", 17)
    expect(profPodeReceber(c, "Ana Lima", { id: 1, nome: "Novo" }, 18)).toEqual({ pode: true, qtd: 17, limite: 18 })
  })

  it("com 18 não recebe nenhum", () => {
    const c = carteiraCom("Ana Lima", 18)
    expect(profPodeReceber(c, "Ana Lima", { id: 1, nome: "Novo" }, 18).pode).toBe(false)
  })

  it("com 18, o paciente que já é dele continua podendo", () => {
    const c = carteiraCom("Ana Lima", 18)
    expect(profPodeReceber(c, "Ana Lima", { id: 1005, nome: "Paciente 5" }, 18).pode).toBe(true)
  })

  it("várias sessões do mesmo paciente contam um paciente só", () => {
    const c = carteiraCom("Ana Lima", 17, [
      { profissional: "Ana Lima", pacienteId: 1000, pacienteNome: "Paciente 0" },
      { profissional: "Ana Lima", pacienteId: 1000, pacienteNome: "Paciente 0" },
    ])
    expect(c.pacientesPorProf.get("ana lima")?.size).toBe(17)
  })

  it("paciente fictício não conta: Alinhamento, Supervisor(a) e marcado no cadastro", () => {
    const c = carteiraCom("Ana Lima", 17, [
      { profissional: "Ana Lima", pacienteId: 20471, pacienteNome: "Alinhamento Sandra" },
      { profissional: "Ana Lima", pacienteId: 99001, pacienteNome: "Supervisora Fulana" },
      { profissional: "Ana Lima", pacienteId: 99002, pacienteNome: "Horário Administrativo" },
    ])
    expect(c.pacientesPorProf.get("ana lima")?.size).toBe(17)

    const marcado = montarCarteira(
      [{ profissional: "Ana Lima", pacienteId: 555, pacienteNome: "Nome Qualquer" }],
      new Set(["555"]),
    )
    expect(marcado.pacientesPorProf.get("ana lima")).toBeUndefined()
  })
})

describe("pacotes confirmados que ainda não chegaram à grade", () => {
  const bundle = (pac: string, prof: string, status: AceitePacBundle["status"] = "confirmado", id?: number): AceitePacBundle => ({
    id: "b", pac, ts: 0, origem: "ocp-paciente", status, inviavelSlots: [],
    sessoes: [{ dia: "Segunda", hora: "08:00", tP: COORDENADOR_CASO, prof, unidade: "U", csvGradeId: "x", idFavorecidoFallback: id }],
  })

  it("entram na carteira", () => {
    const c = somarBundlesConfirmados(carteiraCom("Ana Lima", 17), [bundle("Novo Paciente", "Ana Lima", "confirmado", 7)])
    expect(c.pacientesPorProf.get("ana lima")?.size).toBe(18)
    expect(profPodeReceber(c, "Ana Lima", { id: 8, nome: "Outro" }, 18).pode).toBe(false)
  })

  it("não contam duas vezes quem já está na grade", () => {
    const c = somarBundlesConfirmados(carteiraCom("Ana Lima", 17), [bundle("Paciente 3", "Ana Lima")])
    expect(c.pacientesPorProf.get("ana lima")?.size).toBe(17)
  })

  it("recusado não entra, e a carteira original não é alterada", () => {
    const original = carteiraCom("Ana Lima", 17)
    const c = somarBundlesConfirmados(original, [bundle("Novo", "Ana Lima", "recusado")])
    expect(c.pacientesPorProf.get("ana lima")?.size).toBe(17)
    somarBundlesConfirmados(original, [bundle("Novo", "Ana Lima")])
    expect(original.pacientesPorProf.get("ana lima")?.size).toBe(17)
  })
})

describe("validarSelecaoCC", () => {
  const base = {
    carteira: carteiraCom("Ana Lima", 5),
    limite: 18,
    paciente: { id: 1, nome: "Novo" },
    sessoesExistentes: 0,
  }

  it("até 3 sessões passa; a 4ª bloqueia", () => {
    const tres = Array.from({ length: 3 }, () => ({ prof: "Ana Lima" }))
    expect(validarSelecaoCC({ ...base, selecionadas: tres })).toEqual([])
    const quatro = [...tres, { prof: "Ana Lima" }]
    expect(validarSelecaoCC({ ...base, selecionadas: quatro })[0]).toMatch(/no máximo 3/)
  })

  it("soma as sessões que o paciente já tem: 2 agendadas + 2 novas bloqueia", () => {
    const erros = validarSelecaoCC({ ...base, sessoesExistentes: 2, selecionadas: [{ prof: "Ana Lima" }, { prof: "Ana Lima" }] })
    expect(erros[0]).toMatch(/no máximo 3 sessões por paciente \(4 marcadas, 2 já agendada/)
  })

  it("dois coordenadores diferentes bloqueiam", () => {
    const erros = validarSelecaoCC({ ...base, selecionadas: [{ prof: "Ana Lima" }, { prof: "Bruno Reis" }] })
    expect(erros).toContain("Coordenador de Caso: o paciente só pode ter um coordenador.")
  })

  it("outro coordenador que não o atual do paciente bloqueia", () => {
    const carteira = carteiraCom("Ana Lima", 5)
    const erros = validarSelecaoCC({
      ...base, carteira, paciente: { id: 1002, nome: "Paciente 2" }, selecionadas: [{ prof: "Bruno Reis" }],
    })
    expect(erros).toContain("Coordenador de Caso: o paciente só pode ter um coordenador.")
  })

  it("profissional no teto bloqueia, com a contagem na mensagem", () => {
    const erros = validarSelecaoCC({ ...base, carteira: carteiraCom("Ana Lima", 18), selecionadas: [{ prof: "Ana Lima" }] })
    expect(erros).toEqual(["Ana Lima já tem 18 pacientes como Coordenador de Caso (limite 18)."])
  })

  it("sem Coordenador de Caso selecionado não há o que validar", () => {
    expect(validarSelecaoCC({ ...base, sessoesExistentes: 5, selecionadas: [] })).toEqual([])
  })
})

describe("contarSessoesCCSemana", () => {
  it("o pacote que já sincronizou não conta duas vezes", () => {
    const grade = [{ dia: "Segunda", hora: "08:00:00", prof: "Ana Lima" }]
    const bundles = [{ dia: "Segunda", hora: "08:00", prof: "ana lima" }, { dia: "Quarta", hora: "09:20", prof: "Ana Lima" }]
    expect(contarSessoesCCSemana(grade, bundles)).toBe(2)
  })
})

describe("coordenadoresDoPaciente", () => {
  it("casa pelo id e, na falta dele, pelo nome", () => {
    const c = carteiraCom("Ana Lima", 3)
    expect([...coordenadoresDoPaciente(c, { id: 1001, nome: "x" })]).toEqual(["ana lima"])
    expect([...coordenadoresDoPaciente(c, { id: null, nome: "Paciente 1" })]).toEqual(["ana lima"])
    expect(coordenadoresDoPaciente(c, { id: 42, nome: "Ninguém" }).size).toBe(0)
  })
})

describe("buildSugestoesManual com Coordenador de Caso", () => {
  const livre = (terapia: string, prof: string, hora: string, id: string): CsvRow => ({
    "Status do Agendamento": "Livre", "Dia da Semana": "Segunda", Terapia: terapia, Profissional: prof,
    HI_str: hora, HI: Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3)), Unidade: "Unidade A", CsvGradeId: id,
  } as unknown as CsvRow)
  const laudo = (esp: string, aut: string): LaudoRow =>
    ({ Paciente: "Joana", Especialidade: esp, "Qtd autorizada": aut, "Qtd laudo": aut, "Situação": "Vigente" } as unknown as LaudoRow)

  const slots = [
    livre("Aplicador ABA (PS)", "Carla Dias", "08:00", "1"),
    livre(COORDENADOR_CASO, "Ana Lima", "08:00", "2"),
    livre(COORDENADOR_CASO, "Bruno Reis", "08:40", "3"),
  ]
  const temCC = (r: ReturnType<typeof buildSugestoesManual>) =>
    r.sugestoes.flatMap(s => [{ esp: s.esp, prof: s.prof }, ...s.espAlts.map(a => ({ esp: a.esp, prof: a.prof }))])
      .filter(x => x.esp === COORDENADOR_CASO)

  it("com Psicologia ABA ≥ 1, sugere como alternativa do horário e como principal quando é a única opção", () => {
    const r = buildSugestoesManual("Joana", ["Unidade A"], ["manha"], [laudo("Psicologia ABA", "1")], slots, undefined, { podeReceber: () => true })
    const s0800 = r.sugestoes.find(s => s.hora === "08:00")!
    expect(s0800.esp).not.toBe(COORDENADOR_CASO)
    expect(s0800.espAlts.map(a => a.esp)).toContain(COORDENADOR_CASO)
    expect(r.sugestoes.find(s => s.hora === "08:40")?.esp).toBe(COORDENADOR_CASO)
  })

  it("sem Psicologia ABA autorizada não sugere", () => {
    const r = buildSugestoesManual("Joana", ["Unidade A"], ["manha"], [laudo("Fonoaudiologia", "4")], slots, undefined, { podeReceber: () => true })
    expect(temCC(r)).toEqual([])
  })

  it("sem as regras (Orçamento) continua fora", () => {
    const r = buildSugestoesManual("Joana", ["Unidade A"], ["manha"], [laudo("Psicologia ABA", "10")], slots)
    expect(temCC(r)).toEqual([])
  })

  it("profissional no teto de pacientes não aparece", () => {
    const r = buildSugestoesManual("Joana", ["Unidade A"], ["manha"], [laudo("Psicologia ABA", "10")], slots, undefined, {
      podeReceber: prof => prof !== "Ana Lima",
    })
    expect(temCC(r).map(x => x.prof)).toEqual(["Bruno Reis"])
  })
})

describe("buildSugestoesManual com manhã e tarde juntas", () => {
  const livre = (hora: string, id: string): CsvRow => ({
    "Status do Agendamento": "Livre", "Dia da Semana": "Segunda", Terapia: "Fonoaudiologia", Profissional: "Carla Dias",
    HI_str: hora, HI: Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3)), Unidade: "Unidade A", CsvGradeId: id,
  } as unknown as CsvRow)
  const laudo = { Paciente: "Joana", Especialidade: "Fonoaudiologia", "Qtd autorizada": "4", "Qtd laudo": "4", "Situação": "Vigente" } as unknown as LaudoRow
  const slots = [livre("08:00", "1"), livre("12:20", "2"), livre("14:00", "3")]
  const horas = (t: ("manha" | "tarde")[]) => buildSugestoesManual("Joana", ["Unidade A"], t, [laudo], slots).sugestoes.map(s => s.hora).sort()

  it("cada turno sozinho só traz o seu horário; os dois juntos trazem ambos", () => {
    expect(horas(["manha"])).toEqual(["08:00"])
    expect(horas(["tarde"])).toEqual(["14:00"])
    expect(horas(["manha", "tarde"])).toEqual(["08:00", "14:00"])
  })

  it("alternarTurno não deixa a seleção vazia e mantém manhã antes de tarde", () => {
    expect(alternarTurno(["manha"], "manha")).toEqual(["manha"])
    expect(alternarTurno(["tarde"], "manha")).toEqual(["manha", "tarde"])
    expect(alternarTurno(["manha", "tarde"], "manha")).toEqual(["tarde"])
  })
})
