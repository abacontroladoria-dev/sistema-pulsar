// "PDI - Painel por Analista" — espelha o estilo de lib/pdi/agenda.test.ts
// (vitest + node:assert/strict).
//
//   npx vitest run lib/pdi/painelAnalista.test.ts

import { test } from "vitest"
import assert from "node:assert/strict"
import { agruparPorAnalista, calcularResumoExecutivo, calcularSemaforo, filtrarAtivosComAutorizacaoAba } from "./painelAnalista"
import type { ItemPdi } from "./filtros"

/** Um `ItemPdi` mínimo, só com os campos que este módulo lê — o resto é irrelevante aqui. */
function item(over: Partial<ItemPdi> & { status: ItemPdi["status"] }): ItemPdi {
  return {
    pacienteId: 1,
    idFavorecido: 1,
    nome: "Paciente",
    fotoPath: null,
    ativo: true,
    semCadastroPulsar: false,
    especialistaTitaId: null,
    dataAvaliacao: null,
    dataValidade: null,
    observacoes: null,
    prazoRelatorio: null,
    dataImplementacaoPic: null,
    prazoFechamento: null,
    prioridade: "Neutra",
    diasRestantes: null,
    coordenadorIds: [],
    coordenadores: [],
    autorizadoAmbienteNatural: false,
    elegivel: true,
    temAgendamentoPrimeiraSemanaMesSeguinte: true,
    temAbaNaAgenda: true,
    cadastroDuplicadoTita: false,
    diasClinicos: [],
    turnoClinico: null,
    temAgendamentoAmbienteNatural: false,
    aplicadores: [],
    quantidadeAplicadores: 0,
    ativoNaGrade: true,
    ...over,
  }
}

// ─── agruparPorAnalista ──────────────────────────────────────────────────────

test("1 · agrupa pacientes distintos do mesmo analista, somando por status", () => {
  const itens = [
    item({
      pacienteId: 1,
      status: "Atrasado",
      coordenadores: [{ profissionalId: 9, nome: "Fulana" }],
    }),
    item({
      pacienteId: 2,
      status: "Dentro do prazo",
      coordenadores: [{ profissionalId: 9, nome: "Fulana" }],
    }),
  ]
  assert.deepStrictEqual(agruparPorAnalista(itens), [
    {
      profissionalId: 9,
      nome: "Fulana",
      atrasados: 1,
      proximoPrazo: 0,
      emAndamento: 1,
      aguardandoImplementacao: 0,
      total: 2,
    },
  ])
})

test("2 · paciente com 2 coordenadores conta nos dois (irregular) — sem escolher um principal", () => {
  const itens = [
    item({
      pacienteId: 1,
      status: "Atrasado",
      coordenadores: [
        { profissionalId: 9, nome: "Fulana" },
        { profissionalId: 10, nome: "Beltrano" },
      ],
    }),
  ]
  const resultado = agruparPorAnalista(itens)
  assert.strictEqual(resultado.length, 2)
  assert.strictEqual(resultado.find((r) => r.profissionalId === 9)?.atrasados, 1)
  assert.strictEqual(resultado.find((r) => r.profissionalId === 10)?.atrasados, 1)
})

test("3 · paciente sem coordenador não aparece em nenhuma linha", () => {
  const itens = [item({ pacienteId: 1, status: "Atrasado", coordenadores: [] })]
  assert.deepStrictEqual(agruparPorAnalista(itens), [])
})

test("4 · ordena por atrasados desc, desempate por nome", () => {
  const itens = [
    item({ pacienteId: 1, status: "Dentro do prazo", coordenadores: [{ profissionalId: 1, nome: "Zulmira" }] }),
    item({ pacienteId: 2, status: "Atrasado", coordenadores: [{ profissionalId: 2, nome: "Beltrano" }] }),
    item({ pacienteId: 3, status: "Atrasado", coordenadores: [{ profissionalId: 3, nome: "Alberto" }] }),
  ]
  const resultado = agruparPorAnalista(itens)
  assert.deepStrictEqual(
    resultado.map((r) => r.nome),
    ["Alberto", "Beltrano", "Zulmira"],
  )
})

test("5 · os quatro status contam nas colunas certas", () => {
  const coord = { profissionalId: 1, nome: "Fulana" }
  const itens = [
    item({ pacienteId: 1, status: "Atrasado", coordenadores: [coord] }),
    item({ pacienteId: 2, status: "Próximo do prazo", coordenadores: [coord] }),
    item({ pacienteId: 3, status: "Dentro do prazo", coordenadores: [coord] }),
    item({ pacienteId: 4, status: "Aguardando Implementação", coordenadores: [coord] }),
  ]
  assert.deepStrictEqual(agruparPorAnalista(itens), [
    {
      profissionalId: 1,
      nome: "Fulana",
      atrasados: 1,
      proximoPrazo: 1,
      emAndamento: 1,
      aguardandoImplementacao: 1,
      total: 4,
    },
  ])
})

// ─── calcularResumoExecutivo ─────────────────────────────────────────────────

test("6 · conta cada paciente uma única vez, mesmo com múltiplos coordenadores", () => {
  const itens = [
    item({
      pacienteId: 1,
      status: "Atrasado",
      coordenadores: [
        { profissionalId: 9, nome: "Fulana" },
        { profissionalId: 10, nome: "Beltrano" },
      ],
    }),
    item({ pacienteId: 2, status: "Dentro do prazo", coordenadores: [] }),
  ]
  assert.deepStrictEqual(calcularResumoExecutivo(itens), {
    totalPacientes: 2,
    atrasados: 1,
    proximoPrazo: 0,
    emAndamento: 1,
    aguardandoImplementacao: 0,
  })
})

test("7 · lista vazia => tudo zero", () => {
  assert.deepStrictEqual(calcularResumoExecutivo([]), {
    totalPacientes: 0,
    atrasados: 0,
    proximoPrazo: 0,
    emAndamento: 0,
    aguardandoImplementacao: 0,
  })
})

// ─── calcularSemaforo ────────────────────────────────────────────────────────

test("8 · 0 atrasados => verde", () => {
  assert.strictEqual(calcularSemaforo(0), "verde")
})

test("9 · 1 atrasado => amarelo", () => {
  assert.strictEqual(calcularSemaforo(1), "amarelo")
})

test("10 · limite exato de 5 atrasados => ainda amarelo", () => {
  assert.strictEqual(calcularSemaforo(5), "amarelo")
})

test("11 · 6 atrasados => vermelho (o limite de 5 vira vermelho ao passar)", () => {
  assert.strictEqual(calcularSemaforo(6), "vermelho")
})

test("12 · bem mais que 5 => vermelho", () => {
  assert.strictEqual(calcularSemaforo(42), "vermelho")
})

// ─── filtrarAtivosComAutorizacaoAba ──────────────────────────────────────────

// Desde 11/09/2026 a população é definida pela AGENDA (`temAbaNaAgenda`), não
// pelo laudo (`elegivel`) — ver o comentário de `filtrarAtivosComAutorizacaoAba`.
// Os quatro casos abaixo travam as duas regressões relatadas na auditoria.

test("13 · tem ABA na agenda => entra", () => {
  const itens = [item({ status: "Atrasado", temAbaNaAgenda: true })]
  assert.strictEqual(filtrarAtivosComAutorizacaoAba(itens).length, 1)
})

test("14 · laudo diz ABA mas NÃO há ABA na agenda => fora (falso positivo de 'Sem Coordenador')", () => {
  // O caso dos 5 pacientes da auditoria de 11/09/2026: "Psicologia ABA" no
  // relatório Órbita, agenda só com Fono/TO/Psicopedagogia. Entravam no painel
  // e, sem Coordenador de Caso na grade, apareciam como "Sem Coordenador".
  const itens = [item({ status: "Atrasado", elegivel: true, temAbaNaAgenda: false })]
  assert.strictEqual(filtrarAtivosComAutorizacaoAba(itens).length, 0)
})

test("15 · ABA na agenda mesmo SEM laudo 'Psicologia ABA' => entra (paciente que sumia do coordenador)", () => {
  // O caso dos 7 pacientes da auditoria: atendimento ABA real na agenda, com
  // Coordenador de Caso, mas o laudo dizia "Aplicador ABA" / "Coordenador de
  // Caso" / nada. Ficavam fora do painel e o coordenador perdia paciente.
  const itens = [item({ status: "Atrasado", elegivel: false, temAbaNaAgenda: true })]
  assert.strictEqual(filtrarAtivosComAutorizacaoAba(itens).length, 1)
})

test("16 · sem ABA na agenda => fora, mesmo marcado como ativo", () => {
  const itens = [
    item({ status: "Atrasado", temAbaNaAgenda: false, temAgendamentoPrimeiraSemanaMesSeguinte: true }),
  ]
  assert.strictEqual(filtrarAtivosComAutorizacaoAba(itens).length, 0)
})
