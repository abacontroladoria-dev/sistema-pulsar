// Convênio do paciente pela grade da TiTa, com o Plano do Órbita de reserva.
//
//   npx vitest run lib/laudos/convenio.test.ts

import { test } from "vitest"
import assert from "node:assert/strict"
import {
  convenioVigente,
  juntarComConvenio,
  opcoesDeConvenio,
  SEM_CONVENIO,
  unificarConvenios,
  type OrigemConvenio,
} from "./convenio"

const item = (idFavorecido: number | null, plano: string | null) => ({
  idFavorecido,
  convenio: plano,
  convenioOrigem: (plano ? "orbita" : null) as OrigemConvenio | null,
})

test("1 · a grade vence o Órbita quando tem o paciente; sem ele, fica o Órbita", () => {
  const { itens, pelaGrade } = juntarComConvenio(
    [item(10, "LEVE SAUDE"), item(20, "ASSIM Saúde"), item(null, "Particular")],
    [{ pacienteId: 10, convenio: "Particular", dataReferencia: "2026-10-01", futuro: true }],
  )
  assert.deepStrictEqual(
    itens.map((i) => [i.convenio, i.convenioOrigem]),
    [
      ["Particular", "grade"],
      ["ASSIM Saúde", "orbita"],
      ["Particular", "orbita"],
    ],
  )
  assert.strictEqual(pelaGrade, 1)
})

test("1 · casa por ID Favorecido, nunca por posição, e preserva a ordem", () => {
  const { itens } = juntarComConvenio(
    [item(3, null), item(1, null), item(2, null)],
    [
      { pacienteId: 1, convenio: "A", dataReferencia: null, futuro: false },
      { pacienteId: 3, convenio: "C", dataReferencia: null, futuro: true },
    ],
  )
  assert.deepStrictEqual(itens.map((i) => i.convenio), ["C", "A", null])
})

test("2 · opções: mais frequente primeiro, com contagem, e Sem convênio por último", () => {
  const opcoes = opcoesDeConvenio([
    { convenio: "LEVE SAUDE" },
    { convenio: null },
    { convenio: "ASSIM Saúde" },
    { convenio: "ASSIM Saúde" },
    { convenio: "Particular" },
  ])
  assert.deepStrictEqual(opcoes, [
    { id: "ASSIM Saúde", nome: "ASSIM Saúde (2)" },
    { id: "LEVE SAUDE", nome: "LEVE SAUDE (1)" },
    { id: "Particular", nome: "Particular (1)" },
    { id: SEM_CONVENIO, nome: "Sem convênio (1)" },
  ])
})

test("2 · sem laudo sem convênio, a opção Sem convênio não existe", () => {
  assert.ok(opcoesDeConvenio([{ convenio: "ASSIM Saúde" }]).every((o) => o.id !== SEM_CONVENIO))
})

test("3 · MEMORIAL (incorporada pela ASSIM) vira ASSIM Saúde, com qualquer grafia", () => {
  assert.strictEqual(convenioVigente("MEMORIAL SAÚDE LTDA"), "ASSIM Saúde")
  assert.strictEqual(convenioVigente("memorial saude  ltda"), "ASSIM Saúde")
  assert.strictEqual(convenioVigente("LEVE SAUDE"), "LEVE SAUDE")
})

test("3 · unificar guarda o nome de origem só quando houve incorporação", () => {
  const itens = unificarConvenios([
    { convenio: "MEMORIAL SAÚDE LTDA", convenioOriginal: null },
    { convenio: "Particular", convenioOriginal: null },
    { convenio: null, convenioOriginal: null },
  ])
  assert.deepStrictEqual(itens, [
    { convenio: "ASSIM Saúde", convenioOriginal: "MEMORIAL SAÚDE LTDA" },
    { convenio: "Particular", convenioOriginal: null },
    { convenio: null, convenioOriginal: null },
  ])
})

test("3 · depois de unificar, a MEMORIAL soma na contagem da ASSIM no filtro", () => {
  const opcoes = opcoesDeConvenio(
    unificarConvenios([
      { convenio: "ASSIM Saúde", convenioOriginal: null },
      { convenio: "MEMORIAL SAÚDE LTDA", convenioOriginal: null },
    ]),
  )
  assert.deepStrictEqual(opcoes, [{ id: "ASSIM Saúde", nome: "ASSIM Saúde (2)" }])
})

