import { describe, expect, it } from "vitest"
import { calcularDashboardPacientes, listarPacientesDoGrupo } from "./pacientesDashboard"
import { convenioDaLinha, montarMapaConvenioCadastro } from "./convenioCadastro"
import type { AgendaSalaRow } from "./salasTypes"

function linha(p: Partial<AgendaSalaRow>): AgendaSalaRow {
  return {
    tita_agendamento_id: null, paciente_id: null, paciente_nome: null, convenio_nome: null,
    unidade_nome: "CLÍNICA UNIVERSO ABA", sala_nome: "Unid. Realengo - Sala 1", profissional_nome: "Prof",
    profissional_id: 1, terapia_id: 1, terapia_nome: "Fonoaudiologia", terapia_exibicao_id: null,
    terapia_exibicao_nome: null, dia_semana: "Segunda-feira", hora_inicial: "08:00", hora_final: "09:00",
    status_agendamento: "Agendado", data: "2026-11-02", ...p,
  }
}

// Paciente 1: agenda e cadastro concordam. Paciente 2: agenda "Particular",
// cadastro "LEVE SAUDE" (o caso real que motivou a mudança). Paciente 3: sem
// cadastro. Paciente 4: duas sessões, uma em outra unidade.
const rows: AgendaSalaRow[] = [
  linha({ paciente_id: 1, paciente_nome: "Ana", convenio_nome: "ASSIM Saúde" }),
  linha({ paciente_id: 2, paciente_nome: "Bruno", convenio_nome: "Particular", dia_semana: "Terça-feira", data: "2026-11-03" }),
  linha({ paciente_id: 3, paciente_nome: "Carla", convenio_nome: "Particular" }),
  linha({ paciente_id: 4, paciente_nome: "Davi", convenio_nome: "ASSIM Saúde" }),
  linha({ paciente_id: 4, paciente_nome: "Davi", convenio_nome: "ASSIM Saúde", sala_nome: "Fazendinha - Sala 2", data: "2026-11-06", dia_semana: "Sexta-feira" }),
  linha({ paciente_id: 5, paciente_nome: "Elisa", convenio_nome: "LEVE SAUDE", status_agendamento: "Livre" }),
]

const mapa = montarMapaConvenioCadastro([
  { id: 1, nome: "Ana", situacao: "Ativo", planoSaude: "ASSIM Saúde" },
  { id: 2, nome: "Bruno", situacao: "Ativo", planoSaude: "LEVE SAUDE" },
  { id: 4, nome: "Davi", situacao: "Ativo", planoSaude: "ASSIM Saúde" },
])

describe("calcularDashboardPacientes com convênio do cadastro", () => {
  it("sem mapa, o convênio é o da agenda (comportamento anterior)", () => {
    const d = calcularDashboardPacientes(rows).multidisciplinar
    expect(Object.fromEntries(d.porConvenio.map(g => [g.chave, g.pacientesUnicos]))).toEqual({ "ASSIM Saúde": 2, Particular: 2 })
    expect(d.fonteConvenio).toEqual({ cadastro: 0, agenda: 4 })
  })

  it("com mapa, só a chave de convênio muda — totais, unidade e dia ficam iguais", () => {
    const antes = calcularDashboardPacientes(rows).multidisciplinar
    const depois = calcularDashboardPacientes(rows, mapa).multidisciplinar
    expect(Object.fromEntries(depois.porConvenio.map(g => [g.chave, g.pacientesUnicos]))).toEqual({ "ASSIM Saúde": 2, Particular: 1, "LEVE SAUDE": 1 })
    expect(depois.pacientesUnicos).toBe(antes.pacientesUnicos)
    expect(depois.sessoesTotal).toBe(antes.sessoesTotal)
    expect(depois.chSemanalTotal).toBe(antes.chSemanalTotal)
    expect(depois.porUnidade).toEqual(antes.porUnidade)
    expect(depois.porDia).toEqual(antes.porDia)
    expect(depois.porConvenio.reduce((s, g) => s + g.sessoesTotal, 0)).toBe(depois.sessoesTotal)
    expect(depois.fonteConvenio).toEqual({ cadastro: 3, agenda: 1 })
  })
})

describe("listarPacientesDoGrupo", () => {
  it("lista exatamente os pacientes contados em cada linha", () => {
    const d = calcularDashboardPacientes(rows, mapa).multidisciplinar
    for (const campo of ["convenio", "unidade"] as const) {
      for (const g of campo === "convenio" ? d.porConvenio : d.porUnidade) {
        const lista = listarPacientesDoGrupo(rows, mapa, "multidisciplinar", campo, g.chave)
        expect(lista.length).toBe(g.pacientesUnicos)
        expect(lista.reduce((s, p) => s + p.sessoes, 0)).toBe(g.sessoesTotal)
      }
    }
  })

  it("marca quem teve o convênio atualizado pelo cadastro", () => {
    const [bruno] = listarPacientesDoGrupo(rows, mapa, "multidisciplinar", "convenio", "LEVE SAUDE")
    expect(bruno).toMatchObject({ nome: "Bruno", ids: [2], conveniosAgenda: ["Particular"], atualizadoPeloCadastro: true })
    const assim = listarPacientesDoGrupo(rows, mapa, "multidisciplinar", "convenio", "ASSIM Saúde")
    expect(assim.every(p => !p.atualizadoPeloCadastro)).toBe(true)
  })
})

describe("montarMapaConvenioCadastro / convenioDaLinha", () => {
  it("ID repetido com planos diferentes vira conflito e cai no convênio da agenda", () => {
    const m = montarMapaConvenioCadastro([
      { id: 9, nome: "X", situacao: "Ativo", planoSaude: "ASSIM Saúde" },
      { id: 9, nome: "lixo", situacao: "Ativo", planoSaude: "SULAMERICA" },
    ])
    expect(m.conflitos.has(9)).toBe(true)
    expect(convenioDaLinha(linha({ paciente_id: 9, convenio_nome: "Particular" }), m)).toEqual({ convenio: "Particular", fonte: "agenda", convenioAgenda: "Particular" })
  })

  it("plano vazio ou 'Não informado' no cadastro não sobrescreve a agenda", () => {
    const m = montarMapaConvenioCadastro([
      { id: 7, nome: "Y", situacao: "Ativo", planoSaude: "Não informado" },
      { id: 8, nome: "Z", situacao: "Ativo", planoSaude: "  " },
    ])
    expect(convenioDaLinha(linha({ paciente_id: 7, convenio_nome: "ASSIM Saúde" }), m).fonte).toBe("agenda")
    expect(convenioDaLinha(linha({ paciente_id: 8, convenio_nome: null }), m)).toEqual({ convenio: "Não informado", fonte: "agenda", convenioAgenda: "Não informado" })
  })
})
