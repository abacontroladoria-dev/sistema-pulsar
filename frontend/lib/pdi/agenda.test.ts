// Leituras sobre a grade para o Controle de Prazos do PDI — espelha o estilo
// de lib/laudos/filtros.test.ts (vitest + node:assert/strict).
//
//   npx vitest run lib/pdi/agenda.test.ts

import { test } from "vitest"
import assert from "node:assert/strict"
import {
  diasClinicos,
  turnoClinico,
  temAgendamentoAmbienteNatural,
  temAgendamentoFuturo,
  quantidadeAplicadores,
  aplicadoresDetalhados,
  coordenadorDoCaso,
  coordenadoresDetalhados,
  temAgendamentoPrimeiraSemanaMesSeguinte,
  temTerapiaAbaPrimeiraSemanaMesSeguinte,
  PACIENTES_PLACEHOLDER,
  TERAPIAS_ABA,
  type LinhaGradePdi,
} from "./agenda"

function linha(over: Partial<LinhaGradePdi> = {}): LinhaGradePdi {
  return {
    paciente_id: 11511,
    profissional_id: 1,
    data: "2026-09-07",
    dia_semana: "Segunda-feira",
    hora_inicial: "09:00:00",
    hora_final: "10:00:00",
    terapia_nome: "Aplicador ABA (PS)",
    ...over,
  }
}

// ─── diasClinicos ────────────────────────────────────────────────────────────

test("1 · diasClinicos junta os dias com sessão clínica, sem repetir", () => {
  const rows = [
    linha({ dia_semana: "Segunda-feira" }),
    linha({ dia_semana: "Segunda-feira" }),
    linha({ dia_semana: "Quarta-feira" }),
  ]
  assert.deepStrictEqual(diasClinicos(rows), ["Segunda-feira", "Quarta-feira"])
})

test("2 · diasClinicos ordena pela ordem da semana (DIAS_ORD), não pela ordem de entrada", () => {
  const rows = [
    linha({ dia_semana: "Sexta-feira" }),
    linha({ dia_semana: "Segunda-feira" }),
    linha({ dia_semana: "Quarta-feira" }),
  ]
  assert.deepStrictEqual(diasClinicos(rows), ["Segunda-feira", "Quarta-feira", "Sexta-feira"])
})

test("3 · diasClinicos ignora sessões de ambiente natural (Casa/Escola)", () => {
  const rows = [
    linha({ dia_semana: "Segunda-feira", terapia_nome: "Aplicador ABA Casa" }),
    linha({ dia_semana: "Terça-feira", terapia_nome: "Aplicador ABA (PS)" }),
  ]
  assert.deepStrictEqual(diasClinicos(rows), ["Terça-feira"])
})

test("4 · diasClinicos sem nenhuma linha clínica devolve array vazio", () => {
  assert.deepStrictEqual(diasClinicos([]), [])
})

// ─── turnoClinico ────────────────────────────────────────────────────────────

test("5 · só sessão de manhã (08:00-12:00) => 'manhã'", () => {
  assert.strictEqual(turnoClinico([linha({ hora_inicial: "09:00:00" })]), "manhã")
})

test("6 · só sessão de tarde (13:00-17:40) => 'tarde'", () => {
  assert.strictEqual(turnoClinico([linha({ hora_inicial: "14:00:00" })]), "tarde")
})

test("7 · sessão de manhã E de tarde => 'ambos'", () => {
  const rows = [linha({ hora_inicial: "09:00:00" }), linha({ hora_inicial: "14:00:00" })]
  assert.strictEqual(turnoClinico(rows), "ambos")
})

test("8 · sem sessão clínica com horário legível => null", () => {
  assert.strictEqual(turnoClinico([]), null)
  assert.strictEqual(turnoClinico([linha({ hora_inicial: null })]), null)
})

test("9 · limite exato de 12:00:00 não conta como manhã (fim exclusivo)", () => {
  assert.strictEqual(turnoClinico([linha({ hora_inicial: "12:00:00" })]), null)
})

test("10 · limite exato de 08:00:00 conta como manhã (início inclusivo)", () => {
  assert.strictEqual(turnoClinico([linha({ hora_inicial: "08:00:00" })]), "manhã")
})

test("11 · limite exato de 17:40:00 ainda conta como tarde (fim inclusivo)", () => {
  assert.strictEqual(turnoClinico([linha({ hora_inicial: "17:40:00" })]), "tarde")
})

test("12 · sessão de ambiente natural não conta pro turno clínico", () => {
  const rows = [linha({ hora_inicial: "09:00:00", terapia_nome: "Aplicador ABA Casa" })]
  assert.strictEqual(turnoClinico(rows), null)
})

// ─── temAgendamentoAmbienteNatural ───────────────────────────────────────────

test("13 · alguma sessão Casa/Escola => true", () => {
  assert.strictEqual(
    temAgendamentoAmbienteNatural([linha({ terapia_nome: "Aplicador ABA Escola" })]),
    true,
  )
})

test("14 · só sessão clínica => false", () => {
  assert.strictEqual(temAgendamentoAmbienteNatural([linha({})]), false)
})

test("15 · lista vazia => false", () => {
  assert.strictEqual(temAgendamentoAmbienteNatural([]), false)
})

// ─── quantidadeAplicadores ───────────────────────────────────────────────────

test("16 · conta profissionais DISTINTOS como Aplicador ABA", () => {
  const rows = [
    linha({ profissional_id: 1, terapia_nome: "Aplicador ABA (PS)" }),
    linha({ profissional_id: 1, terapia_nome: "Aplicador ABA (EF)" }), // mesmo profissional, terapia diferente
    linha({ profissional_id: 2, terapia_nome: "Aplicador ABA (SF)" }),
  ]
  assert.strictEqual(quantidadeAplicadores(rows), 2)
})

test("17 · terapia fora do conjunto de siglas de Aplicador ABA não conta", () => {
  const rows = [linha({ profissional_id: 1, terapia_nome: "Fonoaudiologia" })]
  assert.strictEqual(quantidadeAplicadores(rows), 0)
})

test("18 · profissional_id null não entra na contagem", () => {
  const rows = [linha({ profissional_id: null, terapia_nome: "Aplicador ABA (PS)" })]
  assert.strictEqual(quantidadeAplicadores(rows), 0)
})

test("19 · lista vazia => 0", () => {
  assert.strictEqual(quantidadeAplicadores([]), 0)
})

// ─── aplicadoresDetalhados ───────────────────────────────────────────────────

test("29 · agrupa por profissional distinto, juntando os dias sem repetir", () => {
  const rows = [
    linha({
      profissional_id: 1,
      profissional_nome: "Fulana",
      terapia_nome: "Aplicador ABA (PS)",
      dia_semana: "Segunda-feira",
    }),
    linha({
      profissional_id: 1,
      profissional_nome: "Fulana",
      terapia_nome: "Aplicador ABA (PS)",
      dia_semana: "Segunda-feira",
    }),
    linha({
      profissional_id: 1,
      profissional_nome: "Fulana",
      terapia_nome: "Aplicador ABA (EF)",
      dia_semana: "Quarta-feira",
    }),
    linha({
      profissional_id: 2,
      profissional_nome: "Beltrano",
      terapia_nome: "Aplicador ABA (SF)",
      dia_semana: "Sexta-feira",
    }),
  ]
  assert.deepStrictEqual(aplicadoresDetalhados(rows), [
    { profissionalId: 2, nome: "Beltrano", dias: ["Sexta-feira"], siglas: ["SF"] },
    { profissionalId: 1, nome: "Fulana", dias: ["Segunda-feira", "Quarta-feira"], siglas: ["PS", "EF"] },
  ])
})

test("29b · mesmo profissional em duas siglas: array com as duas, na ordem canônica", () => {
  const rows = [
    linha({ profissional_id: 1, profissional_nome: "Fulana", terapia_nome: "Aplicador ABA (AE)" }),
    linha({ profissional_id: 1, profissional_nome: "Fulana", terapia_nome: "Aplicador ABA (PS)" }),
  ]
  assert.deepStrictEqual(aplicadoresDetalhados(rows)[0].siglas, ["PS", "AE"])
})

test("30 · sem profissional_nome cai para 'Profissional {id}'", () => {
  const rows = [linha({ profissional_id: 3, profissional_nome: null, terapia_nome: "Aplicador ABA (AV)" })]
  assert.deepStrictEqual(aplicadoresDetalhados(rows), [
    { profissionalId: 3, nome: "Profissional 3", dias: ["Segunda-feira"], siglas: ["AV"] },
  ])
})

test("31 · ignora terapia fora do conjunto de Aplicador ABA", () => {
  const rows = [linha({ profissional_id: 1, profissional_nome: "Fulana", terapia_nome: "Fonoaudiologia" })]
  assert.deepStrictEqual(aplicadoresDetalhados(rows), [])
})

test("32 · quantidadeAplicadores == aplicadoresDetalhados(...).length", () => {
  const rows = [
    linha({ profissional_id: 1, terapia_nome: "Aplicador ABA (PS)" }),
    linha({ profissional_id: 2, terapia_nome: "Aplicador ABA (SF)" }),
  ]
  assert.strictEqual(quantidadeAplicadores(rows), aplicadoresDetalhados(rows).length)
})

// ─── temAgendamentoFuturo ────────────────────────────────────────────────────

test("26 · alguma linha na janela já buscada => true (o sinal de 'Ativo')", () => {
  assert.strictEqual(temAgendamentoFuturo([linha({})]), true)
})

test("27 · lista vazia (sem linha pro paciente na janela) => false ('Inativo')", () => {
  assert.strictEqual(temAgendamentoFuturo([]), false)
})

test("28 · conta mesmo linha só de ambiente natural (Casa/Escola) — diferente de diasClinicos", () => {
  assert.strictEqual(
    temAgendamentoFuturo([linha({ terapia_nome: "Aplicador ABA Casa" })]),
    true,
  )
})

// ─── coordenadorDoCaso ───────────────────────────────────────────────────────

test("20 · acha o coordenador escalado na primeira semana do mês seguinte", () => {
  const rows = [
    linha({ terapia_nome: "Coordenador de Caso", profissional_id: 9, data: "2026-10-03" }),
  ]
  assert.deepStrictEqual(coordenadorDoCaso(rows, "2026-09-04"), [9])
})

test("21 · ignora Coordenador de Caso fora da primeira semana do mês seguinte", () => {
  const rows = [
    linha({ terapia_nome: "Coordenador de Caso", profissional_id: 9, data: "2026-10-08" }), // fora (>07)
    linha({ terapia_nome: "Coordenador de Caso", profissional_id: 9, data: "2026-09-05" }), // mês corrente, tarde demais
  ]
  assert.deepStrictEqual(coordenadorDoCaso(rows, "2026-09-04"), [])
})

test("22 · ignora linhas que não são Coordenador de Caso", () => {
  const rows = [linha({ terapia_nome: "Aplicador ABA (PS)", data: "2026-10-03" })]
  assert.deepStrictEqual(coordenadorDoCaso(rows, "2026-09-04"), [])
})

test("23 · dois profissionais distintos escalados => nomeação em disputa (length 2)", () => {
  const rows = [
    linha({ terapia_nome: "Coordenador de Caso", profissional_id: 9, data: "2026-10-03" }),
    linha({ terapia_nome: "Coordenador de Caso", profissional_id: 10, data: "2026-10-05" }),
  ]
  assert.strictEqual(coordenadorDoCaso(rows, "2026-09-04").length, 2)
})

test("24 · vira o ano quando hoje é dezembro (mês seguinte = janeiro do ano seguinte)", () => {
  const rows = [
    linha({ terapia_nome: "Coordenador de Caso", profissional_id: 9, data: "2027-01-05" }),
  ]
  assert.deepStrictEqual(coordenadorDoCaso(rows, "2026-12-20"), [9])
})

test("25 · linha sem data legível é ignorada", () => {
  const rows = [linha({ terapia_nome: "Coordenador de Caso", profissional_id: 9, data: null })]
  assert.deepStrictEqual(coordenadorDoCaso(rows, "2026-09-04"), [])
})

// ─── coordenadoresDetalhados ─────────────────────────────────────────────────

test("33 · acha o coordenador com nome, na janela certa", () => {
  const rows = [
    linha({
      terapia_nome: "Coordenador de Caso",
      profissional_id: 9,
      profissional_nome: "Fulana",
      data: "2026-10-03",
    }),
  ]
  assert.deepStrictEqual(coordenadoresDetalhados(rows, "2026-09-04"), [
    { profissionalId: 9, nome: "Fulana" },
  ])
})

test("34 · sem profissional_nome cai para 'Profissional {id}'", () => {
  const rows = [
    linha({
      terapia_nome: "Coordenador de Caso",
      profissional_id: 9,
      profissional_nome: null,
      data: "2026-10-03",
    }),
  ]
  assert.deepStrictEqual(coordenadoresDetalhados(rows, "2026-09-04"), [
    { profissionalId: 9, nome: "Profissional 9" },
  ])
})

test("35 · dois profissionais distintos escalados => os dois, cada um com seu nome", () => {
  const rows = [
    linha({
      terapia_nome: "Coordenador de Caso",
      profissional_id: 9,
      profissional_nome: "Fulana",
      data: "2026-10-03",
    }),
    linha({
      terapia_nome: "Coordenador de Caso",
      profissional_id: 10,
      profissional_nome: "Beltrano",
      data: "2026-10-05",
    }),
  ]
  assert.deepStrictEqual(coordenadoresDetalhados(rows, "2026-09-04"), [
    { profissionalId: 9, nome: "Fulana" },
    { profissionalId: 10, nome: "Beltrano" },
  ])
})

test("36 · ignora Coordenador de Caso fora da primeira semana do mês seguinte", () => {
  const rows = [
    linha({
      terapia_nome: "Coordenador de Caso",
      profissional_id: 9,
      profissional_nome: "Fulana",
      data: "2026-10-08",
    }),
  ]
  assert.deepStrictEqual(coordenadoresDetalhados(rows, "2026-09-04"), [])
})

test("37 · coordenadorDoCaso == coordenadoresDetalhados(...).map(profissionalId)", () => {
  const rows = [
    linha({
      terapia_nome: "Coordenador de Caso",
      profissional_id: 9,
      profissional_nome: "Fulana",
      data: "2026-10-03",
    }),
  ]
  assert.deepStrictEqual(
    coordenadorDoCaso(rows, "2026-09-04"),
    coordenadoresDetalhados(rows, "2026-09-04").map((c) => c.profissionalId),
  )
})

// ─── temAgendamentoPrimeiraSemanaMesSeguinte ─────────────────────────────────

test("38 · qualquer terapia (não só Coordenador de Caso) conta, na janela certa", () => {
  const rows = [linha({ terapia_nome: "Fonoaudiologia", data: "2026-10-03" })]
  assert.strictEqual(temAgendamentoPrimeiraSemanaMesSeguinte(rows, "2026-09-04"), true)
})

test("39 · fora da primeira semana do mês seguinte => false", () => {
  const rows = [linha({ terapia_nome: "Fonoaudiologia", data: "2026-10-08" })]
  assert.strictEqual(temAgendamentoPrimeiraSemanaMesSeguinte(rows, "2026-09-04"), false)
})

test("40 · lista vazia => false", () => {
  assert.strictEqual(temAgendamentoPrimeiraSemanaMesSeguinte([], "2026-09-04"), false)
})

test("41 · linha sem data legível é ignorada", () => {
  const rows = [linha({ terapia_nome: "Fonoaudiologia", data: null })]
  assert.strictEqual(temAgendamentoPrimeiraSemanaMesSeguinte(rows, "2026-09-04"), false)
})

// ─── temTerapiaAbaPrimeiraSemanaMesSeguinte ──────────────────────────────────
//
// O critério de "paciente de ABA" desde 11/09/2026 — ver o bloco laudo ×
// agenda em agenda.ts. Casos 42-49 travam a auditoria que motivou a troca.

test("42 · Aplicador ABA na janela => true", () => {
  const rows = [linha({ terapia_nome: "Aplicador ABA (PS)", data: "2026-10-03" })]
  assert.strictEqual(temTerapiaAbaPrimeiraSemanaMesSeguinte(rows, "2026-09-04"), true)
})

test("43 · agenda só com terapias não-ABA => false (o falso positivo da auditoria)", () => {
  // Os 5 pacientes com "Psicologia ABA" no laudo e nenhuma ABA na agenda.
  const rows = [
    linha({ terapia_nome: "Fonoaudiologia", data: "2026-10-03" }),
    linha({ terapia_nome: "Terapia Ocupacional", data: "2026-10-05" }),
    linha({ terapia_nome: "Psicopedagogia", data: "2026-10-06" }),
  ]
  assert.strictEqual(temTerapiaAbaPrimeiraSemanaMesSeguinte(rows, "2026-09-04"), false)
})

test("44 · Coordenador de Caso sozinho conta como ABA", () => {
  const rows = [linha({ terapia_nome: "Coordenador de Caso", data: "2026-10-05" })]
  assert.strictEqual(temTerapiaAbaPrimeiraSemanaMesSeguinte(rows, "2026-09-04"), true)
})

test("45 · Supervisão ABA sozinha conta como ABA", () => {
  const rows = [linha({ terapia_nome: "Supervisão ABA", data: "2026-10-05" })]
  assert.strictEqual(temTerapiaAbaPrimeiraSemanaMesSeguinte(rows, "2026-09-04"), true)
})

test("46 · ambiente natural (Casa/Escola) conta como ABA", () => {
  const rows = [linha({ terapia_nome: "Aplicador ABA Casa", data: "2026-10-02" })]
  assert.strictEqual(temTerapiaAbaPrimeiraSemanaMesSeguinte(rows, "2026-09-04"), true)
})

test("47 · Aplicador ABA (HS) conta como ABA, apesar de ESP_CLINICO listá-lo sob Habilidades Sociais", () => {
  const rows = [linha({ terapia_nome: "Aplicador ABA (HS)", data: "2026-10-02" })]
  assert.strictEqual(temTerapiaAbaPrimeiraSemanaMesSeguinte(rows, "2026-09-04"), true)
})

test("48 · ABA fora da primeira semana do mês seguinte => false", () => {
  const rows = [linha({ terapia_nome: "Aplicador ABA (PS)", data: "2026-10-08" })]
  assert.strictEqual(temTerapiaAbaPrimeiraSemanaMesSeguinte(rows, "2026-09-04"), false)
})

test("49 · sem agenda nenhuma => false (o paciente sem sessão futura da auditoria)", () => {
  assert.strictEqual(temTerapiaAbaPrimeiraSemanaMesSeguinte([], "2026-09-04"), false)
})

test("50 · TERAPIAS_ABA cobre as 6 siglas, Casa/Escola, Supervisão e Coordenador", () => {
  for (const t of [
    "Aplicador ABA (PS)", "Aplicador ABA (EF)", "Aplicador ABA (SF)",
    "Aplicador ABA (AE)", "Aplicador ABA (AV)", "Aplicador ABA (HS)",
    "Aplicador ABA Casa", "Aplicador ABA Escola",
    "Supervisão ABA", "Coordenador de Caso",
  ]) {
    assert.ok(TERAPIAS_ABA.has(t), `esperava ${t} em TERAPIAS_ABA`)
  }
  // E não pode arrastar terapia não-ABA junto.
  for (const t of ["Fonoaudiologia", "Terapia Ocupacional", "Psicologia", "Musicoterapia"]) {
    assert.ok(!TERAPIAS_ABA.has(t), `não esperava ${t} em TERAPIAS_ABA`)
  }
})

test("51 · placeholders de bloqueio de horário estão barrados", () => {
  assert.ok(PACIENTES_PLACEHOLDER.has(19196)) // "Horário Bloqueado"
  assert.ok(PACIENTES_PLACEHOLDER.has(17795)) // "Notificação Prévia"
})
