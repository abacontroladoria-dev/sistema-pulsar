// Testes de medirFrescorGrade — ver o cabeçalho da função em fonte.ts.
//
// Os números vêm da medição em produção de 2026-09-10, quando o sync da grade
// estava havia 9 dias morrendo em silêncio: a janela que a Ocupação de Paciente
// usa (01–07/10) tinha visto_em de 01/09 13:42 — 222,8 horas — enquanto a semana
// corrente (08–14/09) estava fresca, com 13,5 horas.

import { describe, expect, it, vi, beforeEach } from "vitest"

// A linha que a consulta devolve no caso da vez. O mock lê desta variável.
let linhas: Array<{ visto_em: string | null }> = []
let erro: { message: string } | null = null
// Filtros recebidos, para conferir que a consulta pergunta o que deve.
let filtros: Record<string, unknown> = {}

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => {
    const thenable: Record<string, unknown> = {
      select: () => thenable,
      gte: (col: string, v: unknown) => { filtros[`gte:${col}`] = v; return thenable },
      lte: (col: string, v: unknown) => { filtros[`lte:${col}`] = v; return thenable },
      eq:  (col: string, v: unknown) => { filtros[`eq:${col}`] = v; return thenable },
      order: (col: string, o: unknown) => { filtros[`order:${col}`] = o; return thenable },
      limit: (n: number) => { filtros.limit = n; return thenable },
      // O await no builder cai aqui.
      then: (resolve: (r: unknown) => unknown) =>
        resolve({ data: erro ? null : linhas, error: erro }),
    }
    return { from: (t: string) => { filtros.tabela = t; return thenable } }
  },
}))

const { medirFrescorGrade, HORAS_FRESCOR_GRADE } = await import("./fonte")

const AGORA = new Date("2026-09-10T20:00:00Z")

beforeEach(() => {
  linhas = []
  erro = null
  filtros = {}
})

describe("medirFrescorGrade — o caso que motivou a função", () => {
  it("acusa a janela congelada em 01/09 (o bug de 10/09/2026)", async () => {
    linhas = [{ visto_em: "2026-09-01T13:42:00+00:00" }]
    const f = await medirFrescorGrade("2026-10-01", "2026-10-07", 280, undefined, AGORA)

    expect(f.desatualizado).toBe(true)
    expect(f.visto).toBe("2026-09-01T13:42:00+00:00")
    // 9 dias e pouco — o valor medido em produção foi 222,8h.
    expect(f.horas).toBeGreaterThan(220)
    expect(f.horas).toBeLessThan(225)
  })

  it("fica calado na semana corrente, que estava fresca (13,5h)", async () => {
    linhas = [{ visto_em: "2026-09-10T07:01:00+00:00" }]
    const f = await medirFrescorGrade("2026-09-08", "2026-09-14", 280, undefined, AGORA)

    expect(f.desatualizado).toBe(false)
    expect(f.horas).toBeCloseTo(12.98, 1)
  })
})

describe("período sem grade não é alarme", () => {
  it("devolve desatualizado=false quando não há nenhuma linha", async () => {
    linhas = []
    const f = await medirFrescorGrade("2027-01-01", "2027-01-07", 280, undefined, AGORA)

    // Sem linha não há o que reconfirmar: silêncio legítimo, não falha de sync.
    expect(f).toEqual({ visto: null, horas: null, desatualizado: false })
  })

  it("trata visto_em nulo como ausência de linha", async () => {
    linhas = [{ visto_em: null }]
    const f = await medirFrescorGrade("2026-10-01", "2026-10-07", 280, undefined, AGORA)
    expect(f.desatualizado).toBe(false)
    expect(f.visto).toBeNull()
  })
})

describe("o limite", () => {
  it("não dispara exatamente no limite, só acima dele", async () => {
    const noLimite = new Date(AGORA.getTime() - HORAS_FRESCOR_GRADE * 3_600_000)
    linhas = [{ visto_em: noLimite.toISOString() }]
    expect((await medirFrescorGrade("2026-10-01", "2026-10-07", 280, undefined, AGORA)).desatualizado)
      .toBe(false)

    linhas = [{ visto_em: new Date(noLimite.getTime() - 60_000).toISOString() }]
    expect((await medirFrescorGrade("2026-10-01", "2026-10-07", 280, undefined, AGORA)).desatualizado)
      .toBe(true)
  })

  it("aceita um limite próprio", async () => {
    linhas = [{ visto_em: "2026-09-10T00:00:00+00:00" }] // 20h antes de AGORA
    expect((await medirFrescorGrade("a", "b", 280, undefined, AGORA, 24)).desatualizado).toBe(false)
    expect((await medirFrescorGrade("a", "b", 280, undefined, AGORA, 12)).desatualizado).toBe(true)
  })
})

describe("a consulta", () => {
  it("lê a TABELA (as views não projetam visto_em), só ativas, mais recente primeiro", async () => {
    linhas = [{ visto_em: "2026-09-01T13:42:00+00:00" }]
    await medirFrescorGrade("2026-10-01", "2026-10-07", 280, undefined, AGORA)

    expect(filtros.tabela).toBe("csv_grades_profissionais")
    expect(filtros["gte:data"]).toBe("2026-10-01")
    expect(filtros["lte:data"]).toBe("2026-10-07")
    expect(filtros["eq:ativo"]).toBe(true)
    expect(filtros["eq:unidade_id"]).toBe(280)
    expect(filtros["order:visto_em"]).toEqual({ ascending: false })
    // Uma linha basta: só interessa o carimbo mais recente.
    expect(filtros.limit).toBe(1)
  })

  it("não filtra unidade quando ela é omitida", async () => {
    linhas = [{ visto_em: "2026-09-01T13:42:00+00:00" }]
    await medirFrescorGrade("2026-10-01", "2026-10-07", undefined, undefined, AGORA)
    expect(filtros["eq:unidade_id"]).toBeUndefined()
  })
})

describe("erro", () => {
  it("propaga a mensagem do PostgREST", async () => {
    erro = { message: "permission denied" }
    await expect(medirFrescorGrade("2026-10-01", "2026-10-07", 280, undefined, AGORA))
      .rejects.toThrow("permission denied")
  })
})
