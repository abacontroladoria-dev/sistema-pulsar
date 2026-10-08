import { describe, expect, it } from "vitest"
import {
  descreverSerie, diaDaSemana, faixasDoDia, foraDaJanelaDoPaciente, janelaDoPaciente, montarDia, montarPeriodo,
  precisaReposicao, resumir, rotuloSemana, rotuloVagas, semanaDe, semanasDoMes,
} from "./motor"
import type { AgendamentoGrade, BloqueioGrade, DisponibilidadePacienteGrade, FaixaGrade, FeriadoGrade } from "@/types/grade"

// Semana de 11 a 17/10/2026: 11 = domingo, 12 = segunda.

function faixa(p: Partial<FaixaGrade> = {}): FaixaGrade {
  return {
    profissional_id: 1, versao_id: "v1", versao_numero: 1, vigente_de: "2026-10-01", vigente_ate: null,
    dias_ativos: [1, 2, 3, 4, 5], faixa_id: "f1", dia_semana: 1,
    hora_inicio: "08:00:00", hora_fim: "12:00:00", duracao_min: 40, capacidade: 1,
    intervalo_ativo: false, intervalo_inicio: null, intervalo_fim: null,
    local_id: "s1", local_nome: "Sala 1", unidade_nome: "Realengo",
    terapias: [{ id: 10, nome: "Fonoaudiologia" }],
    ...p,
  }
}

let seq = 0
function sessao(p: Partial<AgendamentoGrade> = {}): AgendamentoGrade {
  seq++
  return {
    id: `a${seq}`, serie_id: null, data: "2026-10-12", dia_semana: 1, hora_inicio: "08:00:00", hora_fim: "08:40:00",
    duracao_min: 40, paciente_id: seq, paciente_nome: `Paciente ${seq}`, profissional_id: 1, profissional_nome: "Ana",
    terapia_id: 10, terapia_nome: "Fonoaudiologia", terapia_exibicao_id: null, terapia_exibicao_nome: null,
    local_id: "s1", sala_nome: "Sala 1", unidade_nome: "Realengo", situacao: "agendado",
    excluido_em: null, excluido_por_nome: null, motivo_exclusao: null, escopo_exclusao: null,
    origem: "pulsar", tita_agendamento_id: null, criado_em: "2026-10-07T12:00:00Z", criado_por_nome: "Teste",
    ...p,
  }
}

const ANA = { id: 1, data_saida: null }
const dia = (over: Partial<Parameters<typeof montarDia>[0]> = {}) =>
  montarDia({ profissional: ANA, data: "2026-10-12", faixas: [faixa()], agendamentos: [], bloqueios: [], feriado: null, ...over })

describe("datas", () => {
  it("semana de domingo a sábado", () => {
    const s = semanaDe("2026-10-14")
    expect(s[0]).toBe("2026-10-11")
    expect(s[6]).toBe("2026-10-17")
    expect(diaDaSemana(s[0])).toBe(0)
  })
  it("mês em semanas completas", () => {
    const m = semanasDoMes("2026-10-20")
    expect(m[0][0]).toBe("2026-09-27")
    expect(m[m.length - 1].includes("2026-10-31")).toBe(true)
    expect(m.every(s => s.length === 7)).toBe(true)
  })
  it("rótulo da semana atravessando o mês", () => {
    expect(rotuloSemana(semanaDe("2026-10-01"))).toBe("27 de setembro – 03 de outubro de 2026")
    expect(rotuloSemana(semanaDe("2026-10-14"))).toBe("11 – 17 de outubro de 2026")
  })
})

describe("disponibilidade", () => {
  it("uma faixa 08–12 de 40 min gera 6 horários livres", () => {
    const d = dia()
    expect(d.horarios.map(h => h.inicio)).toEqual(["08:00", "08:40", "09:20", "10:00", "10:40", "11:20"])
    expect(d.horarios.every(h => h.estado === "disponivel")).toBe(true)
  })
  it("intervalo de almoço não vira horário", () => {
    const d = dia({ faixas: [faixa({ hora_fim: "17:40:00", intervalo_ativo: true, intervalo_inicio: "12:00:00", intervalo_fim: "13:00:00" })] })
    const inicios = d.horarios.map(h => h.inicio)
    expect(inicios).toContain("11:20")
    expect(inicios).toContain("13:00")
    expect(inicios).not.toContain("12:00")
    expect(inicios).toHaveLength(13)
  })
  it("dia desligado ou outro dia da semana: nada", () => {
    expect(dia({ data: "2026-10-13" }).horarios).toHaveLength(0) // faixa só de segunda
    expect(dia({ faixas: [faixa({ dias_ativos: [2, 3] })] }).horarios).toHaveLength(0)
  })
  it("troca de versão no meio da semana", () => {
    const v1 = faixa({ vigente_ate: "2026-10-13", dia_semana: 1 })
    const v2 = faixa({ versao_id: "v2", vigente_de: "2026-10-14", dia_semana: 1, hora_inicio: "13:00:00", hora_fim: "15:00:00", faixa_id: "f2" })
    expect(faixasDoDia([v1, v2], 1, "2026-10-12")).toEqual([v1])
    expect(faixasDoDia([v1, v2], 1, "2026-10-19")).toEqual([v2])
  })
})

describe("ocupação e capacidade", () => {
  it("capacidade 1: agendado = lotado", () => {
    const d = dia({ agendamentos: [sessao()] })
    expect(d.horarios[0].estado).toBe("lotado")
    expect(rotuloVagas(d.horarios[0])).toBe("Agendado")
    expect(d.horarios[1].estado).toBe("disponivel")
  })
  it("capacidade 3: 1 de 3 → parcial, 3 de 3 → lotado", () => {
    const f = [faixa({ capacidade: 3 })]
    const um = dia({ faixas: f, agendamentos: [sessao()] })
    expect(um.horarios[0].estado).toBe("parcial")
    expect(rotuloVagas(um.horarios[0])).toBe("2 de 3 livres")
    const tres = dia({ faixas: f, agendamentos: [sessao(), sessao(), sessao()] })
    expect(tres.horarios[0].estado).toBe("lotado")
  })
  it("sessão excluída não ocupa", () => {
    expect(dia({ agendamentos: [sessao({ situacao: "excluido" })] }).horarios[0].estado).toBe("disponivel")
  })
  it("sessão fora da disponibilidade aparece como fora da grade", () => {
    const d = dia({ agendamentos: [sessao({ hora_inicio: "14:00:00", hora_fim: "14:40:00" })] })
    const fora = d.horarios.find(h => h.estado === "fora_da_grade")
    expect(fora?.inicio).toBe("14:00")
    expect(fora?.ocupados).toHaveLength(1)
  })
})

describe("fechamentos", () => {
  const finados: FeriadoGrade = { data: "2026-10-12", nome: "Feriado", tipo: "integral", horario_inicio: "08:00", horario_fim: "17:40" }
  it("feriado integral fecha tudo", () => {
    const d = dia({ feriado: finados })
    expect(d.feriado?.nome).toBe("Feriado")
    expect(d.horarios.every(h => h.estado === "bloqueado" && h.fechado?.origem === "feriado")).toBe(true)
  })
  it("feriado parcial fecha só a janela", () => {
    const d = dia({ feriado: { ...finados, tipo: "parcial", horario_inicio: "10:00", horario_fim: "17:40" } })
    expect(d.horarios.find(h => h.inicio === "09:20")?.estado).toBe("disponivel")
    expect(d.horarios.find(h => h.inicio === "10:00")?.estado).toBe("bloqueado")
  })
  it("bloqueio por horário e por dia da semana", () => {
    const b: BloqueioGrade = {
      id: "b1", profissional_id: 1, data_inicio: "2026-10-01", data_fim: null, hora_inicio: "08:00:00", hora_fim: "09:20:00",
      dias_semana: [1], tipo: "administrativo", motivo: "Reunião", situacao: "ativo", origem: "pulsar", criado_por_nome: null, criado_em: "",
    }
    const d = dia({ bloqueios: [b] })
    expect(d.horarios.filter(h => h.estado === "bloqueado").map(h => h.inicio)).toEqual(["08:00", "08:40"])
    expect(d.horarios[0].fechado).toEqual({ motivo: "Reunião", origem: "bloqueio", bloqueioId: "b1" })
    expect(dia({ bloqueios: [{ ...b, dias_semana: [2] }] }).horarios[0].estado).toBe("disponivel")
    expect(dia({ bloqueios: [{ ...b, situacao: "excluido" }] }).horarios[0].estado).toBe("disponivel")
  })
})

describe("profissional inativo", () => {
  it("depois da saída: sem horário livre, sessões mantidas = reposição", () => {
    const d = montarDia({
      profissional: { id: 1, data_saida: "2026-10-12" }, data: "2026-10-12", faixas: [faixa()],
      agendamentos: [sessao()], bloqueios: [], feriado: null,
    })
    expect(d.inativo).toBe(true)
    expect(d.horarios).toHaveLength(1)
    expect(d.horarios[0].estado).toBe("inativo")
    expect(resumir([d]).reposicao).toBe(1)
  })
  it("antes da saída, normal", () => {
    const d = montarDia({ profissional: { id: 1, data_saida: "2026-10-13" }, data: "2026-10-12", faixas: [faixa()], agendamentos: [], bloqueios: [], feriado: null })
    expect(d.inativo).toBe(false)
    expect(d.horarios).toHaveLength(6)
  })
  it("precisaReposicao pela data de saída", () => {
    const m = new Map([[1, { data_saida: "2026-10-13" }]])
    expect(precisaReposicao({ data: "2026-10-12", profissional_id: 1 }, m)).toBe(false)
    expect(precisaReposicao({ data: "2026-10-13", profissional_id: 1 }, m)).toBe(true)
  })
})

describe("resumo", () => {
  it("conta vagas livres, agendados, bloqueados e ocupação", () => {
    const dias = montarPeriodo({
      profissional: ANA, datas: semanaDe("2026-10-12"), faixas: [faixa({ capacidade: 2 })],
      agendamentos: [sessao(), sessao({ hora_inicio: "13:00:00", hora_fim: "13:40:00" })], bloqueios: [], feriados: [],
    })
    const r = resumir(dias)
    expect(r.agendados).toBe(2)
    expect(r.disponiveis).toBe(11) // 6 horários × 2 vagas − 1
    expect(r.ocupacao).toBeCloseTo(1 / 12)
    expect(r.bloqueados).toBe(0)
  })
})

describe("paciente", () => {
  const disp = {
    numero_versao: 1, criado_em: "", frequenta_escola: true, escola_inicio: "13:00:00", escola_fim: "17:00:00",
    seg_inicio: "08:00:00", seg_fim: "12:00:00", ter_inicio: null, ter_fim: null, qua_inicio: null, qua_fim: null,
    qui_inicio: null, qui_fim: null, sex_inicio: null, sex_fim: null, sab_inicio: "08:00:00", sab_fim: "12:00:00",
  } as DisponibilidadePacienteGrade
  it("janela do dia (sábado ignorado)", () => {
    expect(janelaDoPaciente(disp, "2026-10-12")).toEqual({ inicio: "08:00", fim: "12:00" })
    expect(janelaDoPaciente(disp, "2026-10-17")).toBeNull()
  })
  it("fora da janela", () => {
    expect(foraDaJanelaDoPaciente(disp, { data: "2026-10-12", hora_inicio: "11:20:00", hora_fim: "12:00:00" })).toBe(false)
    expect(foraDaJanelaDoPaciente(disp, { data: "2026-10-12", hora_inicio: "13:00:00", hora_fim: "13:40:00" })).toBe(true)
    expect(foraDaJanelaDoPaciente(disp, { data: "2026-10-13", hora_inicio: "08:00:00", hora_fim: "08:40:00" })).toBe(true)
    expect(foraDaJanelaDoPaciente(null, { data: "2026-10-13", hora_inicio: "08:00:00", hora_fim: "08:40:00" })).toBe(false)
  })
})

describe("descreverSerie", () => {
  const base = {
    frequencia: "semanal" as const, intervalo_semanas: 1, dia_semana: 1, hora_inicio: "08:40:00", hora_fim: "09:20:00",
    data_inicio: "2026-10-12", data_fim: null, total_sessoes: null, situacao: "ativa" as const, encerrada_a_partir: null,
  }
  it("contínua, quinzenal, única, encerrada", () => {
    expect(descreverSerie(base)).toBe("Toda segunda-feira, 08:40–09:20 · desde 12/10/2026 · contínua")
    expect(descreverSerie({ ...base, intervalo_semanas: 2, data_fim: "2026-12-07" })).toBe("A cada 2 semanas, às segundas, 08:40–09:20 · desde 12/10/2026 · até 07/12/2026")
    expect(descreverSerie({ ...base, frequencia: "unica" })).toBe("Sessão única em 12/10/2026, 08:40–09:20")
    expect(descreverSerie({ ...base, situacao: "encerrada", encerrada_a_partir: "2026-11-09" })).toContain("encerrada a partir de 09/11/2026")
    expect(descreverSerie({ ...base, dia_semana: 6 })).toContain("Todo sábado")
  })
})
