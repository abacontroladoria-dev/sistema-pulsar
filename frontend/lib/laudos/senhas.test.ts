// Senhas da ASSIM: parser do relatório, status de cada senha e junção com os
// laudos da tela.
//
// Todos os dados aqui são FICTÍCIOS — o relatório real tem nome e CPF de
// paciente. As formas (IDs repetidos, autorização com várias linhas, datas
// ausentes) reproduzem o que foi medido em 28/09/2026.
//
//   npx vitest run lib/laudos/senhas.test.ts

import { test } from "vitest"
import assert from "node:assert/strict"
import {
  brDataHoraParaIso,
  calcularSenhasDoLaudo,
  COLUNAS_OBRIGATORIAS_SENHAS,
  juntarComSenhas,
  parsearRelatorioSenhas,
  planoEhAssim,
  RelatorioSenhasInvalidoError,
  type AutorizacaoSenha,
} from "./senhas"

const HOJE = "2026-09-28"

const CABECALHO_REAL = [
  "ID autorização", "ID laudo", "ID favorecido", "Paciente", "CPF", "Plano", "Data da lista",
  "Situação dentro do ROL", "Senha dentro do ROL", "Data da liberação da senha dentro do ROL",
  "Data de validade da senha dentro do ROL", "Situação fora do ROL", "Senha fora do ROL",
  "Data da liberação da senha fora do ROL", "Data de validade da senha fora do ROL",
  "Especialidade", "Quantidade autorizada", "Grupo da especialidade", "Código da guia",
  "Descrição da guia", "Quantidade solicitada", "Em uso", "Arquivo da autorização",
  "Cronograma do convênio", "Observações", "Criado em", "Atualizado em",
]

type LinhaCsv = Partial<Record<(typeof CABECALHO_REAL)[number], string>>

function linhaCsv(over: LinhaCsv = {}): LinhaCsv {
  return {
    "ID autorização": "900",
    "ID laudo": "10",
    "ID favorecido": "5001",
    Paciente: "Paciente Fictício",
    CPF: "000.000.000-00",
    Plano: "ASSIM Saúde",
    "Data da lista": "01/09/2026",
    "Situação dentro do ROL": "AUTORIZADO",
    "Senha dentro do ROL": "1234567",
    "Data da liberação da senha dentro do ROL": "01/09/2026",
    "Data de validade da senha dentro do ROL": "30/03/2027",
    "Situação fora do ROL": "",
    "Senha fora do ROL": "",
    "Data da liberação da senha fora do ROL": "",
    "Data de validade da senha fora do ROL": "",
    Especialidade: "Fonoaudiologia",
    "Quantidade autorizada": "3",
    "Grupo da especialidade": "Dentro do ROL",
    "Código da guia": "22070397",
    "Descrição da guia": "Sessão de Fonoaudiologia",
    "Quantidade solicitada": "0",
    "Em uso": "Sim",
    "Arquivo da autorização": "",
    "Cronograma do convênio": "",
    Observações: "",
    "Criado em": "03/09/2026 08:42",
    "Atualizado em": "09/09/2026 13:31",
    ...over,
  }
}

/** Monta o CSV como a ASSIM exporta: BOM, `;`, cabeçalhos com espaço entre aspas. */
function csv(linhas: LinhaCsv[], cabecalho: string[] = CABECALHO_REAL): string {
  const aspas = (v: string) => (/[;" ]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const topo = cabecalho.map(aspas).join(";")
  const corpo = linhas.map((l) => cabecalho.map((c) => aspas(l[c as keyof LinhaCsv] ?? "")).join(";"))
  return "﻿" + [topo, ...corpo].join("\r\n") + "\r\n"
}

function aut(over: Partial<AutorizacaoSenha> = {}): AutorizacaoSenha {
  return {
    idAutorizacao: "900",
    idLaudo: "10",
    idFavorecido: 5001,
    plano: "ASSIM Saúde",
    dataLista: "2026-09-01",
    situacaoDentro: "AUTORIZADO",
    senhaDentro: "1234567",
    liberacaoDentro: "2026-09-01",
    validadeDentro: "2027-03-30",
    situacaoFora: "",
    senhaFora: "",
    liberacaoFora: null,
    validadeFora: null,
    criadoEmOrigem: "2026-09-03T08:42",
    atualizadoEmOrigem: "2026-09-09T13:31",
    arquivoAutorizacao: "",
    cronogramaConvenio: "",
    observacoes: "",
    especialidades: [
      {
        especialidade: "Fonoaudiologia",
        grupo: "Dentro do ROL",
        quantidadeAutorizada: "3",
        quantidadeSolicitada: "0",
        codigoGuia: "22070397",
        descricaoGuia: "Sessão de Fonoaudiologia",
        emUso: "Sim",
      },
    ],
    ...over,
  }
}

// ─── 1. Parser ──────────────────────────────────────────────────────────────

test("1 · linhas de especialidade viram UMA autorização, com as especialidades dentro", () => {
  const texto = csv([
    linhaCsv({ Especialidade: "Fonoaudiologia" }),
    linhaCsv({ Especialidade: "Terapia Ocupacional" }),
    linhaCsv({ Especialidade: "Psicologia ABA" }),
  ])
  const r = parsearRelatorioSenhas(texto)

  assert.strictEqual(r.totalLinhas, 3)
  assert.strictEqual(r.autorizacoes.length, 1)
  const a = r.autorizacoes[0]
  assert.deepStrictEqual(
    a.especialidades.map((e) => e.especialidade),
    ["Fonoaudiologia", "Terapia Ocupacional", "Psicologia ABA"],
  )
  assert.strictEqual(a.idLaudo, "10")
  assert.strictEqual(a.idFavorecido, 5001)
  assert.strictEqual(a.validadeDentro, "2027-03-30")
  assert.strictEqual(a.criadoEmOrigem, "2026-09-03T08:42")
  assert.deepStrictEqual(r.autorizacoesDivergentes, [])
})

test("1 · nome e CPF do paciente NÃO saem do parser", () => {
  const r = parsearRelatorioSenhas(csv([linhaCsv()]))
  const serializado = JSON.stringify(r)
  assert.ok(!serializado.includes("Paciente Fictício"))
  assert.ok(!serializado.includes("000.000.000-00"))
})

test("1 · coluna faltando RECUSA o arquivo e diz qual", () => {
  const semValidade = CABECALHO_REAL.filter((c) => c !== "Data de validade da senha dentro do ROL")
  assert.throws(
    () => parsearRelatorioSenhas(csv([linhaCsv()], semValidade)),
    (e: unknown) =>
      e instanceof RelatorioSenhasInvalidoError &&
      e.colunasFaltando.length === 1 &&
      e.colunasFaltando[0] === "Data de validade da senha dentro do ROL",
  )
})

test("1 · Paciente e CPF são opcionais — o relatório sem eles é aceito", () => {
  const semPessoais = CABECALHO_REAL.filter((c) => c !== "Paciente" && c !== "CPF")
  const r = parsearRelatorioSenhas(csv([linhaCsv()], semPessoais))
  assert.strictEqual(r.autorizacoes.length, 1)
})

test("1 · cabeçalho com acento/caixa trocados ainda casa", () => {
  const trocado = CABECALHO_REAL.map((c) => (c === "ID autorização" ? "id AUTORIZACAO" : c))
  const linha = linhaCsv()
  const r = parsearRelatorioSenhas(
    csv([{ ...linha, ["id AUTORIZACAO" as never]: "900" } as LinhaCsv], trocado),
  )
  assert.strictEqual(r.autorizacoes[0].idAutorizacao, "900")
})

test("1 · arquivo que não é o relatório (ou vazio) é recusado", () => {
  assert.throws(() => parsearRelatorioSenhas("a;b;c\r\n1;2;3\r\n"), RelatorioSenhasInvalidoError)
  assert.throws(() => parsearRelatorioSenhas(csv([])), RelatorioSenhasInvalidoError)
})

test("1 · linha sem ID autorização ou sem ID laudo é descartada e contada", () => {
  const r = parsearRelatorioSenhas(
    csv([linhaCsv(), linhaCsv({ "ID autorização": "" }), linhaCsv({ "ID laudo": "", "ID autorização": "901" })]),
  )
  assert.strictEqual(r.autorizacoes.length, 1)
  assert.strictEqual(r.linhasDescartadas, 2)
})

test("1 · autorização com campo divergente entre linhas é APONTADA (vale a primeira)", () => {
  const r = parsearRelatorioSenhas(
    csv([
      linhaCsv({ "Data de validade da senha dentro do ROL": "30/03/2027" }),
      linhaCsv({ "Data de validade da senha dentro do ROL": "30/04/2027" }),
    ]),
  )
  assert.deepStrictEqual(r.autorizacoesDivergentes, ["900"])
  assert.strictEqual(r.autorizacoes[0].validadeDentro, "2027-03-30")
})

test("1 · data fora do formato vira vazio e é contada", () => {
  const r = parsearRelatorioSenhas(csv([linhaCsv({ "Data de validade da senha dentro do ROL": "2027-03-30" })]))
  assert.strictEqual(r.autorizacoes[0].validadeDentro, null)
  assert.strictEqual(r.datasInvalidas.length, 1)
  assert.strictEqual(r.datasInvalidas[0].campo, "Data de validade da senha dentro do ROL")
})

test("1 · favorecido não numérico vira null (não casa com nada)", () => {
  const r = parsearRelatorioSenhas(csv([linhaCsv({ "ID favorecido": "abc" })]))
  assert.strictEqual(r.autorizacoes[0].idFavorecido, null)
})

test("1 · data-hora BR → ISO", () => {
  assert.strictEqual(brDataHoraParaIso("03/09/2026 08:42"), "2026-09-03T08:42")
  assert.strictEqual(brDataHoraParaIso("03/09/2026"), "2026-09-03T00:00")
  assert.strictEqual(brDataHoraParaIso("03/09/2026 25:00"), null)
  assert.strictEqual(brDataHoraParaIso("ontem"), null)
})

test("1 · as colunas obrigatórias são as do relatório real, menos Paciente e CPF", () => {
  const esperadas = CABECALHO_REAL.filter((c) => c !== "Paciente" && c !== "CPF")
  assert.deepStrictEqual([...COLUNAS_OBRIGATORIAS_SENHAS].sort(), [...esperadas].sort())
})

// ─── 2. Status de uma senha ─────────────────────────────────────────────────

test("2 · validade longe = vigente; ≤15 dias = vence em breve; passou = vencida", () => {
  assert.strictEqual(calcularSenhasDoLaudo([aut({ validadeDentro: "2027-03-30" })], "ASSIM Saúde", HOJE).dentro.status, "vigente")
  assert.strictEqual(calcularSenhasDoLaudo([aut({ validadeDentro: "2026-10-13" })], "ASSIM Saúde", HOJE).dentro.status, "vence_em_breve")
  assert.strictEqual(calcularSenhasDoLaudo([aut({ validadeDentro: "2026-10-14" })], "ASSIM Saúde", HOJE).dentro.status, "vigente")
  // Vence NO dia: hoje ainda vale.
  assert.strictEqual(calcularSenhasDoLaudo([aut({ validadeDentro: HOJE })], "ASSIM Saúde", HOJE).dentro.status, "vence_em_breve")
  const vencida = calcularSenhasDoLaudo([aut({ validadeDentro: "2026-09-27" })], "ASSIM Saúde", HOJE).dentro
  assert.strictEqual(vencida.status, "vencida")
  assert.strictEqual(vencida.dias, -1)
})

test("2 · número, datas e autorização de origem vêm junto", () => {
  const s = calcularSenhasDoLaudo([aut()], "ASSIM Saúde", HOJE).dentro
  assert.strictEqual(s.senha, "1234567")
  assert.strictEqual(s.liberacao, "2026-09-01")
  assert.strictEqual(s.validade, "2027-03-30")
  assert.strictEqual(s.situacao, "AUTORIZADO")
  assert.strictEqual(s.idAutorizacao, "900")
})

test("2 · EM ANÁLISE sem data = em análise", () => {
  const s = calcularSenhasDoLaudo(
    [aut({ situacaoDentro: "EM ANÁLISE", senhaDentro: "", liberacaoDentro: null, validadeDentro: null })],
    "ASSIM Saúde",
    HOJE,
  )
  assert.strictEqual(s.dentro.status, "em_analise")
})

test("2 · autorizado sem validade = sem validade (não some, não vira vigente)", () => {
  const s = calcularSenhasDoLaudo([aut({ validadeDentro: null })], "ASSIM Saúde", HOJE)
  assert.strictEqual(s.dentro.status, "sem_validade")
  assert.strictEqual(s.dentro.senha, "1234567")
})

test("2 · rótulo desconhecido, sem senha e sem data = pendente (rótulo cru preservado)", () => {
  const s = calcularSenhasDoLaudo(
    [aut({ situacaoDentro: "NEGADO", senhaDentro: "", validadeDentro: null, liberacaoDentro: null })],
    "ASSIM Saúde",
    HOJE,
  )
  assert.strictEqual(s.dentro.status, "pendente")
  assert.strictEqual(s.dentro.situacao, "NEGADO")
})

// ─── 3. Várias autorizações no mesmo laudo (5 de 88 medidos) ────────────────

test("3 · uma autorizada com data e outra EM ANÁLISE: a data manda", () => {
  // Forma do laudo 623 medido: duas autorizações criadas no mesmo minuto.
  const s = calcularSenhasDoLaudo(
    [
      aut({ idAutorizacao: "909", situacaoDentro: "EM ANÁLISE", senhaDentro: "", validadeDentro: null, liberacaoDentro: null }),
      aut({ idAutorizacao: "908", validadeDentro: "2026-10-28" }),
    ],
    "ASSIM Saúde",
    HOJE,
  )
  assert.strictEqual(s.dentro.status, "vigente")
  assert.strictEqual(s.dentro.idAutorizacao, "908")
  assert.strictEqual(s.autorizacoes.length, 2)
})

test("3 · uma nova com validade e uma antiga sem: vale a com validade", () => {
  // Forma do laudo 466 medido.
  const s = calcularSenhasDoLaudo(
    [
      aut({ idAutorizacao: "900", validadeDentro: null, atualizadoEmOrigem: "2026-09-22T13:14" }),
      aut({ idAutorizacao: "912", validadeDentro: "2027-04-13", atualizadoEmOrigem: "2026-09-22T13:14" }),
    ],
    "ASSIM Saúde",
    HOJE,
  )
  assert.strictEqual(s.dentro.idAutorizacao, "912")
  assert.strictEqual(s.dentro.status, "vigente")
})

test("3 · duas validades: vale a MAIOR", () => {
  const s = calcularSenhasDoLaudo(
    [
      aut({ idAutorizacao: "1", validadeDentro: "2026-09-01", senhaDentro: "1111111" }),
      aut({ idAutorizacao: "2", validadeDentro: "2027-01-01", senhaDentro: "2222222" }),
    ],
    "ASSIM Saúde",
    HOJE,
  )
  assert.strictEqual(s.dentro.senha, "2222222")
  assert.strictEqual(s.dentro.status, "vigente")
})

test("3 · senha vencida + renovação EM ANÁLISE = em análise (alguém já está cuidando)", () => {
  const s = calcularSenhasDoLaudo(
    [
      aut({ idAutorizacao: "1", validadeDentro: "2026-09-01" }),
      aut({ idAutorizacao: "2", situacaoDentro: "EM ANÁLISE", senhaDentro: "", validadeDentro: null, liberacaoDentro: null }),
    ],
    "ASSIM Saúde",
    HOJE,
  )
  assert.strictEqual(s.dentro.status, "em_analise")
  assert.strictEqual(s.dentro.idAutorizacao, "2")
})

test("3 · autorizações ficam no detalhe da mais recente para a mais antiga", () => {
  const s = calcularSenhasDoLaudo(
    [
      aut({ idAutorizacao: "1", atualizadoEmOrigem: "2026-09-01T10:00" }),
      aut({ idAutorizacao: "3", atualizadoEmOrigem: "2026-09-20T10:00" }),
      aut({ idAutorizacao: "2", atualizadoEmOrigem: "2026-09-10T10:00" }),
    ],
    "ASSIM Saúde",
    HOJE,
  )
  assert.deepStrictEqual(s.autorizacoes.map((a) => a.idAutorizacao), ["3", "2", "1"])
})

// ─── 4. Fora do ROL ─────────────────────────────────────────────────────────

test("4 · sem nada fora do ROL = não se aplica", () => {
  const s = calcularSenhasDoLaudo([aut()], "ASSIM Saúde", HOJE)
  assert.strictEqual(s.fora.status, "nao_se_aplica")
  assert.strictEqual(s.pior, "vigente")
})

test("4 · senha fora do ROL SEM situação preenchida: a data manda (1 caso medido)", () => {
  const s = calcularSenhasDoLaudo(
    [aut({ situacaoFora: "", senhaFora: "7654321", liberacaoFora: "2026-08-18", validadeFora: "2026-10-17" })],
    "ASSIM Saúde",
    HOJE,
  )
  assert.strictEqual(s.fora.status, "vigente")
  assert.strictEqual(s.fora.senha, "7654321")
})

test("4 · especialidade Fora do ROL sem senha fora = pendente, e pesa no pior", () => {
  const s = calcularSenhasDoLaudo(
    [
      aut({
        especialidades: [
          { especialidade: "Fisioterapia Aquática", grupo: "Fora do ROL", quantidadeAutorizada: "4", quantidadeSolicitada: "0", codigoGuia: "", descricaoGuia: "", emUso: "Sim" },
        ],
      }),
    ],
    "ASSIM Saúde",
    HOJE,
  )
  assert.strictEqual(s.fora.status, "pendente")
  assert.strictEqual(s.pior, "pendente")
})

test("4 · pior = o lado mais grave", () => {
  const s = calcularSenhasDoLaudo(
    [aut({ validadeDentro: "2027-03-30", situacaoFora: "AUTORIZADO", senhaFora: "7", validadeFora: "2026-09-01" })],
    "ASSIM Saúde",
    HOJE,
  )
  assert.strictEqual(s.dentro.status, "vigente")
  assert.strictEqual(s.fora.status, "vencida")
  assert.strictEqual(s.pior, "vencida")
})

// ─── 5. Laudo ausente do relatório ──────────────────────────────────────────

test("5 · laudo ASSIM sem autorização = sem senha; outro convênio = não se aplica", () => {
  const assim = calcularSenhasDoLaudo([], "ASSIM Saúde", HOJE)
  assert.strictEqual(assim.dentro.status, "sem_senha")
  assert.strictEqual(assim.pior, "sem_senha")

  const outro = calcularSenhasDoLaudo([], "LEVE SAUDE", HOJE)
  assert.strictEqual(outro.dentro.status, "nao_se_aplica")
  assert.strictEqual(outro.pior, "nao_se_aplica")
})

test("5 · planoEhAssim reconhece a grafia do Órbita e não confunde com outros", () => {
  assert.ok(planoEhAssim("ASSIM Saúde"))
  assert.ok(planoEhAssim("assim saude"))
  assert.ok(!planoEhAssim("Particular"))
  assert.ok(!planoEhAssim("SEGUROS UNIMED"))
  assert.ok(!planoEhAssim(""))
})

// ─── 6. Junção: laudo E favorecido, exatamente ──────────────────────────────

const item = (idLaudo: string, idFavorecido: number | null, plano = "ASSIM Saúde") => ({
  idLaudo,
  idFavorecido,
  plano,
})

test("6 · casa só quando laudo E favorecido batem", () => {
  const { itens, resumo } = juntarComSenhas(
    [item("10", 5001), item("11", 5002)],
    [aut({ idLaudo: "10", idFavorecido: 5001 })],
    HOJE,
  )
  assert.strictEqual(itens[0].senhas.dentro.status, "vigente")
  assert.strictEqual(itens[1].senhas.dentro.status, "sem_senha")
  assert.strictEqual(resumo.laudosCasados, 1)
  assert.deepStrictEqual(resumo.laudosOrfaos, [])
  assert.deepStrictEqual(resumo.laudosDivergentes, [])
})

test("6 · laudo igual com favorecido DIFERENTE não casa — seria senha de outro paciente", () => {
  const { itens, resumo } = juntarComSenhas(
    [item("10", 5001)],
    [aut({ idLaudo: "10", idFavorecido: 9999 })],
    HOJE,
  )
  assert.strictEqual(itens[0].senhas.dentro.status, "sem_senha")
  assert.strictEqual(resumo.laudosCasados, 0)
  assert.deepStrictEqual(resumo.laudosDivergentes, [
    { idLaudo: "10", favorecidoRelatorio: 9999, favorecidoOrbita: 5001 },
  ])
})

test("6 · laudo da tela sem favorecido nunca casa", () => {
  const { itens, resumo } = juntarComSenhas([item("10", null)], [aut({ idLaudo: "10" })], HOJE)
  assert.strictEqual(itens[0].senhas.autorizacoes.length, 0)
  assert.strictEqual(resumo.laudosDivergentes.length, 1)
})

test("6 · laudo do relatório fora do Órbita vai para órfãos (ordenado)", () => {
  const { resumo } = juntarComSenhas(
    [item("10", 5001)],
    [aut({ idLaudo: "577", idAutorizacao: "1" }), aut({ idLaudo: "126", idAutorizacao: "2" }), aut({ idLaudo: "10" })],
    HOJE,
  )
  assert.deepStrictEqual(resumo.laudosOrfaos, ["126", "577"])
})

test("6 · a saída tem exatamente os itens de entrada, na mesma ordem, com os campos preservados", () => {
  const entrada = [
    { ...item("3", 1), nome: "C" },
    { ...item("1", 2), nome: "A" },
    { ...item("2", 3, "Particular"), nome: "B" },
  ]
  const { itens } = juntarComSenhas(entrada, [], HOJE)
  assert.deepStrictEqual(itens.map((i) => i.nome), ["C", "A", "B"])
  assert.strictEqual(itens[2].senhas.pior, "nao_se_aplica")
})

test("6 · o convênio resolvido (grade) decide Sem senha × não se aplica, não o Plano do Órbita", () => {
  // Órbita diz LEVE, a grade diz ASSIM agora: sem autorização, é "Sem senha".
  const { itens } = juntarComSenhas(
    [{ idLaudo: "10", idFavorecido: 1, plano: "LEVE SAUDE", convenio: "ASSIM Saúde" }],
    [],
    HOJE,
  )
  assert.strictEqual(itens[0].senhas.pior, "sem_senha")

  // E o contrário: Órbita diz ASSIM, a grade diz Particular — não se aplica.
  const outro = juntarComSenhas(
    [{ idLaudo: "11", idFavorecido: 2, plano: "ASSIM Saúde", convenio: "Particular" }],
    [],
    HOJE,
  )
  assert.strictEqual(outro.itens[0].senhas.pior, "nao_se_aplica")
})

