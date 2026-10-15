import { describe, expect, it } from "vitest"
import { linkFormularioDisponibilidade, mensagemFormularioDisponibilidade } from "./disponibilidadePaciente"

describe("link do formulário de disponibilidade", () => {
  it("sempre aponta para o endereço público, venha a cópia de onde vier", () => {
    expect(linkFormularioDisponibilidade()).toBe("https://orbitaautomacao.com.br/disponibilidade-paciente/")
  })

  it("mensagem usa o primeiro nome e o link público", () => {
    const m = mensagemFormularioDisponibilidade("Joao Pedro Silva")
    expect(m).toBe(
      "Olá! Para organizarmos os horários de terapia de Joao, preencha a disponibilidade neste link: " +
        "https://orbitaautomacao.com.br/disponibilidade-paciente/ — use o CPF da criança para entrar.",
    )
    expect(m).not.toMatch(/localhost/)
    expect(mensagemFormularioDisponibilidade()).toMatch(/^Olá! Para organizarmos os horários de terapia, preencha/)
  })
})
