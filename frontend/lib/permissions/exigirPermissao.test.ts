import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// exigirPermissao é a porta única das rotas /api com dado sensível (o proxy.ts
// não cobre /api). Aqui se prova que ela aplica as mesmas portas do proxy:
// segundo fator (aal2), primeiro acesso — e que DISABLE_AUTH não abre nada no
// build de produção.

type Perfil = { role: string; nome: string; ativo: boolean; primeiro_acesso: boolean; username: string | null }
let perfil: Perfil
let aal: { currentLevel: string; nextLevel: string }
let usuario: { id: string; email: string } | null

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: usuario }, error: null }),
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: aal, error: null }) },
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: perfil }) }) }) }),
  }),
}))
vi.mock("@/lib/permissions/carregar", () => ({ carregarPermissoesEfetivas: async () => new Set(["exportar_evolucoes"]) }))
vi.mock("@/lib/permissions/resolver", () => ({
  temPermissao: (_role: string, efetivas: Set<string>, codigo: string) => efetivas.has(codigo),
}))

const { exigirPermissao } = await import("./exigirPermissao")

const status = async () => {
  try {
    await exigirPermissao("exportar_evolucoes")
    return 200
  } catch (e) {
    return (e as { status?: number }).status ?? 500
  }
}

beforeEach(() => {
  usuario = { id: "u-1", email: "ana@clinica" }
  perfil = { role: "autorizacao", nome: "Ana", ativo: true, primeiro_acesso: false, username: "ana" }
  aal = { currentLevel: "aal1", nextLevel: "aal1" }
  vi.stubEnv("DISABLE_AUTH", "")
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe("exigirPermissao", () => {
  it("libera quem tem a permissão e não cadastrou o app", async () => {
    expect(await status()).toBe(200)
  })

  it("quem cadastrou o app e entrou só com a senha (aal1) é recusado", async () => {
    aal = { currentLevel: "aal1", nextLevel: "aal2" }
    expect(await status()).toBe(401)
  })

  it("com o código confirmado (aal2) passa", async () => {
    aal = { currentLevel: "aal2", nextLevel: "aal2" }
    expect(await status()).toBe(200)
  })

  it("primeiro acesso não concluído é recusado", async () => {
    perfil.primeiro_acesso = true
    expect(await status()).toBe(403)
    perfil.primeiro_acesso = false
    perfil.username = null
    expect(await status()).toBe(403)
  })

  it("sem sessão: 401; inativo: 401", async () => {
    usuario = null
    expect(await status()).toBe(401)
    usuario = { id: "u-1", email: "ana@clinica" }
    perfil.ativo = false
    expect(await status()).toBe(401)
  })

  it("DISABLE_AUTH libera só fora do build de produção", async () => {
    usuario = null
    vi.stubEnv("DISABLE_AUTH", "true")
    vi.stubEnv("NODE_ENV", "development")
    expect(await status()).toBe(200)
    vi.stubEnv("NODE_ENV", "production")
    expect(await status()).toBe(401)
  })
})
