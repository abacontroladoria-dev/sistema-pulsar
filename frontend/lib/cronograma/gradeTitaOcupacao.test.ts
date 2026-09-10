// Testes das regras C1/C2 de gradeTitaOcupacao — ver o cabeçalho do módulo.
//
// Os casos usam os dados reais medidos em produção em 2026-09-10 (Evelyn
// Andressa, profissional_id 8638, segunda-feira 05/10): a grade da TiTa tem 7
// slots dela (13:00→17:00) e NADA na manhã, enquanto o CSV de agendamentos tem
// 13 linhas, com 6 fantasmas em 08:00→11:20. Era a manhã inteira sendo ofertada
// em cima de horário sem grade aberta.

import { describe, expect, it, vi, beforeEach } from "vitest"
import type { CsvRow } from "@/types/cronograma"

// Linhas que a grade_profissionais_tita devolve no teste da vez. O mock abaixo
// lê desta variável, então cada caso a reescreve antes de chamar a função.
let linhasGrade: Array<{
  profissional_id: number | null
  data: string | null
  hora_inicial: string | null
  status_agendamento: string | null
}> = []

// Mock do cliente: só precisa honrar o encadeamento usado por buscarGrade
// (select→eq→gte→in→order→range) e devolver { data, error } no fim.
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => {
    const thenable = {
      select: () => thenable,
      eq: () => thenable,
      gte: () => thenable,
      in: () => thenable,
      order: () => thenable,
      // Uma página só: a paginação para quando linhas.length < PAGE (1000).
      range: async () => ({ data: linhasGrade, error: null }),
    }
    return { from: () => thenable }
  },
}))

const { filtrarLivresSemGradeAberta } = await import("./gradeTitaOcupacao")

const EVELYN = 8638
const SEGUNDA = "2026-10-05"

/** Linha de vw_grade_base como buscarGradeComoCSVRows a entrega. */
function slot(hora: string, status = "Livre", profId: number | null = EVELYN, data = SEGUNDA): CsvRow {
  return {
    ProfissionalId: profId,
    Data: data,
    HI_str: hora,
    "Hora Inicial": hora,
    "Status do Agendamento": status,
    Profissional: "Evelyn Andressa Alves Do Nascimento De Souza",
    Terapia: "Coordenador de Caso",
    "Dia da Semana": "Segunda-feira",
  } as unknown as CsvRow
}

function naGrade(hora: string, status = "Livre", profId = EVELYN, data = SEGUNDA) {
  return { profissional_id: profId, data, hora_inicial: `${hora}:00`, status_agendamento: status }
}

/** A segunda real da Evelyn: nada antes das 13:00. */
const SEGUNDA_REAL = [
  naGrade("13:00", "Livre"),
  naGrade("13:40", "Agendado"),
  naGrade("14:20", "Livre"),
  naGrade("15:00", "Agendado"),
  naGrade("15:40", "Livre"),
  naGrade("16:20", "Agendado"),
  naGrade("17:00", "Agendado"),
]

const horasDe = (rows: CsvRow[]) => rows.map(r => String(r.HI_str))

beforeEach(() => { linhasGrade = [] })

describe("C2 — horário sem grade aberta", () => {
  it("remove os slots 'Livre' da manhã que não existem na grade (caso Evelyn)", async () => {
    linhasGrade = SEGUNDA_REAL
    const manha = ["08:00", "08:40", "09:20", "10:00", "10:40", "11:20"]
    const out = await filtrarLivresSemGradeAberta(manha.map(h => slot(h)), SEGUNDA)
    expect(out).toEqual([])
  })

  it("mantém o slot 'Livre' que existe na grade", async () => {
    linhasGrade = SEGUNDA_REAL
    const out = await filtrarLivresSemGradeAberta([slot("13:00"), slot("08:00")], SEGUNDA)
    expect(horasDe(out)).toEqual(["13:00"])
  })

  it("decide por DATA, não por dia da semana: outra segunda sem grade não herda a que tem", async () => {
    // A regra C1 agrega por dia da semana de propósito (série semanal). Se a C2
    // fizesse o mesmo, o 13:00 com grade em 05/10 validaria o 13:00 de 12/10,
    // que aqui não tem grade nenhuma.
    linhasGrade = [...SEGUNDA_REAL, naGrade("13:00", "Livre", EVELYN, "2026-10-12")]
    const out = await filtrarLivresSemGradeAberta(
      [slot("13:00", "Livre", EVELYN, "2026-10-05"),
       slot("14:20", "Livre", EVELYN, "2026-10-12")],
      SEGUNDA,
    )
    expect(horasDe(out)).toEqual(["13:00"])
  })
})

describe("C1 — slot comprometido (não regride)", () => {
  it("remove o 'Livre' do CSV que a grade dá como 'Agendado'", async () => {
    linhasGrade = SEGUNDA_REAL
    const out = await filtrarLivresSemGradeAberta([slot("13:40")], SEGUNDA)
    expect(out).toEqual([])
  })

  it("olha para frente: 'Agendado' em outra data do mesmo dia da semana bloqueia", async () => {
    // O slot está livre em 05/10 e ocupado em 12/10 — a série semanal
    // colidiria no meio. Ambas as datas existem na grade, então quem barra
    // aqui é a C1, não a C2.
    linhasGrade = [naGrade("14:20", "Livre"), naGrade("14:20", "Agendado", EVELYN, "2026-10-12")]
    const out = await filtrarLivresSemGradeAberta([slot("14:20")], SEGUNDA)
    expect(out).toEqual([])
  })
})

describe("o que nunca é filtrado", () => {
  it("linha 'Agendado' do CSV passa intacta — a regra só julga oferta", async () => {
    linhasGrade = SEGUNDA_REAL
    const agendada = slot("08:00", "Agendado")
    const out = await filtrarLivresSemGradeAberta([agendada], SEGUNDA)
    expect(out).toEqual([agendada])
  })

  it("linha sem ProfissionalId é mantida — sem id não há como consultar a grade", async () => {
    linhasGrade = SEGUNDA_REAL
    const semId = slot("08:00", "Livre", null)
    const out = await filtrarLivresSemGradeAberta([semId], SEGUNDA)
    expect(out).toEqual([semId])
  })
})

describe("C3 — profissional desligado", () => {
  // Caso real: 14517 INATIVO-Gabriela Pereira Ramos, 30 slots 'Livre' e zero
  // linha na grade. Sem a C3 a abstenção da C2 deixaria as 30 passarem.
  const desligada = (hora: string, profId = 14517) => ({
    ...slot(hora, "Livre", profId),
    Profissional: "INATIVO-Gabriela Pereira Ramos",
  } as unknown as CsvRow)

  it("remove a vaga de quem tem o prefixo INATIVO-, mesmo sem grade nenhuma", async () => {
    linhasGrade = SEGUNDA_REAL
    const out = await filtrarLivresSemGradeAberta([desligada("08:00")], SEGUNDA)
    expect(out).toEqual([])
  })

  it("remove mesmo quando a grade TEM o horário — o desligamento vence", async () => {
    linhasGrade = [naGrade("13:00", "Livre", 14517)]
    const out = await filtrarLivresSemGradeAberta([desligada("13:00")], SEGUNDA)
    expect(out).toEqual([])
  })

  it("não confunde com nome que apenas começa parecido", async () => {
    linhasGrade = [naGrade("13:00", "Livre")]
    const ativa = { ...slot("13:00"), Profissional: "Inativa Souza" } as unknown as CsvRow
    const out = await filtrarLivresSemGradeAberta([ativa], SEGUNDA)
    expect(out).toEqual([ativa])
  })
})

describe("fail-open", () => {
  it("grade vazia (RLS/sessão anônima) desliga as duas regras", async () => {
    // Sem este ramo, "nenhuma linha lida" significaria "nada existe na grade" e
    // a C2 esvaziaria a tela inteira em silêncio.
    linhasGrade = []
    const avisos = vi.spyOn(console, "warn").mockImplementation(() => {})
    const entrada = [slot("08:00"), slot("13:00")]
    const out = await filtrarLivresSemGradeAberta(entrada, SEGUNDA)
    expect(out).toEqual(entrada)
    expect(avisos).toHaveBeenCalledOnce()
    avisos.mockRestore()
  })

  it("profissional sem NENHUMA linha na grade se abstém", async () => {
    // Ambíguo entre sync parcial e profissional que não tem mais grade — a C2
    // não decide, para não esconder a agenda inteira por falha de carga.
    linhasGrade = SEGUNDA_REAL
    const outroProf = slot("08:00", "Livre", 9999)
    const out = await filtrarLivresSemGradeAberta([outroProf], SEGUNDA)
    expect(out).toEqual([outroProf])
  })

  it("mas a abstenção NÃO é por dia: profissional lido decide em todos os dias", async () => {
    // Medido em produção: abster por dia deixava passar 71 slots que a API bruta
    // da TiTa confirma não existirem (profissional com grade em três dias sendo
    // ofertado nos outros). A Evelyn foi lida, então a terça dela também é
    // julgada — mesmo sem nenhuma linha de terça na grade.
    linhasGrade = SEGUNDA_REAL
    const out = await filtrarLivresSemGradeAberta(
      [slot("08:00", "Livre", EVELYN, "2026-10-05"),   // dia lido, sem grade → sai
       slot("08:00", "Livre", EVELYN, "2026-10-06")],  // prof lido, terça sem grade → sai
      SEGUNDA,
    )
    expect(out).toEqual([])
  })
})
