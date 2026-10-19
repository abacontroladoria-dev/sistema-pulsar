import { describe, expect, it } from "vitest"
import {
  formatarPlanejamentoSessao,
  resolverStatusVisualEvolucao,
  sessaoJaPassou,
} from "./evolucaoStatus"
import type { ResumoEvolucaoGrade } from "@/types/grade"

const criarResumo = (parcial: Partial<ResumoEvolucaoGrade>): ResumoEvolucaoGrade => ({
  agendamento_id: "00000000-0000-0000-0000-000000000001",
  status_execucao: null,
  justificativa: null,
  tipo_falta: null,
  possui_tratativa: false,
  tratativa_profissional_id: null,
  tratativa_profissional_nome: null,
  tratativa_criada_em: null,
  origem: "pulsar",
  substituicao: false,
  falta_recepcao: false,
  tipo_falta_recepcao: null,
  inconsistencia: false,
  ...parcial,
})

describe("evolucaoStatus", () => {
  it("mantém azul (futuro) às 09:59 para sessão de 10:00 e muda para amarelo (sem_registro_passado) às 10:01 no fuso de Brasília", () => {
    // 2026-10-16 09:59 em Brasília (UTC-3 = 12:59Z)
    const as0959 = new Date("2026-10-16T12:59:00.000Z")
    // 2026-10-16 10:00 em Brasília (UTC-3 = 13:00Z)
    const as1000 = new Date("2026-10-16T13:00:00.000Z")
    // 2026-10-16 10:01 em Brasília (UTC-3 = 13:01Z)
    const as1001 = new Date("2026-10-16T13:01:00.000Z")

    expect(sessaoJaPassou("2026-10-16", "10:00:00", as0959)).toBe(false)
    expect(sessaoJaPassou("2026-10-16", "10:00:00", as1000)).toBe(false)
    expect(sessaoJaPassou("2026-10-16", "10:00:00", as1001)).toBe(true)

    const st0959 = resolverStatusVisualEvolucao({
      data: "2026-10-16",
      horaInicio: "10:00:00",
      resumo: null,
      ehAdmin: true,
      agora: as0959,
    })
    expect(st0959.codigo).toBe("futuro")

    const st1001 = resolverStatusVisualEvolucao({
      data: "2026-10-16",
      horaInicio: "10:00:00",
      resumo: null,
      ehAdmin: true,
      agora: as1001,
    })
    expect(st1001.codigo).toBe("sem_registro_passado")
  })

  it("retorna verde (evoluido) quando possui tratativa e não há falta da recepção", () => {
    const res = resolverStatusVisualEvolucao({
      data: "2026-10-16",
      horaInicio: "08:00:00",
      ehAdmin: true,
      resumo: criarResumo({
        status_execucao: "Realizado",
        possui_tratativa: true,
        tratativa_profissional_nome: "Sanderson Rodrigues",
        substituicao: true,
      }),
    })
    expect(res.codigo).toBe("evoluido")
    expect(res.descricaoCurta).toContain("Realizado por Sanderson Rodrigues (Substituição)")
  })

  it("retorna vermelho (cancelado) quando marcado como falta do paciente ou do profissional", () => {
    const faltaPac = resolverStatusVisualEvolucao({
      data: "2026-10-16",
      horaInicio: "08:00:00",
      ehAdmin: true,
      resumo: criarResumo({
        status_execucao: "Cancelado",
        tipo_falta: "paciente",
      }),
    })
    expect(faltaPac.codigo).toBe("cancelado")
    expect(faltaPac.rotulo).toBe("Falta do paciente")

    const faltaProf = resolverStatusVisualEvolucao({
      data: "2026-10-16",
      horaInicio: "08:00:00",
      ehAdmin: true,
      resumo: criarResumo({
        status_execucao: "Cancelado",
        tipo_falta: "terapeuta",
      }),
    })
    expect(faltaProf.codigo).toBe("cancelado")
    expect(faltaProf.rotulo).toBe("Falta do profissional")
  })

  it("exibe inconsistência (roxo) SOMENTE para admin e mascara como falta (vermelho) para profissional/não-admin", () => {
    const resumoConflito = criarResumo({
      status_execucao: "Realizado",
      possui_tratativa: true,
      falta_recepcao: true,
      inconsistencia: true,
    })

    const visaoAdmin = resolverStatusVisualEvolucao({
      data: "2026-10-16",
      horaInicio: "09:00:00",
      ehAdmin: true,
      resumo: resumoConflito,
    })
    expect(visaoAdmin.codigo).toBe("inconsistencia")
    expect(visaoAdmin.rotulo).toBe("Inconsistência")

    const visaoProfissional = resolverStatusVisualEvolucao({
      data: "2026-10-16",
      horaInicio: "09:00:00",
      ehAdmin: false,
      resumo: resumoConflito,
    })
    expect(visaoProfissional.codigo).toBe("cancelado")
    expect(visaoProfissional.rotulo).toBe("Falta informada pela recepção")
    expect(visaoProfissional.rotulo).not.toContain("Inconsistência")
    expect(visaoProfissional.descricaoCurta).not.toContain("evolução")
  })

  it("formata o cabeçalho de planejamento exatamente no padrão pedido", () => {
    expect(
      formatarPlanejamentoSessao("2026-10-16", "08:00:00", "08:50:00", "Psicologia ABA"),
    ).toBe("Planejamento do dia 16/10/2026 - Hora 08:00 às 08:50 - Psicologia ABA")
  })
})
