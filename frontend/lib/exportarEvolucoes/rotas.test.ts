import { beforeEach, describe, expect, it, vi } from "vitest"

// As três rotas /api/exportar-evolucoes/* rodam com a service_role: a ÚNICA
// porta é exigirPermissao("exportar_evolucoes"). Aqui se prova que sem sessão
// (401) e sem permissão (403) nada chega ao banco nem ao storage.

const rpc = vi.fn()
const from = vi.fn()
const storage = { from: vi.fn() }
vi.mock("@/lib/supabase/service", () => ({ supabaseService: { rpc, from, storage } }))

const exigir = vi.fn()
vi.mock("@/lib/permissions/exigirPermissao", async () => {
  class AcessoRecusado extends Error {
    constructor(readonly status: 401 | 403, mensagem: string) {
      super(mensagem)
    }
  }
  return { AcessoRecusado, exigirPermissao: (c: string) => exigir(c) }
})

const { AcessoRecusado } = (await import("@/lib/permissions/exigirPermissao")) as unknown as {
  AcessoRecusado: new (s: 401 | 403, m: string) => Error
}
const listar = await import("@/app/api/exportar-evolucoes/listar/route")
const conteudo = await import("@/app/api/exportar-evolucoes/conteudo/route")
const assinaturas = await import("@/app/api/exportar-evolucoes/assinaturas/route")

const req = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body) })
const ROTAS = [
  ["listar", () => listar.POST(req({ de: "2026-08-01", ate: "2026-08-31" }))],
  ["conteudo", () => conteudo.POST(req({ chaves: ["tita:00000000-0000-0000-0000-000000000001"], finalidade: "pdf" }))],
  ["assinaturas", () => assinaturas.POST(req({ chaves: ["tita:1"] }))],
] as const

beforeEach(() => {
  vi.resetAllMocks()
})

describe("rotas /api/exportar-evolucoes", () => {
  for (const [nome, chamar] of ROTAS) {
    it(`${nome}: 401 sem sessão e 403 sem permissão, sem tocar no banco`, async () => {
      exigir.mockRejectedValueOnce(new AcessoRecusado(401, "Sessão expirada."))
      expect((await chamar()).status).toBe(401)
      exigir.mockRejectedValueOnce(new AcessoRecusado(403, "Sem permissão."))
      expect((await chamar()).status).toBe(403)
      expect(exigir).toHaveBeenCalledWith("exportar_evolucoes")
      expect(rpc).not.toHaveBeenCalled()
      expect(from).not.toHaveBeenCalled()
      expect(storage.from).not.toHaveBeenCalled()
    })
  }

  it("conteudo: quem leu é o usuário da sessão, nunca um nome vindo do navegador", async () => {
    exigir.mockResolvedValueOnce({ usuarioId: "u-1", usuarioNome: "Ana da Autorização" })
    rpc.mockResolvedValueOnce({ data: [], error: null })
    await conteudo.POST(req({ chaves: ["tita:x"], finalidade: "csv", usuarioNome: "Outro", p_usuario_id: "u-2" }))
    expect(rpc).toHaveBeenCalledWith("exportar_evolucoes_conteudo", {
      p_chaves: ["tita:x"],
      p_usuario_id: "u-1",
      p_usuario_nome: "Ana da Autorização",
      p_finalidade: "csv",
    })
  })

  it("conteudo: finalidade inválida e mais de 500 chaves são recusadas antes do banco", async () => {
    exigir.mockResolvedValue({ usuarioId: "u-1", usuarioNome: "Ana" })
    expect((await conteudo.POST(req({ chaves: ["a"], finalidade: "outra" }))).status).toBe(400)
    const muitas = Array.from({ length: 501 }, (_, i) => `tita:${i}`)
    expect((await conteudo.POST(req({ chaves: muitas, finalidade: "pdf" }))).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("listar: função ausente no banco (migration pendente) vira 503 com mensagem clara", async () => {
    exigir.mockResolvedValueOnce({ usuarioId: null, usuarioNome: "Dev" })
    // assinatura nova e a antiga ausentes
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "not found" } })
    const r = await listar.POST(req({ de: "2026-08-01", ate: "2026-08-31" }))
    expect(r.status).toBe(503)
    expect((await r.json()).codigo).toBe("migration_pendente")
  })

  it("listar: passa quem listou (registro) e cai na assinatura antiga se o banco não tiver a 200500", async () => {
    exigir.mockResolvedValueOnce({ usuarioId: "u-1", usuarioNome: "Ana" })
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "not found" } })
    rpc.mockResolvedValueOnce({ data: [], error: null })
    const r = await listar.POST(req({ de: "2026-08-01", ate: "2026-08-31" }))
    expect(r.status).toBe(200)
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_usuario_id: "u-1", p_usuario_nome: "Ana" })
    expect(rpc.mock.calls[1][1]).not.toHaveProperty("p_usuario_id")
  })

  // Tabelas falsas: o que cada consulta da rota de assinaturas devolve.
  function bancoFalso(tabelas: Record<string, unknown[]>) {
    from.mockImplementation((t: string) => {
      const fim = async () => ({ data: tabelas[t] ?? [], error: null })
      const q: Record<string, unknown> = {}
      for (const m of ["select", "in", "is", "eq", "not"]) q[m] = () => q
      q.then = (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) => fim().then(ok, erro)
      return q
    })
  }

  it("assinaturas: profissional vem das evoluções pedidas, não do navegador", async () => {
    exigir.mockResolvedValueOnce({ usuarioId: "u-1", usuarioNome: "Ana" })
    const download = vi.fn()
    storage.from.mockReturnValue({ download })
    bancoFalso({ grade_evolucoes: [], profissionais: [] })
    const r = await assinaturas.POST(req({ chaves: ["tita:1"], profissional_ids: [10, 11, 12] }))
    expect((await r.json()).assinaturas).toEqual([])
    expect(download).not.toHaveBeenCalled()
  })

  it("assinaturas: caminho fora de profissionais/{id}/assinatura-* não é baixado", async () => {
    exigir.mockResolvedValueOnce({ usuarioId: "u-1", usuarioNome: "Ana" })
    const download = vi.fn()
    storage.from.mockReturnValue({ download })
    bancoFalso({
      grade_evolucoes: [{ tita_tratativa_profissional_id: 501 }],
      profissionais: [
        { id: 10, assinatura_path: "profissionais/11/assinatura-1.png" },
        { id: 12, assinatura_path: "profissionais/12/../../pacientes/1/foto.png" },
        { id: 13, assinatura_path: "pacientes/13/assinatura-1.png" },
      ],
    })
    const r = await assinaturas.POST(req({ chaves: ["tita:1", "tita:2"] }))
    expect((await r.json()).assinaturas).toEqual([])
    expect(download).not.toHaveBeenCalled()
  })
})
