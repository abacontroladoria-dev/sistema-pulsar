// Bloqueios do cadastro na Ocupação de Paciente — ver suspensaoTemporaria.ts.
//
// Caso real de 20/10/2026: paciente ID 22386 (João Victor) com Fonoaudiologia
// e Psicologia suspensas por prazo indefinido, ainda ofertadas no "Criar Novo
// Cronograma" porque ele não tinha nenhuma sessão na grade.

import { describe, expect, it, vi } from "vitest"

const listarPacientesBasicos = vi.fn()
const getSuspensoesVigentesPorPacientes = vi.fn()
const getAltasAtivasPorPacientes = vi.fn()
const getAltasClinicasVigentesPorPacientes = vi.fn()
vi.mock("@/services/pacientesBasico.service", () => ({ listarPacientesBasicos: (...a: unknown[]) => listarPacientesBasicos(...a) }))
vi.mock("@/services/pacienteSuspensaoTemporaria.service", () => ({ getSuspensoesVigentesPorPacientes: (...a: unknown[]) => getSuspensoesVigentesPorPacientes(...a) }))
vi.mock("@/services/pacienteAltaIndividualidade.service", () => ({ getAltasAtivasPorPacientes: (...a: unknown[]) => getAltasAtivasPorPacientes(...a) }))
vi.mock("@/services/pacienteAltaClinica.service", () => ({ getAltasClinicasVigentesPorPacientes: (...a: unknown[]) => getAltasClinicasVigentesPorPacientes(...a) }))

import { bloqueiosDoPaciente, construirSuspensaoTemporaria, montarBloqueios } from "./suspensaoTemporaria"
import type { CsvRow, LaudoRow } from "@/types/cronograma"

const laudo = (paciente: string, id: number, esp: string): LaudoRow =>
  ({ Paciente: paciente, "ID Favorecido": String(id), Especialidade: esp, "Qtd autorizada": "2" } as unknown as LaudoRow)

describe("construirSuspensaoTemporaria", () => {
  it("acha pelo ID Favorecido do laudo o paciente sem sessão na grade (Criar Novo)", async () => {
    listarPacientesBasicos.mockResolvedValue([{ tita_paciente_id: 22386, id_paciente: 501 }])
    getSuspensoesVigentesPorPacientes.mockResolvedValue(new Map([[501, [
      { idSuspensao: 7, especialidade: "Fonoaudiologia" },
      { idSuspensao: 8, especialidade: "Psicologia" },
    ]]]))
    getAltasAtivasPorPacientes.mockResolvedValue(new Map())
    getAltasClinicasVigentesPorPacientes.mockResolvedValue(new Map())

    const nome = "Joao Victor de Oliveira Carvalho"
    const { set, info } = await construirSuspensaoTemporaria([], [
      laudo(nome, 22386, "Fonoaudiologia"), laudo(nome, 22386, "Psicologia"), laudo(nome, 22386, "Psicologia ABA"),
    ])
    expect(listarPacientesBasicos).toHaveBeenCalledWith({ titaIds: [22386] })
    expect(set.has(`${nome}|||Fonoaudiologia`)).toBe(true)
    expect(set.has(`${nome}|||Psicologia`)).toBe(true)
    // Suspensão de Psicologia NÃO bloqueia Psicologia ABA.
    expect(set.has(`${nome}|||Psicologia ABA`)).toBe(false)
    expect(info.get(`${nome}|||Psicologia`)).toEqual({ tipo: "suspensao", idPacientePulsar: 501, idRegistro: 8 })
  })

  it("gera a chave com o nome da grade e com o nome do laudo quando divergem", async () => {
    listarPacientesBasicos.mockResolvedValue([{ tita_paciente_id: 10, id_paciente: 1 }])
    getSuspensoesVigentesPorPacientes.mockResolvedValue(new Map([[1, [{ idSuspensao: 1, especialidade: "Musicoterapia" }]]]))
    getAltasAtivasPorPacientes.mockResolvedValue(new Map())
    getAltasClinicasVigentesPorPacientes.mockResolvedValue(new Map())

    const grade = [{ PacienteId: 10, "Nome Favorecido": "Ana Souza" } as unknown as CsvRow]
    const { set } = await construirSuspensaoTemporaria(grade, [laudo("Ana Souza Lima", 10, "Musicoterapia")])
    expect(set.has("Ana Souza|||Musicoterapia")).toBe(true)
    expect(set.has("Ana Souza Lima|||Musicoterapia")).toBe(true)
  })
})

describe("cadastro ilegível", () => {
  it("devolve erro em vez de fingir que não há bloqueio", async () => {
    listarPacientesBasicos.mockRejectedValue(new Error("permission denied"))
    const r = await construirSuspensaoTemporaria([], [laudo("Bia", 10, "Psicologia")])
    expect(r.erro).toBe("permission denied")
    expect(r.set.size).toBe(0)
  })
})

describe("montarBloqueios", () => {
  const nomes = new Map([[10, new Set(["Bia"])]])
  const pulsar = new Map([[10, 1]])

  it("alta clínica bloqueia todas as especialidades do laudo e vence a suspensão", () => {
    const { set, info } = montarBloqueios(nomes, pulsar, new Map([[10, new Set(["Fonoaudiologia", "Psicologia ABA"])]]), {
      suspensoes: new Map([[1, [{ idSuspensao: 3, especialidade: "Fonoaudiologia" }]]]),
      altas: new Map(),
      altasClinicas: new Map([[1, 99]]),
    })
    expect([...set].sort()).toEqual(["Bia|||Fonoaudiologia", "Bia|||Psicologia ABA"])
    expect(info.get("Bia|||Fonoaudiologia")?.tipo).toBe("alta_clinica")
  })

  it("alta registrada bloqueia só a especialidade dela, também pelo nome cru do laudo", () => {
    const { set, info } = montarBloqueios(nomes, pulsar, new Map([[10, new Set(["Psicoterapia", "Psicologia"])]]), {
      suspensoes: new Map(),
      altas: new Map([[1, [{ idAlta: 4, especialidade: "Psicologia" }]]]),
      altasClinicas: new Map(),
    })
    expect(set.has("Bia|||Psicologia")).toBe(true)
    expect(set.has("Bia|||Psicoterapia")).toBe(true)
    expect(info.get("Bia|||Psicologia")).toEqual({ tipo: "alta", idPacientePulsar: 1, idRegistro: 4 })
  })

  it("paciente sem cadastro no Pulsar não gera bloqueio", () => {
    const { set } = montarBloqueios(nomes, new Map(), new Map(), {
      suspensoes: new Map([[1, [{ idSuspensao: 1, especialidade: "Psicologia" }]]]), altas: new Map(), altasClinicas: new Map(),
    })
    expect(set.size).toBe(0)
  })
})

describe("bloqueiosDoPaciente", () => {
  it("um motivo por especialidade, nome traduzido, link para a ficha, alta do laudo sem link", () => {
    const info = new Map([
      ["Bia|||Psicoterapia", { tipo: "suspensao" as const, idPacientePulsar: 1, idRegistro: 8 }],
      ["Bia|||Psicologia", { tipo: "suspensao" as const, idPacientePulsar: 1, idRegistro: 8 }],
      ["Bia|||Fonoaudiologia", { tipo: "alta_clinica" as const, idPacientePulsar: 1, idRegistro: 99 }],
      ["Outro|||Fonoaudiologia", { tipo: "alta" as const, idPacientePulsar: 2, idRegistro: 5 }],
    ])
    expect(bloqueiosDoPaciente("Bia", info, ["Musicoterapia", "Psicologia"])).toEqual([
      { esp: "Fonoaudiologia", tipo: "alta_clinica", href: "/cadastros/pacientes/1?aba=laudo&secao=altaClinica" },
      { esp: "Psicologia", tipo: "suspensao", href: "/cadastros/pacientes/1?aba=laudo&secao=suspensoes&suspensao=8" },
      { esp: "Musicoterapia", tipo: "alta_laudo", href: undefined },
    ])
  })
})
