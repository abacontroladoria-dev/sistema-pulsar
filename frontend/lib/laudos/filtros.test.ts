// Filtro, ordenação e KPIs da tela Acompanhamento de Laudos.
//
// O caso 1 é o mais importante do arquivo: o número do card de KPI e o tamanho
// da lista filtrada TÊM que ser o mesmo, porque o card É o filtro. Já houve no
// projeto um número de tela que não batia com o recorte por trás (a barra de
// unidade, "N vagas" × projeção financeira); ali era por desenho, aqui seria
// defeito.
//
//   npx vitest run lib/laudos/filtros.test.ts

import { test } from "vitest"
import assert from "node:assert/strict"
import {
  PREDICADO_RECORTE,
  TODAS_SITUACOES_PACIENTE,
  aplicar,
  contarKpisSenha,
  avisoEhPrematuro,
  contarKpis,
  filtrar,
  filtrosAlterados,
  filtrosIniciais,
  ordenar,
  proximaValidadeDeSenha,
  type FiltrosLaudos,
  type RecorteLaudo,
} from "./filtros"
import { calcularSenhasDoLaudo } from "./senhas"
import type { ItemAcompanhamentoLaudo, SituacaoPaciente } from "@/types/laudosAcompanhamento"

/**
 * O "hoje" usado por todo o arquivo — o mesmo valor que `meta.hoje` traria do
 * servidor num dia qualquer. Fixo, e não `new Date()`: é o que mantém os testes
 * determinísticos (a mesma sondagem de 28/08/2026 usada no resto do projeto).
 */
const HOJE = "2026-08-28"

function item(over: Partial<ItemAcompanhamentoLaudo> = {}): ItemAcompanhamentoLaudo {
  return {
    idLaudo: "477",
    idFavorecido: 11511,
    nome: "Adrian Araújo Nery",
    dataLaudo: "2026-07-01",
    validade: "2027-01-01",
    autorizadoEm: "2026-07-08",
    situacao: "vigente",
    situacaoOrbita: "Vigente",
    situacaoDivergente: false,
    especialidades: ["Arteterapia"],
    especialidadesQtd: [{ especialidade: "Arteterapia", qtdLaudo: "2", qtdAutorizada: "2" }],
    plano: "ASSIM Saúde",
    convenio: "ASSIM Saúde",
    convenioOrigem: "grade",
    convenioOriginal: null,
    pacienteId: 11511,
    pacienteNomeCadastro: "Adrian Araújo Nery",
    situacaoPaciente: "ativo",
    fotoPath: null,
    mensagemEnviadaEm: null,
    observacao: null,
    registradoPorNome: null,
    registradoEm: null,
    senhas: null,
    ...over,
  }
}

/** Uma amostra com os quatro estados que a tela distingue. */
function amostra(): ItemAcompanhamentoLaudo[] {
  return [
    item({ idLaudo: "1", situacao: "vencido", validade: "2026-01-01" }),
    item({ idLaudo: "2", situacao: "vencido", validade: "2026-02-01", mensagemEnviadaEm: "2026-08-20" }),
    item({ idLaudo: "3", situacao: "vigente", validade: "2027-01-01" }),
    item({ idLaudo: "4", situacao: "vigente", validade: "2027-06-01", mensagemEnviadaEm: "2026-08-25" }),
  ]
}

const TODOS_RECORTES: RecorteLaudo[] = [
  "todos",
  "vigentes",
  "vencidos",
  "vencidos_sem_aviso",
  "proximo_vencimento",
  "avisados_vigentes",
  "avisados_vencidos",
]

// ─── 1. Card e lista contam a mesma coisa ───────────────────────────────────

test("1 · o número do card é EXATAMENTE o tamanho da lista daquele recorte", () => {
  const itens = amostra()
  // `filtrosIniciais()` aqui não é "o recorte default" — é só o veículo dos
  // filtros SECUNDÁRIOS (busca, situação, janelas) que contarKpis aplica antes
  // de contar. O `.recorte` dele é ignorado por contarKpis; cada card conta
  // pelo seu próprio predicado, nunca pelo que está selecionado.
  const kpis = contarKpis(itens, filtrosIniciais(), HOJE)

  for (const recorte of TODOS_RECORTES) {
    const f: FiltrosLaudos = { ...filtrosIniciais(), recorte }
    assert.strictEqual(
      filtrar(itens, f, HOJE).length,
      kpis[recorte],
      `card e lista divergem em "${recorte}"`,
    )
  }
})

test("2 · os recortes, nos números", () => {
  // As duas validades vigentes da amostra (2027) estão muito longe de
  // "próximo do vencimento" relativo a HOJE — daí o 0. E os dois "avisados"
  // somados (1+1) batem com o total de itens com mensagemEnviadaEm (2) — a
  // divisão por validade não perde nem duplica ninguém. "vencidos" (2) é a
  // SOMA de vencidos_sem_aviso (1) + avisados_vencidos (1) — visão geral e
  // subconjunto acionável, não números concorrentes.
  const k = contarKpis(amostra(), filtrosIniciais(), HOJE)
  assert.deepStrictEqual(k, {
    todos: 4,
    vigentes: 2,
    vencidos: 2,
    vencidos_sem_aviso: 1,
    proximo_vencimento: 0,
    avisados_vigentes: 1,
    avisados_vencidos: 1,
  })
})

test("3 · vencidos_sem_aviso é vencido E sem data — não a soma dos dois", () => {
  // Um vigente sem aviso não é pendência: não há o que cobrar. Um vencido já
  // avisado saiu da fila. O recorte é a interseção, e é a fila de trabalho.
  const itens = amostra()
  const fila = itens.filter((i) => PREDICADO_RECORTE.vencidos_sem_aviso(i, HOJE))
  assert.deepStrictEqual(fila.map((i) => i.idLaudo), ["1"])
})

// ─── 2. O estado inicial ────────────────────────────────────────────────────

test("4 · a tela abre em TODOS, ASSIM Saúde, só Ativo, ordenada por validade mais antiga", () => {
  // Pedido do usuário (28/09/2026): "que sempre venha filtrado por paciente
  // ativo, convênio ASSIM Saúde" e o laudo em Todos. Substituiu a abertura em
  // "Vencidos sem aviso" — com o painel da senha ao lado, um recorte de laudo
  // de saída escondia metade do quadro de senhas.
  const f = filtrosIniciais()
  assert.strictEqual(f.recorte, "todos")
  assert.strictEqual(f.recorteSenha, "todos")
  assert.deepStrictEqual([...f.convenios], ["ASSIM Saúde"])
  assert.strictEqual(f.ordem, "validade")
  // E só ATIVO no paciente — pedido do usuário (28/09/2026), que substituiu o
  // "as quatro marcadas" de 28/08. Inativo, sem cadastro e fictício ficam a um
  // clique no filtro Paciente.
  assert.deepStrictEqual([...f.situacoesPaciente], ["ativo"])
})

// ─── 3. Busca ───────────────────────────────────────────────────────────────

test("5 · busca casa nome sem acento e sem caixa", () => {
  const itens = [item({ nome: "Adrian Araújo Nery" })]
  for (const termo of ["araujo", "ARAÚJO", "  Araujo  ", "nery"]) {
    assert.strictEqual(filtrar(itens, { ...filtrosIniciais(), recorte: "todos", busca: termo }, HOJE).length, 1, termo)
  }
})

test("6 · busca casa pelos DOIS ids, por pedaço", () => {
  // A recepção tem em mão o id do paciente ou o do laudo, dependendo de onde
  // veio a pendência. E digitar "115" precisa achar 11511 — igualdade exata
  // obrigaria a digitar o número inteiro sem errar.
  const itens = [item({ idLaudo: "477", idFavorecido: 11511 })]
  const f = (busca: string) => filtrar(itens, { ...filtrosIniciais(), recorte: "todos", busca }, HOJE)
  assert.strictEqual(f("115").length, 1)
  assert.strictEqual(f("11511").length, 1)
  assert.strictEqual(f("477").length, 1)
  assert.strictEqual(f("999").length, 0)
})

// ─── 4. Situação do paciente ────────────────────────────────────────────────

test("7 · situações de paciente são COMPLEMENTARES: marcar mais soma", () => {
  const itens = [
    item({ idLaudo: "1", situacaoPaciente: "ativo" }),
    item({ idLaudo: "2", situacaoPaciente: "inativo" }),
    item({ idLaudo: "3", situacaoPaciente: "sem_cadastro" }),
    item({ idLaudo: "4", situacaoPaciente: "ficticio" }),
  ]
  const com = (...s: SituacaoPaciente[]) =>
    filtrar(itens, { ...filtrosIniciais(), recorte: "todos", situacoesPaciente: new Set(s) }, HOJE).length

  assert.strictEqual(com("ativo"), 1)
  assert.strictEqual(com("ativo", "inativo"), 2)
  assert.strictEqual(com("ativo", "inativo", "sem_cadastro"), 3)
  assert.strictEqual(com(...TODAS_SITUACOES_PACIENTE), 4)
  // Fictício é isolável: dá para ver SÓ o laudo de teste.
  assert.strictEqual(com("ficticio"), 1)
})

test("8 · nenhuma situação marcada devolve nada — não tudo", () => {
  // O resultado honesto de "não quero nenhuma" é lista vazia. Devolver a lista
  // inteira faria o filtro parecer quebrado justamente quando foi obedecido.
  const itens = amostra()
  const f: FiltrosLaudos = {
    ...filtrosIniciais(),
    recorte: "todos",
    situacoesPaciente: new Set(),
  }
  assert.strictEqual(filtrar(itens, f, HOJE).length, 0)
})

// ─── 5. Janelas de data ─────────────────────────────────────────────────────

test("9 · janela de validade é inclusiva nas duas pontas", () => {
  const itens = [
    item({ idLaudo: "1", validade: "2026-01-01" }),
    item({ idLaudo: "2", validade: "2026-06-15" }),
    item({ idLaudo: "3", validade: "2026-12-31" }),
  ]
  const f: FiltrosLaudos = {
    ...filtrosIniciais(),
    recorte: "todos",
    validadeDe: "2026-01-01",
    validadeAte: "2026-06-15",
  }
  assert.deepStrictEqual(filtrar(itens, f, HOJE).map((i) => i.idLaudo), ["1", "2"])
})

test("10 · sem data NUNCA entra numa janela: ausência não é intervalo", () => {
  // O contrário deixaria um laudo sem validade aparecer num recorte "validade
  // entre X e Y" — dado ausente virando dado presente por acidente do filtro.
  const itens = [item({ validade: null })]
  const f: FiltrosLaudos = { ...filtrosIniciais(), recorte: "todos", validadeDe: "2026-01-01" }
  assert.strictEqual(filtrar(itens, f, HOJE).length, 0)
  // Janela vazia, por outro lado, não filtra nada.
  assert.strictEqual(filtrar(itens, { ...filtrosIniciais(), recorte: "todos" }, HOJE).length, 1)
})

// ─── 6. Ordenação ───────────────────────────────────────────────────────────

test("11 · validade crescente: o mais vencido primeiro", () => {
  const itens = [
    item({ idLaudo: "novo", validade: "2027-01-01" }),
    item({ idLaudo: "velho", validade: "2025-01-01" }),
  ]
  assert.deepStrictEqual(ordenar(itens, "validade").map((i) => i.idLaudo), ["velho", "novo"])
})

test("12 · null vai para o FIM: 'sem data' não é 'muito antigo'", () => {
  const itens = [
    item({ idLaudo: "sem", validade: null }),
    item({ idLaudo: "com", validade: "2025-01-01" }),
  ]
  assert.deepStrictEqual(ordenar(itens, "validade").map((i) => i.idLaudo), ["com", "sem"])
})

test("13 · empate desempata por nome, para a paginação não embaralhar", () => {
  // 343 laudos com muitas validades repetidas: sem desempate, dois renders
  // podem produzir ordens diferentes e um item pular de página.
  const itens = [
    item({ idLaudo: "1", nome: "Zulmira", validade: "2026-01-01" }),
    item({ idLaudo: "2", nome: "Ana", validade: "2026-01-01" }),
    item({ idLaudo: "3", nome: "Marcos", validade: "2026-01-01" }),
  ]
  const uma = ordenar(itens, "validade").map((i) => i.nome)
  const outra = ordenar([...itens].reverse(), "validade").map((i) => i.nome)
  assert.deepStrictEqual(uma, ["Ana", "Marcos", "Zulmira"])
  assert.deepStrictEqual(uma, outra)
})

test("14 · ordenar não muta o array de entrada (é estado do React)", () => {
  const itens = amostra()
  const antes = itens.map((i) => i.idLaudo)
  ordenar(itens, "nome")
  assert.deepStrictEqual(itens.map((i) => i.idLaudo), antes)
})

// ─── 7. O botão "Limpar filtros" ────────────────────────────────────────────

test("16 · recém-aberta, não há nada a limpar", () => {
  // Se isto falhar, o botão nasce aceso e clicar nele não muda nada — controle
  // morto, que o usuário aprende a ignorar.
  assert.strictEqual(filtrosAlterados(filtrosIniciais()), false)
})

test("17 · qualquer filtro mexido acende o botão", () => {
  const casos: Array<[string, Partial<FiltrosLaudos>]> = [
    ["recorte", { recorte: "vencidos" }],
    ["convenios", { convenios: new Set<string>() }],
    ["ordem", { ordem: "nome" }],
    ["busca", { busca: "ana" }],
    ["validadeDe", { validadeDe: "2026-01-01" }],
    ["validadeSenhaDe", { validadeSenhaDe: "2026-01-01" }],
    ["validadeAte", { validadeAte: "2026-01-01" }],
    ["situacoesPaciente", { situacoesPaciente: new Set<SituacaoPaciente>(["ativo", "inativo"]) }],
    ["recorteSenha", { recorteSenha: "vencida" }],
    ["ordem validade_senha", { ordem: "validade_senha" }],
  ]
  for (const [nome, over] of casos) {
    assert.strictEqual(
      filtrosAlterados({ ...filtrosIniciais(), ...over }),
      true,
      `mexer em ${nome} deveria acender o botão`,
    )
  }
})

test("18 · troca de situação com a MESMA contagem também acende", () => {
  // Comparar só `size` deixaria passar isto: 1 situação → 1 situação, trocada
  // ("Ativo" por "Inativo"). O resultado na tela é outro, então o botão acende.
  const f = filtrosIniciais()
  assert.strictEqual(
    filtrosAlterados({ ...f, situacoesPaciente: new Set<SituacaoPaciente>(["ativo"]) }),
    false,
    "o mesmo conteúdo num Set novo continua limpo",
  )
  assert.strictEqual(
    filtrosAlterados({ ...f, situacoesPaciente: new Set<SituacaoPaciente>(["inativo"]) }),
    true,
  )
  assert.strictEqual(filtrosAlterados({ ...f, situacoesPaciente: new Set<SituacaoPaciente>() }), true)
})

test("19 · busca só de espaços não conta como filtro", () => {
  assert.strictEqual(filtrosAlterados({ ...filtrosIniciais(), busca: "   " }), false)
})

test("20 · limpar devolve exatamente o estado inicial", () => {
  // O botão faz `setFiltros(filtrosIniciais())`. Este teste garante que o
  // "limpo" do botão e o "limpo" da abertura são o mesmo estado — e que o Set
  // vem novo, não compartilhado (mutá-lo depois não pode sujar o outro).
  const a = filtrosIniciais()
  const b = filtrosIniciais()
  a.situacoesPaciente.delete("ativo")
  assert.strictEqual(b.situacoesPaciente.has("ativo"), true)
  assert.strictEqual(filtrosAlterados(b), false)
})

test("21 · aplicar = filtrar e DEPOIS ordenar", () => {
  const itens = amostra()
  const saida = aplicar(itens, { ...filtrosIniciais(), recorte: "vencidos_sem_aviso" }, HOJE)
  // Vencidos sem aviso: só o item 1 — o 2 já foi avisado.
  assert.deepStrictEqual(saida.map((i) => i.idLaudo), ["1"])
})

// ─── 8. "Vigente próximo ao vencimento" ─────────────────────────────────────
//
// Pedido do usuário (28/08/2026): um card para o laudo que ainda está vigente,
// mas cuja Validade cai em 15 dias corridos ou menos — o aviso ANTES de o laudo
// virar pendência, não depois.

const proximo = (validade: string | null, situacao: ItemAcompanhamentoLaudo["situacao"] = "vigente") =>
  PREDICADO_RECORTE.proximo_vencimento(item({ validade, situacao }), HOJE)

test("22 · exatamente no limite (15 dias) ainda entra", () => {
  assert.strictEqual(proximo("2026-09-12"), true) // HOJE + 15
  assert.strictEqual(proximo("2026-09-13"), false) // HOJE + 16
})

test("23 · vence HOJE conta como próximo do vencimento", () => {
  assert.strictEqual(proximo(HOJE), true)
})

test("24 · já vencido NÃO entra aqui — mesmo com validade recente", () => {
  // Um laudo vencido ontem tem "-1 dia até a validade", que também seria <= 15
  // se o recorte não exigisse `vigente`. Sem essa exigência, o mesmo laudo
  // apareceria nos dois cards (Vencidos e Vence em breve) — números somando
  // mais laudos do que existem.
  assert.strictEqual(proximo("2026-08-27", "vencido"), false)
})

test("25 · sem validade não é 'próximo de nada'", () => {
  assert.strictEqual(proximo(null), false)
})

test("26 · vigente e longe da validade não entra", () => {
  assert.strictEqual(proximo("2027-01-01"), false)
})

test("27 · card e lista batem também para este recorte, num caso concreto", () => {
  const itens = [
    item({ idLaudo: "a", situacao: "vigente", validade: "2026-09-12" }), // +15, entra
    item({ idLaudo: "b", situacao: "vigente", validade: "2026-09-13" }), // +16, fora
    item({ idLaudo: "c", situacao: "vencido", validade: "2026-08-20" }), // vencido, fora
    item({ idLaudo: "d", situacao: "vigente", validade: null }), // sem validade, fora
  ]
  const f: FiltrosLaudos = { ...filtrosIniciais(), recorte: "proximo_vencimento" }
  assert.deepStrictEqual(filtrar(itens, f, HOJE).map((i) => i.idLaudo), ["a"])
  assert.strictEqual(contarKpis(itens, filtrosIniciais(), HOJE).proximo_vencimento, 1)
})

test("28 · AVISADO some daqui, mesmo vigente e por pouco — só conta em avisados_vigentes", () => {
  // Decisão do usuário (28/08/2026): um laudo avisado não é mais "precisa agir
  // logo", é "aguardando o responsável". Sem esta exclusão, a mesma linha
  // apareceria nos dois cards ao mesmo tempo — números somando mais laudos do
  // que existem, o mesmo defeito que a exigência de `vigente` já evita entre
  // este recorte e `vencidos_sem_aviso`/`avisados_vencidos`.
  const semAviso = item({ situacao: "vigente", validade: "2026-09-05", mensagemEnviadaEm: null })
  const comAviso = item({
    situacao: "vigente",
    validade: "2026-09-05",
    mensagemEnviadaEm: "2026-08-20",
  })
  assert.strictEqual(PREDICADO_RECORTE.proximo_vencimento(semAviso, HOJE), true)
  assert.strictEqual(PREDICADO_RECORTE.proximo_vencimento(comAviso, HOJE), false)
  assert.strictEqual(PREDICADO_RECORTE.avisados_vigentes(comAviso, HOJE), true)

  const itens = [semAviso, comAviso]
  const k = contarKpis(itens, filtrosIniciais(), HOJE)
  assert.strictEqual(k.proximo_vencimento, 1)
  assert.strictEqual(k.avisados_vigentes, 1)
})

// ─── 9. Aviso prematuro (regra de 30 dias no salvar) ────────────────────────
//
// Pedido do usuário (28/08/2026): registrar "avisado" com o laudo ainda muito
// longe de vencer é cedo demais — o modal de registro confirma antes de
// salvar, mas NÃO bloqueia (a recepção pode ter um motivo que a tela não vê).

test("29 · no limite (30 dias) ainda NÃO é prematuro; 31 já é", () => {
  assert.strictEqual(avisoEhPrematuro("2026-09-27", HOJE), false) // HOJE + 30
  assert.strictEqual(avisoEhPrematuro("2026-09-28", HOJE), true) // HOJE + 31
})

test("30 · sem validade nunca é prematuro — não há prazo a antecipar", () => {
  assert.strictEqual(avisoEhPrematuro(null, HOJE), false)
})

test("31 · laudo já vencido não é prematuro (dias negativos)", () => {
  assert.strictEqual(avisoEhPrematuro("2026-01-01", HOJE), false)
})

test("32 · dentro da janela de 15 dias claramente não é prematuro", () => {
  assert.strictEqual(avisoEhPrematuro("2026-09-05", HOJE), false)
})

// ─── 10. O painel responde aos filtros secundários ──────────────────────────
//
// Pedido do usuário (28/08/2026): "eu tenho 4 Vence em breve, mas nenhum
// dentro do período de Avisado em que eu escolhi — o painel precisa responder
// a isso." Os NÚMEROS dos cards têm que refletir busca/situação/janelas de
// data, e ao mesmo tempo NUNCA refletir o recorte que está selecionado —
// senão selecionar qualquer card zeraria todos os outros.

test("33 · janela de VALIDADE também recalcula os cards", () => {
  // Mesmo princípio do caso relatado quando a janela era "Avisado em" (removida
  // a pedido do usuário, 28/08/2026 — "mantenha somente Validade"): o card
  // mostra os 3 em repouso, e encolhe assim que a janela de validade restringe
  // a lista de base ANTES de contar.
  const itens = [
    item({ idLaudo: "a", situacao: "vigente", validade: "2026-09-05" }),
    item({ idLaudo: "b", situacao: "vigente", validade: "2026-09-10" }),
    item({ idLaudo: "c", situacao: "vigente", validade: "2026-09-12" }),
  ]

  const semFiltro = contarKpis(itens, filtrosIniciais(), HOJE)
  assert.strictEqual(semFiltro.proximo_vencimento, 3)

  const comJanela = contarKpis(itens, { ...filtrosIniciais(), validadeDe: "2026-09-11" }, HOJE)
  assert.strictEqual(comJanela.proximo_vencimento, 1) // só "c" cai dentro da janela
})

test("34 · busca e situação do paciente também recalculam os cards", () => {
  const itens = [
    item({ idLaudo: "a", nome: "Ana Souza", situacaoPaciente: "ativo", situacao: "vencido" }),
    item({ idLaudo: "b", nome: "Beto Alves", situacaoPaciente: "inativo", situacao: "vencido" }),
  ]

  const todas = { ...filtrosIniciais(), situacoesPaciente: new Set(TODAS_SITUACOES_PACIENTE) }
  assert.strictEqual(contarKpis(itens, todas, HOJE).vencidos, 2)

  // O padrão (só Ativo) já recorta os cards.
  assert.strictEqual(contarKpis(itens, filtrosIniciais(), HOJE).vencidos, 1)

  const busca = contarKpis(itens, { ...todas, busca: "beto" }, HOJE)
  assert.strictEqual(busca.vencidos, 1)
})

test("35 · o recorte selecionado NUNCA muda os números dos OUTROS cards", () => {
  // A garantia inversa do teste 32: mudar `f.recorte` sozinho (sem tocar em
  // busca/situação/janelas) não pode fazer os cards não-selecionados
  // despencarem para 0 — senão a barra de KPI perde a única razão de ser
  // clicável (trocar de recorte olhando os números de TODOS os cards).
  const k1 = contarKpis(amostra(), { ...filtrosIniciais(), recorte: "vencidos" }, HOJE)
  const k2 = contarKpis(amostra(), { ...filtrosIniciais(), recorte: "vigentes" }, HOJE)
  const k3 = contarKpis(amostra(), { ...filtrosIniciais(), recorte: "todos" }, HOJE)
  assert.deepStrictEqual(k1, k2)
  assert.deepStrictEqual(k1, k3)
})

// ─── Senhas ASSIM ───────────────────────────────────────────────────────────

/** Senha com uma validade dentro do ROL (e, opcionalmente, fora). */
function comSenha(validadeDentro: string | null, validadeFora: string | null = null) {
  return calcularSenhasDoLaudo(
    [
      {
        idAutorizacao: "1",
        idLaudo: "477",
        idFavorecido: 11511,
        plano: "ASSIM Saúde",
        dataLista: null,
        situacaoDentro: "AUTORIZADO",
        senhaDentro: "1234567",
        liberacaoDentro: null,
        validadeDentro,
        situacaoFora: validadeFora ? "AUTORIZADO" : "",
        senhaFora: validadeFora ? "7654321" : "",
        liberacaoFora: null,
        validadeFora,
        criadoEmOrigem: null,
        atualizadoEmOrigem: null,
        arquivoAutorizacao: "",
        cronogramaConvenio: "",
        observacoes: "",
        especialidades: [],
      },
    ],
    "ASSIM Saúde",
    HOJE,
  )
}

test("36 · recorte de senha corta pelo pior status; vigente inclui vence em breve", () => {
  const itens = [
    item({ idLaudo: "v", senhas: comSenha("2027-01-01") }),
    item({ idLaudo: "b", senhas: comSenha("2026-09-01") }), // 4 dias depois de HOJE
    item({ idLaudo: "x", senhas: comSenha("2026-01-01") }),
    item({ idLaudo: "s", senhas: calcularSenhasDoLaudo([], "ASSIM Saúde", HOJE) }),
    item({ idLaudo: "o", senhas: calcularSenhasDoLaudo([], "LEVE SAUDE", HOJE) }),
  ]
  const f = { ...filtrosIniciais(), recorte: "todos" as const }
  const ids = (r: FiltrosLaudos["recorteSenha"]) =>
    filtrar(itens, { ...f, recorteSenha: r }, HOJE).map((i) => i.idLaudo)

  assert.deepStrictEqual(ids("todos"), ["v", "b", "x", "s", "o"])
  assert.deepStrictEqual(ids("vigente"), ["v", "b"])
  assert.deepStrictEqual(ids("vence_em_breve"), ["b"])
  assert.deepStrictEqual(ids("vencida"), ["x"])
  assert.deepStrictEqual(ids("sem_senha"), ["s"])
})

test("37 · sem relatório de senhas (senhas nulo) o laudo só aparece em Todas", () => {
  const itens = [item({ idLaudo: "1", senhas: null })]
  const f = { ...filtrosIniciais(), recorte: "todos" as const }
  assert.strictEqual(filtrar(itens, f, HOJE).length, 1)
  assert.strictEqual(filtrar(itens, { ...f, recorteSenha: "sem_senha" }, HOJE).length, 0)
})

test("38 · os dois painéis se cruzam: cada um conta pelo recorte do OUTRO, nunca pelo seu", () => {
  const itens = [
    item({ idLaudo: "a", situacao: "vencido", validade: "2026-01-01", senhas: comSenha("2027-01-01") }),
    item({ idLaudo: "b", situacao: "vencido", validade: "2026-01-01", senhas: calcularSenhasDoLaudo([], "ASSIM Saúde", HOJE) }),
    item({ idLaudo: "c", situacao: "vigente", senhas: calcularSenhasDoLaudo([], "ASSIM Saúde", HOJE) }),
  ]
  const base = { ...filtrosIniciais(), recorte: "todos" as const }

  // "Sem senha" marcado: o painel do laudo passa a contar só b e c.
  const laudo = contarKpis(itens, { ...base, recorteSenha: "sem_senha" }, HOJE)
  assert.strictEqual(laudo.todos, 2)
  assert.strictEqual(laudo.vencidos, 1)

  // "Vencidos" marcado: o painel da senha conta só a e b.
  const senha = contarKpisSenha(itens, { ...base, recorte: "vencidos" }, HOJE)
  assert.strictEqual(senha.todos, 2)
  assert.strictEqual(senha.vigente, 1)
  assert.strictEqual(senha.sem_senha, 1)

  // Marcar um card de senha NÃO muda os outros cards de senha.
  assert.deepStrictEqual(
    contarKpisSenha(itens, { ...base, recorteSenha: "sem_senha" }, HOJE),
    contarKpisSenha(itens, { ...base, recorteSenha: "vigente" }, HOJE),
  )

  // E a lista é a interseção.
  assert.deepStrictEqual(
    filtrar(itens, { ...base, recorte: "vencidos", recorteSenha: "sem_senha" }, HOJE).map((i) => i.idLaudo),
    ["b"],
  )
})

test("39 · o recorte de senha nasce em Todas, e mexer nele acende o Limpar", () => {
  assert.strictEqual(filtrosIniciais().recorteSenha, "todos")
  assert.strictEqual(filtrosAlterados({ ...filtrosIniciais(), recorteSenha: "sem_senha" }), true)
})

test("39 · aplicáveis = laudos em que a senha ASSIM é assunto (outro convênio fora)", () => {
  const itens = [
    item({ idLaudo: "a", senhas: comSenha("2027-01-01") }),
    item({ idLaudo: "o", senhas: calcularSenhasDoLaudo([], "LEVE SAUDE", HOJE) }),
    item({ idLaudo: "n", senhas: null }),
  ]
  const k = contarKpisSenha(itens, { ...filtrosIniciais(), recorte: "todos" }, HOJE)
  assert.strictEqual(k.aplicaveis, 1)
})

test("40 · ordenar por validade da senha: a que vence primeiro, sem senha no fim", () => {
  const itens = [
    item({ idLaudo: "tarde", nome: "A", senhas: comSenha("2027-06-01") }),
    item({ idLaudo: "sem", nome: "B", senhas: calcularSenhasDoLaudo([], "ASSIM Saúde", HOJE) }),
    item({ idLaudo: "fora-cedo", nome: "C", senhas: comSenha("2027-06-01", "2026-10-01") }),
    item({ idLaudo: "nulo", nome: "D", senhas: null }),
  ]
  assert.deepStrictEqual(
    ordenar(itens, "validade_senha").map((i) => i.idLaudo),
    ["fora-cedo", "tarde", "sem", "nulo"],
  )
})

test("41 · proximaValidadeDeSenha pega a menor entre dentro e fora", () => {
  assert.strictEqual(proximaValidadeDeSenha(item({ senhas: comSenha("2027-06-01", "2026-10-01") })), "2026-10-01")
  assert.strictEqual(proximaValidadeDeSenha(item({ senhas: comSenha(null) })), null)
  assert.strictEqual(proximaValidadeDeSenha(item({ senhas: null })), null)
})

// ─── Convênio ───────────────────────────────────────────────────────────────

test("42 · convênio: vazio = todos; escolhido = só ele; sem convênio tem chave própria", () => {
  const itens = [
    item({ idLaudo: "a", convenio: "ASSIM Saúde" }),
    item({ idLaudo: "b", convenio: "LEVE SAUDE" }),
    item({ idLaudo: "c", convenio: null, convenioOrigem: null }),
  ]
  const f = { ...filtrosIniciais(), recorte: "todos" as const, convenios: new Set<string>() }
  assert.strictEqual(filtrar(itens, f, HOJE).length, 3, "vazio = todos")
  assert.deepStrictEqual(
    filtrar(itens, { ...filtrosIniciais(), recorte: "todos" }, HOJE).map((i) => i.idLaudo),
    ["a"],
    "o padrão (ASSIM Saúde) já recorta",
  )
  assert.deepStrictEqual(
    filtrar(itens, { ...f, convenios: new Set(["LEVE SAUDE"]) }, HOJE).map((i) => i.idLaudo),
    ["b"],
  )
  assert.deepStrictEqual(
    filtrar(itens, { ...f, convenios: new Set([""]) }, HOJE).map((i) => i.idLaudo),
    ["c"],
  )
})

test("43 · trocar o convênio do padrão acende o Limpar; o mesmo convênio num Set novo, não", () => {
  assert.strictEqual(filtrosAlterados({ ...filtrosIniciais(), convenios: new Set(["ASSIM Saúde"]) }), false)
  assert.strictEqual(filtrosAlterados({ ...filtrosIniciais(), convenios: new Set(["LEVE SAUDE"]) }), true)
  assert.strictEqual(
    filtrosAlterados({ ...filtrosIniciais(), convenios: new Set(["ASSIM Saúde", "LEVE SAUDE"]) }),
    true,
  )
  assert.strictEqual(filtrosAlterados({ ...filtrosIniciais(), convenios: new Set<string>() }), true)
})

// ─── Ordenação pela senha ───────────────────────────────────────────────────

/** Senha com validade, liberação e "Atualizado em" controlados. */
function senhaCom(o: { validade?: string | null; liberacao?: string | null; atualizado?: string | null }) {
  return calcularSenhasDoLaudo(
    [
      {
        idAutorizacao: "1",
        idLaudo: "477",
        idFavorecido: 11511,
        plano: "ASSIM Saúde",
        dataLista: null,
        situacaoDentro: "AUTORIZADO",
        senhaDentro: "1234567",
        liberacaoDentro: o.liberacao ?? null,
        validadeDentro: o.validade ?? null,
        situacaoFora: "",
        senhaFora: "",
        liberacaoFora: null,
        validadeFora: null,
        criadoEmOrigem: null,
        atualizadoEmOrigem: o.atualizado ?? null,
        arquivoAutorizacao: "",
        cronogramaConvenio: "",
        observacoes: "",
        especialidades: [],
      },
    ],
    "ASSIM Saúde",
    HOJE,
  )
}

/** Senha só com o lado FORA do ROL preenchido (dentro fica "não se aplica"). */
function senhaComFora(validade: string) {
  return calcularSenhasDoLaudo(
    [
      {
        idAutorizacao: "1",
        idLaudo: "477",
        idFavorecido: 11511,
        plano: "ASSIM Saúde",
        dataLista: null,
        situacaoDentro: "",
        senhaDentro: "",
        liberacaoDentro: null,
        validadeDentro: null,
        situacaoFora: "AUTORIZADO",
        senhaFora: "7654321",
        liberacaoFora: null,
        validadeFora: validade,
        criadoEmOrigem: null,
        atualizadoEmOrigem: null,
        arquivoAutorizacao: "",
        cronogramaConvenio: "",
        observacoes: "",
        especialidades: [{ especialidade: "Fisioterapia Aquática", grupo: "Fora do ROL", quantidadeAutorizada: "", quantidadeSolicitada: "", codigoGuia: "", descricaoGuia: "", emUso: "" }],
      },
    ],
    "ASSIM Saúde",
    HOJE,
  )
}

test("44 · urgência da senha: mais grave primeiro; no mesmo status, a que vence antes; sem relatório no fim", () => {
  const itens = [
    item({ idLaudo: "vig-tarde", nome: "A", senhas: senhaCom({ validade: "2027-06-01" }) }),
    item({ idLaudo: "nulo", nome: "B", senhas: null }),
    item({ idLaudo: "vencida", nome: "C", senhas: senhaCom({ validade: "2026-01-01" }) }),
    item({ idLaudo: "sem", nome: "D", senhas: calcularSenhasDoLaudo([], "ASSIM Saúde", HOJE) }),
    item({ idLaudo: "vig-cedo", nome: "E", senhas: senhaCom({ validade: "2027-01-01" }) }),
    item({ idLaudo: "outro", nome: "F", senhas: calcularSenhasDoLaudo([], "LEVE SAUDE", HOJE) }),
  ]
  assert.deepStrictEqual(
    ordenar(itens, "urgencia_senha").map((i) => i.idLaudo),
    ["vencida", "sem", "vig-cedo", "vig-tarde", "outro", "nulo"],
  )
})

test("45 · liberação e atualização na ASSIM: a mais RECENTE primeiro, sem data no fim", () => {
  const itens = [
    item({ idLaudo: "velha", nome: "A", senhas: senhaCom({ liberacao: "2026-08-01", atualizado: "2026-08-02T10:00" }) }),
    item({ idLaudo: "sem", nome: "B", senhas: senhaCom({}) }),
    item({ idLaudo: "nova", nome: "C", senhas: senhaCom({ liberacao: "2026-09-20", atualizado: "2026-09-21T09:00" }) }),
  ]
  assert.deepStrictEqual(ordenar(itens, "liberacao_senha").map((i) => i.idLaudo), ["nova", "velha", "sem"])
  assert.deepStrictEqual(ordenar(itens, "atualizacao_senha").map((i) => i.idLaudo), ["nova", "velha", "sem"])
})

test("46 · janela de validade da SENHA: qualquer lado (dentro/fora) dentro do período conta", () => {
  const itens = [
    item({ idLaudo: "dentro-perto", senhas: senhaCom({ validade: "2026-10-05" }) }),
    item({ idLaudo: "dentro-longe", senhas: senhaCom({ validade: "2027-06-01" }) }),
    item({ idLaudo: "sem-validade", senhas: senhaCom({}) }),
    item({ idLaudo: "nulo", senhas: null }),
  ]
  const f = { ...filtrosIniciais(), recorte: "todos" as const }
  assert.deepStrictEqual(
    filtrar(itens, { ...f, validadeSenhaDe: "2026-10-01", validadeSenhaAte: "2026-10-31" }, HOJE).map((i) => i.idLaudo),
    ["dentro-perto"],
  )
  assert.strictEqual(filtrar(itens, f, HOJE).length, 4, "sem período, ninguém é cortado")
})

test("46 · fora do ROL também conta na janela de validade da senha", () => {
  const item2 = item({ idLaudo: "so-fora", senhas: senhaComFora("2026-10-05") })
  const f = { ...filtrosIniciais(), recorte: "todos" as const, validadeSenhaDe: "2026-10-01", validadeSenhaAte: "2026-10-31" }
  assert.deepStrictEqual(filtrar([item2], f, HOJE).map((i) => i.idLaudo), ["so-fora"])
})
