// "Motivo da saída" no Comparativo de Sessões — ver motivoSaidaPaciente.
import { describe, expect, it } from "vitest"
import {
  MOTIVO_CONCLUIU_DIAGNOSTICO, calcularComparativo, classificarMovimento, motivoSaidaPaciente, normalizarLinhasApi,
  type GradeComparativoRaw,
} from "./comparativoSessoes"

const s = (idTerapia: number | null, terapia: string) => ({ idTerapia, terapia })

describe("motivoSaidaPaciente", () => {
  it("P1 só com Avaliação Neuropsicológica e P2 zerado → Concluiu Diagnóstico", () => {
    expect(motivoSaidaPaciente([s(2268, "Avaliação Neuropsicológica"), s(2268, "Avaliação Neuropsicológica")], 0)).toBe(MOTIVO_CONCLUIU_DIAGNOSTICO)
  })
  it("avaliação junto de outra terapia não é Concluiu Diagnóstico", () => {
    expect(motivoSaidaPaciente([s(2268, "Avaliação Neuropsicológica"), s(2272, "Fonoaudiologia")], 0)).toBeNull()
  })
  it("Neuropsicopedagógica (2800) não conta", () => {
    expect(motivoSaidaPaciente([s(2800, "Avaliação Neuropsicopedagógica")], 0)).toBeNull()
  })
  it("quem continua no P2 não tem motivo de saída", () => {
    expect(motivoSaidaPaciente([s(2268, "Avaliação Neuropsicológica")], 2)).toBeNull()
  })
  it("sem id, reconhece pelo nome", () => {
    expect(motivoSaidaPaciente([s(null, "Avaliacao neuropsicologica")], 0)).toBe(MOTIVO_CONCLUIU_DIAGNOSTICO)
  })
})

describe("calcularComparativo", () => {
  const linha = (paciente_id: number, data: string, terapia_id: number, terapia_nome: string): GradeComparativoRaw => ({
    paciente_id, paciente_nome: `P${paciente_id}`, sala_nome: "Sala 1", convenio_nome: "X",
    status_agendamento: "Agendado", data, hora_inicial: "08:00:00",
    terapia_id, terapia_nome, dia_semana: "Segunda", profissional_id: 1, profissional_nome: "Prof",
  })

  it("devolve o motivo em porPaciente e o paciente continua desligado", () => {
    const p1 = normalizarLinhasApi([
      linha(1, "2026-09-07", 2268, "Avaliação Neuropsicológica"),
      linha(2, "2026-09-07", 2272, "Fonoaudiologia"),
    ])
    const p2 = normalizarLinhasApi([linha(3, "2026-10-05", 2272, "Fonoaudiologia")])
    const r = calcularComparativo(p1, p2)
    const p = (id: number) => r.porPaciente.find(x => x.idFavorecido === id)!
    expect(p(1).motivoSaida).toBe(MOTIVO_CONCLUIU_DIAGNOSTICO)
    expect(classificarMovimento(p(1))).toBe("desligados")
    expect(p(2).motivoSaida).toBeNull()
    expect(p(3).motivoSaida).toBeNull()
    // Totais intactos: nada some do comparativo.
    expect(r.resumo.pacientesDesligados).toBe(2)
  })
})
