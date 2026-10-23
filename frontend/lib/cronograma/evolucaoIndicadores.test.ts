// Retrato mensal da evolução (evolucaoIndicadores.ts). Trava:
//  • as semanas do mês e o fechamento dos dias fora dele;
//  • PARIDADE: uma semana inteira dentro do mês dá exatamente o número do
//    motor da tela (calcularOcupacaoClinica) para a mesma semana;
//  • a semana partida da virada do mês só conta os dias do mês;
//  • pacientes do total = únicos, não a soma das unidades.

import { describe, expect, it } from "vitest"
import {
  PREFIXO_PROCEDIMENTO, UNIDADE_REDE, UNIDADE_TOTAL, diasUteisDaCompetencia, fechamentosForaDoMes, ocupacaoDaCompetencia,
  pacientesDaCompetencia, semanasDaCompetencia,
} from "./evolucaoIndicadores"
import { seriesPacientes } from "./evolucaoPontos"
import { calcularOcupacaoClinica } from "./ocupacaoClinica"
import { calcularOcupacaoDaSala } from "./salas"
import type { AgendaSalaRow, AlocacaoSala, Sala } from "./salasTypes"

function sala(over: Partial<Sala> = {}): Sala {
  return {
    id: "s8", unidade_nome: "Realengo", nucleo: null, andar: null, numero_sala: "8", nome_exibicao: "Sala 8",
    capacidade: "duplo", status: "operacional", sala_nome_referencia: null, observacoes: null,
    dias_disponiveis: [{ dow: 1, turnos: ["Manhã"] }], horarios_customizados: {}, created_at: "", updated_at: "",
    ...over,
  }
}
function alocacao(over: Partial<AlocacaoSala> = {}): AlocacaoSala {
  return {
    id: "a1", sala_id: "s8", dow: 1, turno: "Manhã", profissional_nome: "Ana Lima", profissional_id: 10,
    terapia_nome: "Fonoaudiologia", terapia_id: 1, created_at: "", updated_at: "", ...over,
  }
}
function linha(over: Partial<AgendaSalaRow> = {}): AgendaSalaRow {
  return {
    tita_agendamento_id: 1, paciente_id: 100, paciente_nome: "Paciente", convenio_nome: null, unidade_nome: null,
    sala_nome: "Unid. Realengo - Sala 8", profissional_nome: "Ana Lima", profissional_id: 10, terapia_id: 1,
    terapia_nome: "Fonoaudiologia", terapia_exibicao_id: null, terapia_exibicao_nome: null, dia_semana: "Segunda-feira",
    hora_inicial: "08:00", hora_final: "08:40", status_agendamento: "Agendado", data: "2026-11-02", ...over,
  }
}

describe("semanas da competência", () => {
  it("novembro/2026 (começa domingo): 5 semanas, a 1ª começa 02/11", () => {
    const s = semanasDaCompetencia("2026-11")
    expect(s[0]).toEqual({ inicio: "2026-11-02", fim: "2026-11-07" })
    expect(s[s.length - 1]).toEqual({ inicio: "2026-11-30", fim: "2026-12-05" })
    expect(s.length).toBe(5)
  })
  it("outubro/2026 (começa quinta): a 1ª semana é 28/09–03/10", () => {
    expect(semanasDaCompetencia("2026-10")[0]).toEqual({ inicio: "2026-09-28", fim: "2026-10-03" })
  })
  it("dias fora do mês ficam fechados", () => {
    const f = fechamentosForaDoMes("2026-09-28", "2026-10")
    expect(f.map(x => x.dow)).toEqual([1, 2, 3]) // 28, 29, 30/09
  })
  it("dias úteis (seg–sáb) sem feriado integral", () => {
    // Novembro/2026: 30 dias, 5 domingos → 25; feriados 02/11 e 20/11 integrais → 23.
    expect(diasUteisDaCompetencia("2026-11", [
      { data: "2026-11-02", nome: "Finados", tipo: "integral", horario_inicio: null, horario_fim: null },
      { data: "2026-11-20", nome: "Consciência Negra", tipo: "integral", horario_inicio: null, horario_fim: null },
    ])).toBe(23)
  })
})

describe("ocupação do mês", () => {
  const SALAS = [sala()]
  const ALOC = [alocacao()]

  it("PARIDADE: semana inteira no mês = motor da tela", () => {
    // Fevereiro/2027: 01/02 é segunda; usamos só a 1ª semana com sessão.
    const linhas = [linha({ data: "2027-02-01" })]
    const mes = ocupacaoDaCompetencia({
      competencia: "2027-02", salas: SALAS, alocacoes: ALOC, exclusividades: [],
      linhas, turnosBloqueioAdmin: [], feriados: [],
    })
    // O mês tem 4 segundas (01, 08, 15, 22/02); só a 1ª tem a sessão.
    const semana1 = calcularOcupacaoClinica(SALAS.map(s => calcularOcupacaoDaSala(s, ALOC, linhas)), linhas, [], [])
    const semanaVazia = calcularOcupacaoClinica(SALAS.map(s => calcularOcupacaoDaSala(s, ALOC, [])), [], [], [])
    const real = mes.find(u => u.unidade === "Realengo")!
    expect(real.contagem.paciente).toBe(semana1[0].contagem.paciente)
    expect(real.contagem.total).toBe(semana1[0].contagem.total + 3 * semanaVazia[0].contagem.total)
  })

  it("semana partida: a segunda fora do mês não conta", () => {
    // Outubro/2026: a semana 28/09–03/10 tem a segunda 28/09 FORA do mês.
    const linhas = [linha({ data: "2026-09-28" })]
    const mes = ocupacaoDaCompetencia({
      competencia: "2026-10", salas: SALAS, alocacoes: ALOC, exclusividades: [],
      linhas, turnosBloqueioAdmin: [], feriados: [],
    })
    const real = mes.find(u => u.unidade === "Realengo")!
    expect(real.contagem.paciente).toBe(0)
    // Segundas de outubro/2026: 05, 12, 19, 26 → 4 manhãs × 12 vagas.
    expect(real.contagem.total).toBe(4 * 12)
  })

  it("feriado integral tira o dia", () => {
    const mes = ocupacaoDaCompetencia({
      competencia: "2026-11", salas: SALAS, alocacoes: ALOC, exclusividades: [],
      linhas: [], turnosBloqueioAdmin: [],
      feriados: [{ data: "2026-11-02", nome: "Finados", tipo: "integral", horario_inicio: null, horario_fim: null }],
    })
    // Segundas de novembro/2026: 02 (feriado), 09, 16, 23, 30 → 4 × 12.
    expect(mes.find(u => u.unidade === "Realengo")!.contagem.total).toBe(4 * 12)
  })

  it("a rede soma só as próprias", () => {
    const salas = [sala(), sala({ id: "cg", unidade_nome: "Unidade Terceirizada - Campo Grande" })]
    const mes = ocupacaoDaCompetencia({
      competencia: "2026-11", salas, alocacoes: ALOC, exclusividades: [], linhas: [], turnosBloqueioAdmin: [], feriados: [],
    })
    const real = mes.find(u => u.unidade === "Realengo")!
    expect(mes.find(u => u.unidade === UNIDADE_REDE)!.contagem.total).toBe(real.contagem.total)
  })
})

describe("pacientes do mês", () => {
  it("total = pacientes únicos (quem vai a duas unidades conta uma vez)", () => {
    const rows = [
      linha({ paciente_nome: "Bia", paciente_id: 1, sala_nome: "Unid. Realengo - Sala 1", data: "2026-11-03" }),
      linha({ paciente_nome: "Bia", paciente_id: 1, sala_nome: "Unid. Fazendinha - Sala 2", data: "2026-11-04" }),
      linha({ paciente_nome: "Caio", paciente_id: 2, sala_nome: "Unid. Realengo - Sala 1", data: "2026-11-05" }),
    ]
    const r = pacientesDaCompetencia(rows, "2026-11").filter(x => x.segmento === "multidisciplinar")
    expect(r.find(x => x.unidade === "Realengo")!.pacientes).toBe(2)
    expect(r.find(x => x.unidade === "Fazendinha")!.pacientes).toBe(1)
    const total = r.find(x => x.unidade === UNIDADE_TOTAL)!
    expect(total.pacientes).toBe(2)
    expect(total.sessoes).toBe(3)
    expect(total.horas).toBeCloseTo(2, 5) // 3 × 40 min
  })

  it("Avaliação Neuropsicológica vai só para o diagnóstico", () => {
    const rows = [linha({ terapia_id: 2268, terapia_nome: "Avaliação Neuropsicológica", data: "2026-11-03" })]
    const r = pacientesDaCompetencia(rows, "2026-11")
    expect(r.find(x => x.segmento === "multidisciplinar" && x.unidade === UNIDADE_TOTAL)!.sessoes).toBe(0)
    expect(r.find(x => x.segmento === "diagnostico" && x.unidade === UNIDADE_TOTAL)!.sessoes).toBe(1)
  })

  it("Processo Diagnóstico grava uma linha por procedimento (as três, sempre); multidisciplinar não", () => {
    const rows = [
      linha({ paciente_id: 1, paciente_nome: "Gabi", terapia_id: 2268, terapia_nome: "Avaliação Neuropsicológica", data: "2026-11-03" }),
      linha({ paciente_id: 1, paciente_nome: "Gabi", terapia_id: 2270, terapia_nome: "Triagem", data: "2026-11-04" }),
      linha({ paciente_id: 2, paciente_nome: "Hugo", terapia_id: 2270, terapia_nome: "Triagem", data: "2026-11-05" }),
    ]
    const r = pacientesDaCompetencia(rows, "2026-11")
    const proc = r.filter(x => x.unidade.startsWith(PREFIXO_PROCEDIMENTO))
    expect(proc.every(x => x.segmento === "diagnostico")).toBe(true)
    expect(Object.fromEntries(proc.map(x => [x.unidade, x.pacientes]))).toEqual({
      "proc:Avaliação Neuropsicológica": 1,
      "proc:Psiquiatra/Neurologista": 0,
      "proc:Triagem": 2,
    })
    // Gabi fez dois procedimentos: aparece nos dois, uma vez só no total.
    expect(r.find(x => x.segmento === "diagnostico" && x.unidade === UNIDADE_TOTAL)!.pacientes).toBe(2)
  })
})

describe("séries do gráfico de Pacientes", () => {
  it("só o Processo Diagnóstico ganha as linhas de procedimento, antes do Total", () => {
    expect(seriesPacientes("multidisciplinar").map(s => s.key)).toEqual(["Fazendinha", "Padre Miguel", "Realengo", UNIDADE_TOTAL])
    expect(seriesPacientes("diagnostico").map(s => s.label)).toEqual([
      "Fazendinha", "Padre Miguel", "Realengo", "Avaliação Neuropsicológica", "Psiquiatra/Neurologista", "Triagem", "Total",
    ])
  })
})

describe("legenda do gráfico de Pacientes em linhas", () => {
  it("UNIDADE, PROCEDIMENTO e TOTAL em linhas próprias", () => {
    const grupos = seriesPacientes("diagnostico").map(s => s.grupo)
    expect(grupos).toEqual(["Unidade", "Unidade", "Unidade", "Procedimento", "Procedimento", "Procedimento", "Total"])
    expect(seriesPacientes("multidisciplinar").map(s => s.grupo)).toEqual(["Unidade", "Unidade", "Unidade", "Total"])
  })
})
