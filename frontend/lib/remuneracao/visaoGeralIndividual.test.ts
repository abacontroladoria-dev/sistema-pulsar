// Visão geral anônima de /relacionamento-prestador/individual.
//
// O que está em jogo é privacidade: especialidade com poucas pessoas não pode
// aparecer com valor, nem sair por subtração do total.
//
//   npx vitest run lib/remuneracao/visaoGeralIndividual.test.ts

import { describe, expect, test } from "vitest"

import {
  K_MINIMO, ROTULO_OUTRAS, degrauRedondo, especialidadesAnonimas, faixasDeValor, mediana,
  pendenciasDocumento, resumoGeralIndividual,
} from "./visaoGeralIndividual"
import type { EspecialidadeTotal } from "./dashboardRP"
import type { Demonstrativo } from "./demonstrativo"
import type { DocInfo } from "./documento"
import type { ProfRemunReal, SessaoComPapel } from "./calculo"

const esp = (especialidade: string, valor: number, profissionais: string[]): EspecialidadeTotal =>
  ({ especialidade, valor, pct: 0, profissionais })

describe("especialidadesAnonimas", () => {
  test("grupos com menos de K pessoas vão para Outras; nomes nunca saem", () => {
    const r = especialidadesAnonimas([
      esp("Aplicador ABA", 9000, ["a", "b", "c", "d"]),
      esp("Psicologia", 6000, ["e", "f", "g"]),
      esp("Fonoaudiologia", 4000, ["h", "i"]),
      esp("Terapia Ocupacional", 3000, ["j"]),
    ])
    expect(r.map(e => e.nome)).toEqual(["Aplicador ABA", "Psicologia", ROTULO_OUTRAS])
    expect(r.at(-1)).toEqual({ nome: ROTULO_OUTRAS, profissionais: 3, valor: 7000 })
    expect(JSON.stringify(r)).not.toMatch(/"[a-j]"/)
    expect(K_MINIMO).toBe(3)
  })

  test("Outras pequeno: some o valor dele E o do menor grupo visível", () => {
    const r = especialidadesAnonimas([
      esp("Aplicador ABA", 9000, ["a", "b", "c"]),
      esp("Psicologia", 6000, ["e", "f", "g"]),
      esp("Fonoaudiologia", 4000, ["h"]),
    ])
    expect(r.find(e => e.nome === ROTULO_OUTRAS)).toMatchObject({ profissionais: 1, valor: null, motivoOculto: "grupoPequeno" })
    expect(r.find(e => e.nome === "Psicologia")).toMatchObject({ valor: null, motivoOculto: "protegeOutras" })
    expect(r.find(e => e.nome === "Aplicador ABA")?.valor).toBe(9000)
  })

  test("pessoa em duas especialidades pequenas conta uma vez em Outras", () => {
    const r = especialidadesAnonimas([esp("A", 1, ["x", "y"]), esp("B", 1, ["x"])])
    expect(r).toEqual([{ nome: ROTULO_OUTRAS, profissionais: 2, valor: null, motivoOculto: "grupoPequeno" }])
  })

  test("sem grupo pequeno, não cria Outras", () => {
    expect(especialidadesAnonimas([esp("A", 10, ["x", "y", "z"])]).map(e => e.nome)).toEqual(["A"])
  })
})

describe("faixas e mediana", () => {
  test("degrau redondo", () => {
    expect(degrauRedondo(1800)).toBe(2000)
    expect(degrauRedondo(2100)).toBe(2500)
    expect(degrauRedondo(4100)).toBe(5000)
    expect(degrauRedondo(7)).toBe(10)
  })

  test("faixas cobrem o máximo e cortam as vazias do topo", () => {
    const f = faixasDeValor([500, 1500, 2500, 9000])
    expect(f[0]).toEqual({ de: 0, ate: 2000, qtd: 2 })
    expect(f.reduce((s, x) => s + x.qtd, 0)).toBe(4)
    expect(f.at(-1)!.ate).toBeGreaterThanOrEqual(9000)
    expect(faixasDeValor([100, 100, 100]).at(-1)).toMatchObject({ qtd: 3 })
    expect(faixasDeValor([])).toEqual([])
    expect(faixasDeValor([0, 0])).toEqual([])
  })

  test("mediana par e ímpar", () => {
    expect(mediana([3, 1, 2])).toBe(2)
    expect(mediana([4, 1, 3, 2])).toBe(2.5)
    expect(mediana([])).toBe(0)
  })
})

// ─── Resumo ──────────────────────────────────────────────────────────────────

const demo = (extra: Partial<Demonstrativo>): Demonstrativo => ({
  isCC: false, isETA: false, totalSessoes: 0, rotuloTotalSessoes: "", linhas: [],
  total: 0, somaLinhas: 0, divergente: false, diferencas: [], pepTotal: 0, pepPacientes: 0, pepPendente: false,
  valorFixoBancoHoras: 0, pacientesCC: [], ...extra,
})
const info = (extra: Partial<DocInfo>): DocInfo => ({
  tipo: "pj", icone: "", docLabel: "CNPJ", docNumero: "", principal: "", principalUpper: "",
  responsavelLegal: "", contrato: "", docProvisorio: false, razaoProvisoria: false, contratoProvisorio: false, ...extra,
})
const sess = (papel: string, classificacao: string, valorPA?: number) =>
  ({ papel, classificacao, valorPA, data: "2026-08-01", hora: "08:00" }) as unknown as SessaoComPapel
const prof = (nome: string, sessoes: SessaoComPapel[], modalidade = "atendimento") =>
  ({ prof: nome, sessoes, modalidade, diariaPeriodo: 0, etaBonusPeriodo: 0, pe: 0, valorConfirmado: 0, valorFixoBancoHoras: 0, valorTotalAPagar: 0 }) as unknown as ProfRemunReal

describe("pendenciasDocumento", () => {
  test("cada placeholder e cada causa de diferença viram pendência própria", () => {
    expect(pendenciasDocumento(demo({}), info({}))).toEqual([])
    expect(pendenciasDocumento(
      demo({ pepPendente: true, divergente: true, diferencas: [{ causa: "evolucaoDuplicada", sessoes: 2, valor: 70, sessoesDetalhe: [] }] }),
      info({ docProvisorio: true, razaoProvisoria: true, contratoProvisorio: true }),
    )).toEqual(["semDocumento", "semRazao", "semContrato", "pepPendente", "evolucaoDuplicada"])
  })
})

describe("resumoGeralIndividual", () => {
  test("agrega documentos, dinheiro, sessões, modalidade", () => {
    const a = prof("Ana Aplicadora", [sess("Agenda", "Evolução normal", 30), sess("Agenda", "Evolução normal", 30)])
    const b = prof("Beto Coordenador", [sess("Agenda", "Evolução normal", 30)], "hibrido")
    const c = prof("Célia Contratante", [], "banco_horas")
    const demos = new Map([
      ["Ana Aplicadora", demo({ total: 1000 })],
      ["Beto Coordenador", demo({ total: 3000, isCC: true, pepPendente: true })],
      ["Célia Contratante", demo({ total: 2000 })],
    ])
    const infos = new Map([
      ["Ana Aplicadora", info({})],
      ["Beto Coordenador", info({ tipo: "pf" })],
      ["Célia Contratante", info({ contratoProvisorio: true })],
    ])

    const r = resumoGeralIndividual([a, b, c], {
      demonstrativoDe: p => demos.get(p.prof)!,
      infoDe: p => infos.get(p.prof)!,
      porEspecialidade: [],
    })

    expect(r.profissionais).toBe(3)
    expect(r).toMatchObject({ pj: 2, pf: 1, modalidade: { atendimento: 1, hibrido: 1, banco_horas: 1 } })
    expect(r.documentos).toMatchObject({ prontos: 1, comPendencia: 2, cc: 1 })
    expect(r.documentos.porPendencia).toMatchObject({ pepPendente: 1, semContrato: 1, semDocumento: 0 })
    expect(r.dinheiro).toMatchObject({ total: 6000, media: 2000, mediana: 2000 })
    expect(r.sessoes.remuneradas).toBe(3)
    expect(r.sessoes.faixasCobertura).toMatchObject({ alta: 2, semBase: 1 })

    // Decisão do usuário (25/09/2026): "Documentos do mês" identifica quem é —
    // ao contrário de dinheiro/sessões/especialidades, que continuam agregados.
    expect(r.documentos.ocorrenciasPendencia.pepPendente).toEqual([{ profissional: "Beto Coordenador" }])
    expect(r.documentos.ocorrenciasPendencia.semContrato).toEqual([{ profissional: "Célia Contratante" }])
    expect(r.documentos.ocorrenciasPendencia.semDocumento).toEqual([])
    const semNome = { ...r, documentos: { ...r.documentos, ocorrenciasPendencia: undefined } }
    expect(JSON.stringify(semNome)).not.toMatch(/Ana Aplicadora|Beto Coordenador|Célia Contratante/)
  })

  test("causa de sessão vira uma ocorrência por sessão, agrupável pelo nome", () => {
    const s1 = { ...sess("Agenda", "Evolução duplicada", 35), id: "s1", data: "05/08/2026", hora: "09:00", especialidade: "Coordenador de Caso" }
    const s2 = { ...sess("Agenda", "Evolução duplicada", 35), id: "s2", data: "06/08/2026", hora: "10:00", especialidade: "Coordenador de Caso" }
    const d = demo({ total: 70, isCC: true, diferencas: [{
      causa: "evolucaoDuplicada", sessoes: 2, valor: 70,
      sessoesDetalhe: [
        { id: s1.id, data: s1.data, hora: s1.hora, especialidade: s1.especialidade, valor: 35 },
        { id: s2.id, data: s2.data, hora: s2.hora, especialidade: s2.especialidade, valor: 35 },
      ],
    }] })
    const p = prof("Duda Duplicada", [s1, s2])

    const r = resumoGeralIndividual([p], {
      demonstrativoDe: () => d,
      infoDe: () => info({}),
      porEspecialidade: [],
    })

    const oc = r.documentos.ocorrenciasPendencia.evolucaoDuplicada
    expect(oc).toHaveLength(2)
    expect(oc.every(x => x.profissional === "Duda Duplicada")).toBe(true)
    expect(oc.map(x => x.sessao?.id)).toEqual(["s1", "s2"])
  })
})
