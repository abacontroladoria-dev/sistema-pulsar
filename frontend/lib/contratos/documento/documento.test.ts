// Documento dos contratos do paciente: extenso, montagem das etiquetas e o
// preenchimento dos modelos REAIS de lib/contratos/modelos/.
//
//   npx vitest run lib/contratos/documento/documento.test.ts

import { readFileSync } from "node:fs"
import path from "node:path"
import { test } from "vitest"
import assert from "node:assert/strict"
import PizZip from "pizzip"
import { dataPorExtenso, numeroPorExtenso, quantidadeComExtenso, reais, valorPorExtenso } from "./extenso"
import {
  MODELOS,
  montarDadosDocumento,
  type EntradaDocumento,
  type ResponsavelDoc,
  type VinculoDoc,
} from "./montarDados"
import { preencherModelo } from "./preencher"

// ─── extenso ─────────────────────────────────────────────────────────────────

test("número por extenso", () => {
  assert.equal(numeroPorExtenso(0), "zero")
  assert.equal(numeroPorExtenso(10), "dez")
  assert.equal(numeroPorExtenso(21), "vinte e um")
  assert.equal(numeroPorExtenso(100), "cem")
  assert.equal(numeroPorExtenso(101), "cento e um")
  assert.equal(numeroPorExtenso(1000), "mil")
  assert.equal(numeroPorExtenso(1100), "mil e cem")
  assert.equal(numeroPorExtenso(1755), "mil setecentos e cinquenta e cinco")
  assert.equal(numeroPorExtenso(2050), "dois mil e cinquenta")
  assert.equal(numeroPorExtenso(1_000_000), "um milhão")
  assert.equal(numeroPorExtenso(2_300_000), "dois milhões e trezentos mil")
})

test("valor por extenso", () => {
  assert.equal(valorPorExtenso(1755), "mil setecentos e cinquenta e cinco reais")
  assert.equal(valorPorExtenso(1234.56), "mil duzentos e trinta e quatro reais e cinquenta e seis centavos")
  assert.equal(valorPorExtenso(1), "um real")
  assert.equal(valorPorExtenso(0.01), "um centavo")
  assert.equal(valorPorExtenso(2_000_000), "dois milhões de reais")
  assert.equal(reais(1755), "R$ 1.755,00")
  assert.equal(quantidadeComExtenso(10), "10 (dez)")
  assert.equal(dataPorExtenso("2026-10-09"), "9 de outubro de 2026")
})

// ─── montagem ────────────────────────────────────────────────────────────────

const pessoa = (id: number, nome: string, extra: Partial<ResponsavelDoc> = {}): ResponsavelDoc => ({
  id,
  nome,
  cpf: "12345678901",
  rg: "123456789",
  data_nascimento: "1990-05-04",
  celular: "21999998888",
  email: `${nome.split(" ")[0].toLowerCase()}@exemplo.com`,
  cep: "21715065",
  logradouro: "Rua A",
  numero: "10",
  complemento: null,
  bairro: "Realengo",
  cidade: "Rio de Janeiro",
  uf: "rj",
  ...extra,
})

const MAE = pessoa(1, "Maria Mãe")
const PAI = pessoa(2, "João Pai", { cpf: "98765432100" })
const AVO = pessoa(3, "Vera Avó")

const vinc = (tipo: VinculoDoc["tipo"], r: ResponsavelDoc, parentesco: string | null): VinculoDoc => ({ tipo, parentesco, responsavel: r })

function entrada(over: Partial<EntradaDocumento> = {}): EntradaDocumento {
  return {
    contrato: {
      tipo: "avaliacao_neuropsicologica",
      numero: "ABA-TMP-03-00007",
      valor_total: 1755,
      sessoes_max: 10,
      valor_sessao_avulsa: 200,
      autorizacoes_imagem: { site: true },
    },
    paciente: { nome: "Bia", nome_civil: "Beatriz Civil", tem_nome_civil: true, cpf: null, rg: null, data_nascimento: "2019-03-02" },
    vinculos: [vinc("filiacao_1", MAE, "Mãe"), vinc("filiacao_2", PAI, "Pai")],
    vinculado: null,
    hoje: "2026-10-09",
    ...over,
  }
}

test("neuro: sem financeiro, contratante = filiação 1 e o bloco do responsável legal vira 'não se aplica'", () => {
  const r = montarDadosDocumento(entrada())
  assert.ok(r.ok)
  assert.equal(r.modelo, MODELOS.avaliacao_neuropsicologica)
  assert.equal(r.dados.ctr_nome, "Maria Mãe")
  assert.equal(r.dados.ctr_cpf, "123.456.789-01")
  assert.equal(r.dados.ctr_cep, "21715-065")
  assert.equal(r.dados.ctr_celular, "(21) 99999-8888")
  assert.equal(r.dados.ctr_endereco, "Rua A, nº 10")
  assert.equal(r.dados.ctr_bairro_cidade_uf, "Realengo, Rio de Janeiro/RJ")
  assert.equal(r.dados.leg_nome, "Não se aplica (o próprio CONTRATANTE)")
  assert.equal(r.dados.pac_nome, "Beatriz Civil", "nome civil quando há nome social")
  assert.equal(r.dados.pac_cpf, "—", "CPF/RG do paciente são opcionais")
  assert.equal(r.dados.valor_extenso, "mil setecentos e cinquenta e cinco reais")
  assert.equal(r.dados.sessoes_texto, "10 (dez)")
  assert.equal(r.dados.img_autorizo, "  X  ")
  assert.equal(r.dados.img_nao_autorizo, "     ")
  assert.equal(r.dados.img_redes, "     ")
})

test("neuro: com financeiro diferente, a filiação 1 vira o responsável legal", () => {
  const r = montarDadosDocumento(entrada({ vinculos: [vinc("financeiro", AVO, "Avó"), vinc("filiacao_1", MAE, "Mãe")] }))
  assert.ok(r.ok)
  assert.equal(r.dados.ctr_nome, "Vera Avó")
  assert.equal(r.dados.leg_nome, "Maria Mãe")
})

test("neuro: nenhuma autorização = NÃO AUTORIZO marcado", () => {
  const e = entrada()
  e.contrato.autorizacoes_imagem = null
  const r = montarDadosDocumento(e)
  assert.ok(r.ok)
  assert.equal(r.dados.img_autorizo, "     ")
  assert.equal(r.dados.img_nao_autorizo, "  X  ")
})

test("neuro: cadastro incompleto lista TODAS as pendências", () => {
  const e = entrada({ vinculos: [vinc("filiacao_1", pessoa(1, "Maria", { cpf: null, email: null, cep: null }), "Mãe")] })
  e.contrato.valor_total = null
  const r = montarDadosDocumento(e)
  assert.ok(!r.ok)
  assert.deepEqual(r.pendencias, [
    "Filiação 1 (contratante) sem CPF",
    "Filiação 1 (contratante) sem CEP",
    "Filiação 1 (contratante) sem e-mail",
    "Contrato sem valor total",
  ])
})

test("neuro: sem responsável nenhum", () => {
  const r = montarDadosDocumento(entrada({ vinculos: [] }))
  assert.ok(!r.ok)
  assert.match(r.pendencias[0], /Sem responsável financeiro nem filiação 1/)
})

const termo = (over: Partial<EntradaDocumento> = {}) =>
  entrada({
    contrato: {
      tipo: "termo_uso_imagem",
      numero: "ABA-TMP-03-00008",
      valor_total: null,
      sessoes_max: null,
      valor_sessao_avulsa: null,
      autorizacoes_imagem: { redes: true, primeiro_nome: true },
    },
    vinculado: { numero: "ABA-TMP-03-00002", data_inicio: "2026-02-01", assinado_em: null },
    ...over,
  })

test("termo: filiação 1 e 2, vínculo e primeiro nome", () => {
  const r = montarDadosDocumento(termo())
  assert.ok(r.ok)
  assert.equal(r.modelo, MODELOS.termo_uso_imagem)
  assert.equal(r.dados.vinc_numero, "ABA-TMP-03-00002")
  assert.equal(r.dados.vinc_data, "01/02/2026", "sem assinatura, a data de início")
  assert.equal(r.dados.r1_qualidade, "mãe")
  assert.equal(r.dados.tem_r2, true)
  assert.equal(r.dados.r2_cpf, "987.654.321-00")
  assert.equal(r.dados.img_primeiro_nome, "  X  ")
})

test("termo: sem filiação 2 o bloco some; data do vínculo assinado em Brasília", () => {
  const r = montarDadosDocumento(
    termo({
      vinculos: [vinc("filiacao_1", MAE, "Mãe")],
      vinculado: { numero: "ABA-TMP-03-00002", data_inicio: "2026-02-01", assinado_em: "2026-02-10T02:00:00Z" },
    }),
  )
  assert.ok(r.ok)
  assert.equal(r.dados.tem_r2, false)
  assert.equal(r.dados.vinc_data, "09/02/2026", "02h UTC ainda é dia 9 em Brasília")
})

test("termo: parentesco sem qualidade legal e falta de vínculo viram pendência", () => {
  const r = montarDadosDocumento(termo({ vinculos: [vinc("filiacao_1", MAE, "Outro")], vinculado: null }))
  assert.ok(!r.ok)
  assert.equal(r.pendencias.length, 2)
  assert.match(r.pendencias[0], /sem contrato de Terapias vinculado/)
  assert.match(r.pendencias[1], /parentesco "Outro"/)
})

test("tipo sem modelo", () => {
  const e = entrada()
  e.contrato.tipo = "terapias"
  const r = montarDadosDocumento(e)
  assert.ok(!r.ok)
})

// ─── preenchimento dos modelos reais ─────────────────────────────────────────

const PASTA = path.join(__dirname, "..", "modelos")

function corpo(docx: Buffer): string {
  return new PizZip(docx).file("word/document.xml")!.asText()
}
function texto(xml: string): string {
  return [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("")
}

for (const [nome, e] of [
  ["neuro", entrada()],
  ["termo com 2 responsáveis", termo()],
  ["termo com 1 responsável", termo({ vinculos: [vinc("filiacao_1", MAE, "Mãe")] })],
] as const) {
  test(`preenche o modelo real: ${nome}`, () => {
    const r = montarDadosDocumento(e)
    assert.ok(r.ok)
    const xml = corpo(preencherModelo(readFileSync(path.join(PASTA, r.modelo)), r.dados))
    const t = texto(xml)
    for (const sobra of ["«", "»", "XX", "___/", "{", "}"]) assert.ok(!t.includes(sobra), `sobrou "${sobra}"`)
    assert.ok(!xml.includes("w:highlight"), "sem destaque")
    assert.ok(!/<w:(ins|del)\b/.test(xml), "sem revisão")
    assert.ok(!t.includes("Observação para Preenchimento"), "sem instrução verde")
    assert.ok(t.includes("9 de outubro de 2026"))
    if (r.modelo === MODELOS.avaliacao_neuropsicologica) {
      assert.ok(t.includes("NÚMERO: ABA-TMP-03-00007"))
      assert.ok(t.includes("R$ 1.755,00 (mil setecentos e cinquenta e cinco reais)"))
      assert.ok(t.includes("até 10 (dez)"))
    } else {
      assert.ok(t.includes("Vinculado ao Contrato nº ABA-TMP-03-00002, firmado em 01/02/2026."))
      const temR2 = r.dados.tem_r2 === true
      assert.equal(t.includes("João Pai"), temR2)
      assert.equal(t.includes("SEGUNDO RESPONSÁVEL LEGAL"), temR2, "bloco do 2º responsável some sem ele")
    }
  })
}
