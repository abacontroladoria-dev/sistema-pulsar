import { describe, expect, it } from "vitest"
import type { EvolucaoConteudo } from "@/types/exportarEvolucoes"
import { gerarCsv, protegerFormula } from "./csv"

const base: EvolucaoConteudo = {
  chave: "tita:00000000-0000-0000-0000-000000000001",
  origem: "tita",
  agendamento_id: "3654133",
  data: "2026-10-05",
  hora_inicio: "07:30",
  hora_fim: "08:00",
  paciente_id: 1,
  paciente_nome: "Maria Souza",
  paciente_cpf: "12345678900",
  paciente_nascimento: "2021-05-03",
  convenio: "Unimed",
  terapia: "Psicologia ABA",
  profissional_id: 10,
  profissional_nome: "Sara Sousa",
  tipo_registro: "CRP",
  uf_registro: "SP",
  codigo_registro: "06/12345",
  tem_assinatura: true,
  substituicao: false,
  registrado_por_nome: "Admin Fulano",
  descricao: "Primeira linha;\r\ncom \"aspas\"\nterceira",
}

describe("gerarCsv", () => {
  const csv = gerarCsv([base])

  it("começa com BOM, usa ; e aspas em todo campo", () => {
    expect(csv.startsWith("﻿")).toBe(true)
    const cabecalho = csv.slice(1).split("\r\n")[0]
    expect(cabecalho).toBe(
      '"ID do agendamento";"Data";"Horário início";"Horário fim";"Paciente";"CPF";"Data de nascimento";"Convênio";"Terapia";"Profissional";"Registro";"Descrição"',
    )
  })

  it("formata data, CPF e registro; mantém a quebra de linha dentro da célula", () => {
    expect(csv).toContain('"3654133";"05/10/2026";"07:30";"08:00";"Maria Souza";"123.456.789-00";"03/05/2021";"Unimed";"Psicologia ABA";"Sara Sousa";"CRP 06/12345 · SP"')
    expect(csv).toContain('"Primeira linha;\ncom ""aspas""\nterceira"')
  })

  it("linhas separadas por CRLF, uma por evolução", () => {
    expect(gerarCsv([base, base]).slice(1).trimEnd().split("\r\n")).toHaveLength(3)
  })

  it("ID do agendamento vazio quando não há (ou antes da migration)", () => {
    const linhaSemId = (csv: string) => csv.slice(1).split(String.fromCharCode(13, 10))[1]
    expect(linhaSemId(gerarCsv([{ ...base, agendamento_id: null }])).startsWith('"";"05/10/2026"')).toBe(true)
    const semId: EvolucaoConteudo = { ...base }
    delete semId.agendamento_id
    expect(linhaSemId(gerarCsv([semId])).startsWith('"";"05/10/2026"')).toBe(true)
  })

  it("protege contra fórmula", () => {
    for (const v of ["=1+1", "+cmd", "-2", "@SOMA(A1)", "\tx", "\rx"]) expect(protegerFormula(v).startsWith("'")).toBe(true)
    expect(protegerFormula("Maria")).toBe("Maria")
    expect(gerarCsv([{ ...base, paciente_nome: "=HYPERLINK(\"x\")" }])).toContain(`"'=HYPERLINK(""x"")"`)
  })

  it("não tem a palavra TiTa nem a origem", () => {
    const tudo = gerarCsv([base, { ...base, origem: "pulsar", chave: "pulsar:x" }]).toLowerCase()
    expect(tudo).not.toContain("tita")
    expect(tudo).not.toContain("pulsar")
    expect(tudo).not.toContain("admin fulano")
  })
})
