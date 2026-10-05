import { describe, expect, it } from "vitest"
import { aplicarConvenioCadastro, montarMapaConvenioCadastro } from "./convenioCadastro"
import { calcularPrevisaoReceita, calcularSessoesMensaisPorConvenio, enriquecerComDeducaoFalta } from "./faturamentoProjecao"
import type { AgendaSalaRow } from "./salasTypes"
import type { ConvenioValor } from "./convenioValoresTypes"

function linha(p: Partial<AgendaSalaRow>): AgendaSalaRow {
  return {
    tita_agendamento_id: null, paciente_id: null, paciente_nome: null, convenio_nome: null,
    unidade_nome: "CLÍNICA UNIVERSO ABA", sala_nome: "Unid. Realengo - Sala 1", profissional_nome: "Prof",
    profissional_id: 1, terapia_id: 1, terapia_nome: "Fonoaudiologia", terapia_exibicao_id: null,
    terapia_exibicao_nome: null, dia_semana: "Segunda-feira", hora_inicial: "08:00", hora_final: "09:00",
    status_agendamento: "Agendado", data: "2026-11-02", ...p,
  }
}

function regra(convenio_nome: string, valor_sessao: number): ConvenioValor {
  return { id: convenio_nome, convenio_nome, terapia_id: null, terapia_nome: null, criterio_aba: null, valor_sessao, observacoes: null, created_at: "", updated_at: "" }
}

// Bruno: agenda "Particular" (R$ 100), cadastro "LEVE SAUDE" (R$ 150) — o caso
// que motivou a mudança. Ana: agenda e cadastro concordam. Carla: sem cadastro.
const rows: AgendaSalaRow[] = [
  linha({ tita_agendamento_id: 10, paciente_id: 1, paciente_nome: "Ana", convenio_nome: "ASSIM Saúde" }),
  linha({ tita_agendamento_id: 20, paciente_id: 2, paciente_nome: "Bruno", convenio_nome: "Particular" }),
  linha({ tita_agendamento_id: 21, paciente_id: 2, paciente_nome: "Bruno", convenio_nome: "Particular", data: "2026-11-09" }),
  linha({ tita_agendamento_id: 30, paciente_id: 3, paciente_nome: "Carla", convenio_nome: "Particular" }),
]
const mapa = montarMapaConvenioCadastro([
  { id: 1, nome: "Ana", situacao: "Ativo", planoSaude: "ASSIM Saúde" },
  { id: 2, nome: "Bruno", situacao: "Ativo", planoSaude: "LEVE SAUDE" },
  // Mesmo ID com dois planos (linha de CSV quebrada) → conflito, fica com a agenda.
  { id: 3, nome: "Carla", situacao: "Ativo", planoSaude: "LEVE SAUDE" },
  { id: 3, nome: "Carla", situacao: "Ativo", planoSaude: "Amil Saude" },
])
const regras = [regra("ASSIM Saúde", 80), regra("Particular", 100), regra("LEVE SAUDE", 150)]

describe("aplicarConvenioCadastro", () => {
  it("sem mapa devolve o próprio array (convênio da agenda, nada recalculado)", () => {
    expect(aplicarConvenioCadastro(rows, null)).toBe(rows)
  })

  it("troca só o convenio_nome, pelo cadastro; conflito e sem cadastro ficam com a agenda", () => {
    const out = aplicarConvenioCadastro(rows, mapa)
    expect(out.map(r => r.convenio_nome)).toEqual(["ASSIM Saúde", "LEVE SAUDE", "LEVE SAUDE", "Particular"])
    expect(out[1]).toEqual({ ...rows[1], convenio_nome: "LEVE SAUDE" })
    expect(rows[1].convenio_nome).toBe("Particular") // não muta a entrada
  })
})

describe("Previsão de Receitas com o convênio do cadastro", () => {
  const linhas = aplicarConvenioCadastro(rows, mapa)

  it("nome e preço vêm do MESMO convênio (cadastro)", () => {
    const mens = calcularSessoesMensaisPorConvenio(linhas, regras, [], [], new Set())
    const leve = mens.multidisciplinar.get("LEVE SAUDE") ?? []
    expect(leve.map(s => s.valor)).toEqual([150, 150])
    expect((mens.multidisciplinar.get("Particular") ?? []).map(s => s.pacienteNome)).toEqual(["Carla"])
  })

  it("a dedução por falta cai na linha do convênio do cadastro", () => {
    const base = calcularPrevisaoReceita(linhas, regras, [], [], {})
    const prev = enriquecerComDeducaoFalta(base, linhas, new Set([21]), regras, [])
    const porConv = new Map(prev.multidisciplinar.porConvenio.map(c => [c.convenio, c]))
    expect(porConv.get("LEVE SAUDE")?.deducaoFalta).toBe(150)
    expect(porConv.get("Particular")?.deducaoFalta ?? 0).toBe(0)
    expect(porConv.get("LEVE SAUDE")?.pacientesUnicos).toBe(1)
  })

  it("sessões e sem-valor não mudam com a troca (só a chave de convênio)", () => {
    const antes = calcularPrevisaoReceita(rows, regras, [], [], {}).multidisciplinar
    const depois = calcularPrevisaoReceita(linhas, regras, [], [], {}).multidisciplinar
    expect(depois.sessoesTotal).toBe(antes.sessoesTotal)
    expect(depois.sessoesSemValor).toBe(antes.sessoesSemValor)
  })
})
