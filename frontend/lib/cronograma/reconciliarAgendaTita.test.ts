// Testes da reconciliação contra agenda_tita — ver o cabeçalho do módulo.
//
// O caso central é o real, medido em produção em 2026-09-10: o Aplicador ABA
// (PS) do Davi Lucca Alves (11582) com a Michele mudou de 10:00 para 10:40 em
// 02/09; a agenda_tita registrou, o csv_grades_profissionais ficou congelado em
// 01/09 e nunca viu. A tela mostrava buraco às 10:40 e sessão fantasma às 10:00.

import { describe, expect, it, vi, beforeEach } from "vitest"
import type { CsvRow } from "@/types/cronograma"

let linhasAgenda: Array<Record<string, unknown>> = []
let erroAgenda: { message: string } | null = null

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => {
    const thenable = {
      select: () => thenable,
      eq: () => thenable,
      gte: () => thenable,
      lte: () => thenable,
      order: () => thenable,
      range: async () => {
        if (erroAgenda) return { data: null, error: erroAgenda }
        return { data: linhasAgenda, error: null }
      },
    }
    return { from: () => thenable }
  },
}))

const { reconciliarAgendadosComAgendaTita } = await import("./reconciliarAgendaTita")

const DAVI = 11582
const SEGUNDA = "2026-10-05"
const DE = "2026-10-01"
const ATE = "2026-10-07"

/** Linha de vw_grade_base como buscarGradeComoCSVRows a entrega. */
function csvRow(hora: string, status: string, terapia = "Aplicador ABA (PS)", titaId: number | null = 3569319): CsvRow {
  return {
    TitaAgendamentoId: titaId,
    PacienteId: DAVI,
    ProfissionalId: 8795,
    "Nome Favorecido": "Davi Lucca Alves Da Silva",
    "Dia da Semana": "Segunda-feira",
    "Hora Inicial": hora,
    Terapia: terapia,
    Profissional: "Michele Sousa Freire de Faria",
    "Status do Agendamento": status,
    Sala: "Unid. Realengo - Sala 5",
    Data: SEGUNDA,
    HI_str: hora,
  } as unknown as CsvRow
}

/** Linha da agenda_tita. `ativo: false` é a memória de um agendamento baixado. */
function agenda(
  hora: string, terapia = "Aplicador ABA (PS)", data = SEGUNDA,
  titaId = 3624424, ativo = true,
) {
  return {
    ativo,
    tita_agendamento_id: titaId,
    paciente_id: DAVI,
    paciente_nome: "Davi Lucca Alves Da Silva",
    data_atendimento: data,
    hora_inicial: `${hora}:00`,
    hora_final: "11:20:00",
    profissional_id: 8795,
    profissional_nome: "Michele Sousa Freire de Faria",
    terapia_nome: terapia,
    terapia_exibicao_nome: terapia,
    convenio_nome: "ASSIM Saúde",
    sala_nome: "Unid. Realengo - Sala 5",
  }
}

beforeEach(() => {
  linhasAgenda = []
  erroAgenda = null
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("o caso Davi Lucca (10:00 → 10:40)", () => {
  it("troca o horário velho do CSV pelo que a agenda_tita afirma", async () => {
    const cRows = [csvRow("10:00", "Agendado"), csvRow("11:20", "Agendado", "Musicoterapia", 2012133)]
    linhasAgenda = [
      // Como está em produção: o 3569319 (10:00) foi inativado e o 3624424
      // (10:40) entrou no lugar. A linha inativa precisa vir na leitura, senão
      // o 10:00 do CSV pareceria desconhecido e sobreviveria junto.
      agenda("10:00", "Aplicador ABA (PS)", SEGUNDA, 3569319, false),
      agenda("10:40"),
      agenda("11:20", "Musicoterapia", SEGUNDA, 2012133),
    ]

    const out = await reconciliarAgendadosComAgendaTita(cRows, DE, ATE)
    const horas = out.map(r => r.HI_str).sort()

    expect(horas).toEqual(["10:40", "11:20"])
    // O 10:00 fantasma sumiu — era ele que a tela mostrava.
    expect(horas).not.toContain("10:00")
  })

  it("deriva o dia da semana a partir da data (agenda_tita não tem a coluna)", async () => {
    linhasAgenda = [agenda("10:40")]
    const out = await reconciliarAgendadosComAgendaTita([], DE, ATE)
    // 2026-10-05 é segunda — o resto do módulo indexa por este texto.
    expect(out[0]["Dia da Semana"]).toBe("Segunda-feira")
  })

  it("preenche os campos derivados que o módulo consome", async () => {
    linhasAgenda = [agenda("10:40")]
    const [r] = await reconciliarAgendadosComAgendaTita([], DE, ATE)

    expect(r["Status do Agendamento"]).toBe("Agendado")
    expect(r.HI).toBe(10 * 60 + 40)          // minutos, via pm()
    expect(r.Unidade).toBe("Realengo")        // via exU() sobre a sala
    expect(r.ProfissionalId).toBe(8795)
  })
})

describe("slot Livre nunca é tocado", () => {
  it("preserva os Livre do CSV e só substitui os Agendado", async () => {
    const cRows = [
      csvRow("08:00", "Livre"),
      csvRow("10:00", "Agendado"),
      csvRow("09:20", "Livre"),
    ]
    linhasAgenda = [
      agenda("10:00", "Aplicador ABA (PS)", SEGUNDA, 3569319, false), // baixado
      agenda("10:40"),
    ]

    const out = await reconciliarAgendadosComAgendaTita(cRows, DE, ATE)
    const livres = out.filter(r => r["Status do Agendamento"] === "Livre").map(r => r.HI_str)

    expect(livres).toEqual(["08:00", "09:20"])
    expect(out.filter(r => r["Status do Agendamento"] === "Agendado")).toHaveLength(1)
  })
})

describe("fail-open", () => {
  it("devolve o CSV intacto quando a leitura vem vazia (provável RLS)", async () => {
    const cRows = [csvRow("10:00", "Agendado"), csvRow("08:00", "Livre")]
    linhasAgenda = []

    const out = await reconciliarAgendadosComAgendaTita(cRows, DE, ATE)
    // Trocar tudo aqui apagaria a agenda inteira da tela.
    expect(out).toEqual(cRows)
  })

  it("devolve o CSV intacto quando a consulta falha", async () => {
    const cRows = [csvRow("10:00", "Agendado")]
    erroAgenda = { message: "permission denied" }

    const out = await reconciliarAgendadosComAgendaTita(cRows, DE, ATE)
    expect(out).toEqual(cRows)
  })
})

describe("o que a agenda_tita não conhece continua valendo", () => {
  it("preserva sessão do CSV cujo agendamento não existe na agenda_tita", async () => {
    // Caso real medido em 2026-09-11, com os dois pipelines já sincronizados:
    // 3 Equoterapias na "Unid. Terceirizada" existem no CSV e não têm linha
    // nenhuma na agenda_tita. Substituir o bloco inteiro as apagaria, e a tela
    // passaria a ofertar horário em cima de sessão real.
    const equo = csvRow("10:00", "Agendado", "Equoterapia", 3624317)
    const cRows = [csvRow("10:00", "Agendado"), equo]
    linhasAgenda = [
      agenda("10:00", "Aplicador ABA (PS)", SEGUNDA, 3569319, false), // baixado
      agenda("10:40"),
    ]

    const out = await reconciliarAgendadosComAgendaTita(cRows, DE, ATE)
    const terapias = out.map(r => r.Terapia).sort()

    // A Equoterapia sobrevive; o horário velho (3569319) é substituído.
    expect(terapias).toEqual(["Aplicador ABA (PS)", "Equoterapia"])
    expect(out.find(r => r.Terapia === "Equoterapia")?.HI_str).toBe("10:00")
    expect(out.find(r => r.Terapia === "Aplicador ABA (PS)")?.HI_str).toBe("10:40")
  })

  it("não duplica quando a agenda_tita conhece o agendamento", async () => {
    const cRows = [csvRow("10:00", "Agendado", "Aplicador ABA (PS)", 3624424)]
    linhasAgenda = [agenda("10:40")] // mesmo tita_agendamento_id 3624424

    const out = await reconciliarAgendadosComAgendaTita(cRows, DE, ATE)
    expect(out).toHaveLength(1)
    expect(out[0].HI_str).toBe("10:40")
  })
})

describe("linhas imprestáveis", () => {
  it("descarta linha sem data ou sem hora", async () => {
    linhasAgenda = [
      agenda("10:40"),
      { ...agenda("11:20"), data_atendimento: null },
      { ...agenda("13:00"), hora_inicial: null },
    ]
    const out = await reconciliarAgendadosComAgendaTita([], DE, ATE)
    expect(out.map(r => r.HI_str)).toEqual(["10:40"])
  })
})
