// Terapias fora do Comparativo de Sessões (Tratamento Multidisciplinar) — ver
// TERAPIAS_FORA_DO_COMPARATIVO em comparativoSessoes.ts.
import { describe, expect, it } from "vitest"
import { normalizarLinhasApi, normalizarLinhasUpload, type GradeComparativoRaw } from "./comparativoSessoes"

const linha = (paciente_id: number, terapia_id: number | null, terapia_nome: string): GradeComparativoRaw => ({
  paciente_id, paciente_nome: `P${paciente_id}`, sala_nome: "Sala 1", convenio_nome: "X",
  status_agendamento: "Agendado", data: "2026-10-05", hora_inicial: "08:00:00",
  terapia_id, terapia_nome, dia_semana: "Segunda", profissional_id: 1, profissional_nome: "Prof",
})

describe("terapias fora do comparativo", () => {
  it("tira Avaliação Neuropsicopedagógica, Psiquiatra/Neurologista, Triagem e Visita Guiada", () => {
    const rows = normalizarLinhasApi([
      linha(1, 2800, "Avaliação Neuropsicopedagógica"),
      linha(1, 2695, "Psiquiatra/Neurologista"),
      linha(1, 2270, "Triagem"),
      linha(1, 2604, "Visita Guiada"),
      linha(2, 2604, "Visita Guiada"),
      linha(2, 2271, "Psicologia ABA"),
    ])
    // Paciente 1 só tinha terapias fora: some. Paciente 2 fica só com a ABA.
    expect(rows.map(r => [r.idFavorecido, r.idTerapia])).toEqual([[2, 2271]])
  })

  it("sem id, casa pelo nome (planilha importada)", () => {
    const rows = normalizarLinhasUpload([
      { "Status do Agendamento": "Agendado", "Id Favorecido": "1", Especialidade: "Triagem" },
      { "Status do Agendamento": "Agendado", "Id Favorecido": "1", Especialidade: "Fonoaudiologia" },
    ])
    expect(rows.map(r => r.terapia)).toEqual(["Fonoaudiologia"])
  })
})
