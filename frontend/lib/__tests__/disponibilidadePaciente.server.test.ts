import { describe, expect, it } from "vitest"
import { LIMITE_CORPO_BYTES, lerJsonLimitado } from "../disponibilidadePaciente.server"
import { checkRateLimit } from "../rate-limit"

const pedido = (corpo: string, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/x", { method: "POST", body: corpo, headers })

describe("lerJsonLimitado", () => {
  it("lê um JSON normal", async () => {
    expect(await lerJsonLimitado(pedido(JSON.stringify({ cpf: "123" })))).toEqual({ cpf: "123" })
  })

  it("recusa corpo acima do teto, mesmo sem content-length", async () => {
    const grande = JSON.stringify({ nome: "x".repeat(LIMITE_CORPO_BYTES) })
    expect(await lerJsonLimitado(pedido(grande))).toBeNull()
  })

  it("recusa pelo content-length declarado antes de ler", async () => {
    expect(await lerJsonLimitado(pedido("{}", { "content-length": String(LIMITE_CORPO_BYTES + 1) }))).toBeNull()
  })

  it("recusa JSON inválido, vazio e lista", async () => {
    expect(await lerJsonLimitado(pedido("{nao é json"))).toBeNull()
    expect(await lerJsonLimitado(pedido(""))).toBeNull()
    expect(await lerJsonLimitado(pedido("[1,2]"))).toBeNull()
  })
})

describe("checkRateLimit", () => {
  it("continua limitando a mesma chave depois da limpeza automática", () => {
    // Enche o Map acima do teto de limpeza com chaves já vencidas (janela 0).
    for (let i = 0; i < 5100; i++) checkRateLimit(`teste-vencida-${i}`, 1, 0)
    expect(checkRateLimit("teste-viva", 2, 60_000)).toBe(false)
    expect(checkRateLimit("teste-viva", 2, 60_000)).toBe(false)
    expect(checkRateLimit("teste-viva", 2, 60_000)).toBe(true)
  })
})
