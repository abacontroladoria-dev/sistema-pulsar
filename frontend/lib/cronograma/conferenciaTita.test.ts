// Testes de conferenciaTita — ver o cabeçalho do módulo.
//
// Dados reais: a quarta 04/11/2026 da Lívia dos Santos Barboza (18987) como o
// TiTa a devolveu em 20/10 (Fazendinha, Sala 8, só 10:40 e 11:20 livres) contra
// a cópia do Pulsar de 19/10 (Realengo, Sala 23, quarta inteira livre). O
// controle é uma vaga coerente do mesmo dia: Elisangela Motta Do Valle (8670),
// Realengo Sala 5, 10:40 Livre nos dois lados.

import { describe, expect, it } from "vitest"
import {
  chaveGradeTita, conferirEscrita, conferirVaga, indexarGradeTita, unidadeDaSala,
  type LinhaGradeTita, type VagaLocal,
} from "./conferenciaTita"

const LIVIA = 18987
const ELISANGELA = 8670
const QUARTA = "2026-11-04"
const FAZENDINHA_8 = "Unid. Fazendinha - Sala 8"
const REALENGO_23 = "Unid. Realengo - Sala 23"
const REALENGO_5 = "Unid. Realengo - Sala 5"

function noTita(
  prof: number, hora: string, status: string, idSala: number, sala: string, gtid: number, data = QUARTA,
): LinhaGradeTita {
  return { profissional_id: prof, data, hora_inicial: `${hora}:00`, status_agendamento: status, id_sala: idSala, sala, grade_terapeuta_id: gtid }
}

const QUARTA_LIVIA_TITA = [
  noTita(LIVIA, "10:00", "Agendado", 1434, FAZENDINHA_8, 74286),
  noTita(LIVIA, "10:40", "Livre", 1434, FAZENDINHA_8, 74287),
  noTita(LIVIA, "11:20", "Livre", 1434, FAZENDINHA_8, 74288),
]
const ELISANGELA_TITA = [noTita(ELISANGELA, "10:40", "Livre", 1489, REALENGO_5, 70001)]
const indice = indexarGradeTita([...QUARTA_LIVIA_TITA, ...ELISANGELA_TITA])

const vagaPulsar = (prof: number, hora: string, salaId: number | null, salaNome: string): VagaLocal => ({
  profissionalId: prof, data: QUARTA, horaInicial: hora, salaId, salaNome,
})
const slot = (prof: number, hora: string) => indice.get(chaveGradeTita(prof, QUARTA, hora))

describe("conferirVaga — a vaga que a tela oferece", () => {
  it("caso Lívia: Livre no TiTa, mas na Fazendinha → unidade divergente, nunca 'Realengo'", () => {
    for (const hora of ["10:40", "11:20"]) {
      const c = conferirVaga(vagaPulsar(LIVIA, hora, 1467, REALENGO_23), slot(LIVIA, hora))
      expect(c).toEqual({
        situacao: "unidade_divergente", unidadePulsar: "Realengo", unidadeTita: "Fazendinha", salaTita: FAZENDINHA_8,
      })
    }
  })

  it("vaga coerente (mesma sala, mesma unidade) continua valendo", () => {
    const c = conferirVaga(vagaPulsar(ELISANGELA, "10:40", 1489, REALENGO_5), slot(ELISANGELA, "10:40"))
    expect(c.situacao).toBe("confere")
  })

  it("troca de sala DENTRO da unidade não derruba a vaga", () => {
    const c = conferirVaga(vagaPulsar(ELISANGELA, "10:40", 1490, "Unid. Realengo - Sala 6"), slot(ELISANGELA, "10:40"))
    expect(c.situacao).toBe("confere")
  })

  it("horário que o TiTa já dá como Agendado → ocupado", () => {
    const c = conferirVaga(vagaPulsar(LIVIA, "10:00", 1467, REALENGO_23), slot(LIVIA, "10:00"))
    expect(c.situacao).toBe("ocupado")
  })

  it("horário que o TiTa não tem → ausente", () => {
    const c = conferirVaga(vagaPulsar(LIVIA, "08:00", 1467, REALENGO_23), slot(LIVIA, "08:00"))
    expect(c.situacao).toBe("ausente")
  })

  it("sala sem unidade legível ('Sala Teste') não vira divergência", () => {
    const c = conferirVaga(vagaPulsar(LIVIA, "10:40", null, "Sala Teste"), slot(LIVIA, "10:40"))
    expect(c.situacao).toBe("confere")
  })

  it("chave casa a hora com ou sem segundos", () => {
    expect(chaveGradeTita(LIVIA, QUARTA, "10:40:00")).toBe(chaveGradeTita(LIVIA, QUARTA, "10:40"))
  })

  it("unidadeDaSala segue exU", () => {
    expect(unidadeDaSala(FAZENDINHA_8)).toBe("Fazendinha")
    expect(unidadeDaSala("Sala Teste")).toBeNull()
  })
})

describe("conferirEscrita — o que a implantação vai gravar", () => {
  it("caso Lívia: recusa por unidade antes de olhar a grade do payload", () => {
    const c = conferirEscrita(
      vagaPulsar(LIVIA, "10:40", 1467, REALENGO_23), slot(LIVIA, "10:40"),
      { gradeTerapeutaId: 60000, idSala: 1467 },
    )
    expect(c.situacao).toBe("unidade_divergente")
  })

  it("payload com a grade e a sala de agora → confere", () => {
    const c = conferirEscrita(
      vagaPulsar(ELISANGELA, "10:40", 1489, REALENGO_5), slot(ELISANGELA, "10:40"),
      { gradeTerapeutaId: 70001, idSala: 1489 },
    )
    expect(c.situacao).toBe("confere")
  })

  it("grade refeita depois da cópia (grade_terapeuta_id que o TiTa não tem mais) → alterado", () => {
    const c = conferirEscrita(
      vagaPulsar(ELISANGELA, "10:40", 1489, REALENGO_5), slot(ELISANGELA, "10:40"),
      { gradeTerapeutaId: 69999, idSala: 1489 },
    )
    expect(c.situacao).toBe("alterado")
  })

  it("mesma grade, sala do payload diferente da de agora → alterado", () => {
    const c = conferirEscrita(
      vagaPulsar(ELISANGELA, "10:40", 1489, REALENGO_5), slot(ELISANGELA, "10:40"),
      { gradeTerapeutaId: 70001, idSala: 1490 },
    )
    expect(c.situacao).toBe("alterado")
  })
})
