// medirReleituraGrade — ver fonte.ts. Cliente falso injetado: a função recebe
// `cliente` justamente para não depender do cliente de browser.
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/client", () => ({ getSupabaseClient: () => { throw new Error("não deveria usar") } }))
const { medirReleituraGrade } = await import("./fonte")

function cliente(linhas: { data: string }[], filtros: Record<string, unknown> = {}) {
  const q: Record<string, unknown> = {
    select: () => q,
    gte: (c: string, v: unknown) => { filtros[`gte:${c}`] = v; return q },
    lte: (c: string, v: unknown) => { filtros[`lte:${c}`] = v; return q },
    eq: (c: string, v: unknown) => { filtros[`eq:${c}`] = v; return q },
    then: (ok: (r: unknown) => unknown) => ok({ data: linhas, error: null }),
  }
  return { from: () => q }
}

describe("medirReleituraGrade", () => {
  it("conta os dias carimbados depois do pedido e lista os que faltam", async () => {
    const filtros: Record<string, unknown> = {}
    const r = await medirReleituraGrade("2026-10-20", "2026-10-23", "2026-10-20T17:00:00Z", 280,
      cliente([{ data: "2026-10-20" }, { data: "2026-10-22" }], filtros))
    expect(r).toEqual({ total: 4, conferidos: 2, faltando: ["2026-10-21", "2026-10-23"] })
    expect(filtros["gte:sincronizado_em"]).toBe("2026-10-20T17:00:00Z")
    expect(filtros["eq:modo"]).toBe("grade")
  })

  it("janela inteira conferida", async () => {
    const r = await medirReleituraGrade("2026-10-31", "2026-11-01", "x", 280,
      cliente([{ data: "2026-10-31" }, { data: "2026-11-01" }]))
    expect(r.faltando).toEqual([])
    expect(r.conferidos).toBe(2)
  })
})
