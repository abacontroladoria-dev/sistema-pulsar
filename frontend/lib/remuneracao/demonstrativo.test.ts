// Demonstrativo de faturamento (/relacionamento-prestador/individual).
//
// Dois compromissos travados aqui:
//
//   1. O HTML do PDF/Word NÃO muda. A conta saiu de montarHtmlDocumentoFaturamento
//      para montarDemonstrativo (demonstrativo.ts) para a tela poder mostrar
//      exatamente o mesmo que o documento — e o snapshot abaixo foi gravado
//      ANTES dessa extração. Se ele quebrar, o documento que vai para o
//      prestador mudou: não atualize o snapshot sem essa decisão.
//   2. A tela avisa quando as linhas do documento não fecham com o total dele
//      (`divergente`) — casos conhecidos: substituição inconsistente, evolução
//      duplicada e sessão administrativa do ETA.
//
// A partir de `frontend/`:
//
//   npx vitest run lib/remuneracao/demonstrativo.test.ts

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"

import { montarHtmlDocumentoFaturamento, montarInfoDocumentoPrestador, type PdfOpts } from "./documento"
import { PA_TEXTO_BANCO_HORAS, type ProfRemunReal, type SessaoComPapel } from "./calculo"
import { descreverDiferenca, montarDemonstrativo, pepDasLinhas, sessoesDoResumo } from "./demonstrativo"
import type { PepApuracaoMensal } from "@/types/pep"

// ─── Fixtures ────────────────────────────────────────────────────────────────

let seq = 0

function sessao(extra: Partial<SessaoComPapel>): SessaoComPapel {
  seq += 1
  const dia = String((seq % 20) + 1).padStart(2, "0")
  return {
    id: `s${seq}`,
    data: `${dia}/08/2026`,
    hora: "08:00",
    diaSemana: "Segunda",
    papel: "Agenda",
    classificacao: "Evolução normal",
    paciente: `Paciente Número ${seq} da Silva`,
    especialidade: "Psicologia",
    profAgenda: "Fulano",
    profCsv: "Fulano",
    idFavorecido: String(1000 + seq),
    ...extra,
  } as unknown as SessaoComPapel
}

function prof(nome: string, sessoes: SessaoComPapel[], extra: Partial<ProfRemunReal> = {}): ProfRemunReal {
  return {
    prof: nome,
    sessoes,
    evoluidasProprias: sessoes.filter(s => s.papel === "Agenda" && s.classificacao !== "Evolução em conflito").length,
    substituicoesRealizadas: sessoes.filter(s => s.papel === "Substituição realizada" && s.valorPA !== undefined).length,
    diariaPeriodo: 0,
    diariaDetalhe: [],
    etaWeeksPeriodo: 0,
    etaBonusPeriodo: 0,
    pe: 0,
    valorConfirmado: sessoes.reduce((s, x) => s + (x.valorPA ?? 0), 0),
    modalidade: "atendimento",
    valorFixoBancoHoras: 0,
    numerosBancoHoras: [],
    bancoHorasDetalhe: [],
    contratoNovo: "",
    ...extra,
  } as unknown as ProfRemunReal
}

const pep = (valores: number[]): PepApuracaoMensal[] =>
  valores.map((v, i) => ({ id: `p${i}`, valor_liquido: v } as unknown as PepApuracaoMensal))

// CC + Aplicador (PS): dois PAs, PEP apurada, CNPJ e razão social, e uma
// substituição INCONSISTENTE (sem valorPA) — o documento a precifica pelo
// fallback ccPA mas o total não a conta: linhas ≠ total.
const cc = prof("Ana Coordenadora", [
  sessao({ especialidade: "Coordenador de Caso", funcaoPA: "Coordenador de Caso", valorPA: 35, paciente: "Maria Clara Souza Lima" }),
  sessao({ especialidade: "Coordenador de Caso", funcaoPA: "Coordenador de Caso", valorPA: 35, paciente: "João Pedro Alves Costa" }),
  sessao({ especialidade: "Aplicador ABA", funcaoPA: "Aplicador ABA (PS)", valorPA: 30 }),
  sessao({ especialidade: "Aplicador ABA", funcaoPA: "Aplicador ABA (PS)", valorPA: 30 }),
  sessao({ especialidade: "Aplicador ABA", funcaoPA: "Aplicador ABA (PS)", valorPA: 30 }),
  sessao({ papel: "Substituição realizada", especialidade: "Coordenador de Caso", classificacao: "Evolução em conflito" }),
], { contratoNovo: "PS.ABA-01-00000123" })

// Banco de horas híbrido, PF (só CPF): sessões cobertas pelo fixo e uma "outro
// contrato", mais PA avulso.
const bh = prof("Bruno Banco", [
  sessao({ especialidade: "Fonoaudiologia", valorPA: 0, valorPATexto: PA_TEXTO_BANCO_HORAS, semPA: true }),
  sessao({ especialidade: "Fonoaudiologia", valorPA: 0, valorPATexto: PA_TEXTO_BANCO_HORAS, semPA: true }),
  sessao({ especialidade: "Psicologia", valorPA: 0, semPA: true }),
  sessao({ especialidade: "Psicomotricidade", funcaoPA: "Psicomotricidade", valorPA: 45 }),
], { modalidade: "hibrido", valorFixoBancoHoras: 3000, numerosBancoHoras: ["BH-001"] })

// ETA sem cadastro nenhum (placeholders no documento), com PPD, bônus e uma
// sessão administrativa paga (entra no total, não entra nas linhas).
const eta = prof("Carla Especialista", [
  sessao({ especialidade: "Especialista Técnico de Área", valorPA: 50 }),
  sessao({ especialidade: "Especialista Técnico de Área", valorPA: 20, paciente: "Horário Administrativo" }),
], {
  diariaPeriodo: 300,
  diariaDetalhe: [{ esp: "Especialista Técnico de Área", dias: 3, rate: 100, total: 300 }],
  etaWeeksPeriodo: 2,
  etaBonusPeriodo: 200,
  valorConfirmado: 50 + 20 + 300 + 200,
})

// CC sem PEP apurada e com evolução duplicada (paga, fora das linhas).
const ccSemPep = prof("Diego Duplicado", [
  sessao({ especialidade: "Coordenador de Caso", funcaoPA: "Coordenador de Caso", valorPA: 35 }),
  sessao({ especialidade: "Coordenador de Caso", funcaoPA: "Coordenador de Caso", valorPA: 35, classificacao: "Evolução duplicada" }),
])

const cadastroPrestadores = {
  "Ana Coordenadora": { nome: "Ana Coordenadora", cnpj: "12345678000190", cpf: "", razaoSocial: "Ana Serviços Terapêuticos Ltda", contratosAtuais: [] },
  "Bruno Banco": { nome: "Bruno Banco", cnpj: "", cpf: "12345678901", razaoSocial: "", contratosAtuais: [] },
  "Diego Duplicado": { nome: "Diego Duplicado", cnpj: "98765432000110", cpf: "", razaoSocial: "", contratosAtuais: [] },
}

const opts = (pepApuracao: PepApuracaoMensal[] | null): PdfOpts => ({
  remPeriodo: { inicio: "01/08/2026", fim: "31/08/2026" },
  ccPA: 50, ccPE: 100, etaBonus: 100,
  taxasPA: { Psicologia: 40, "Coordenador de Caso": 35 },
  cadastroPrestadores,
  pepApuracao,
})

const CASOS: [string, ProfRemunReal, PepApuracaoMensal[] | null][] = [
  ["CC com dois PAs, PEP apurada e substituição inconsistente", cc, pep([120.5, 80])],
  ["banco de horas híbrido PF", bh, null],
  ["ETA sem cadastro, com PPD e bônus", eta, null],
  ["CC sem PEP e com evolução duplicada", ccSemPep, []],
]

beforeAll(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 24, 12, 0, 0))
})
afterAll(() => { vi.useRealTimers() })

// ─── 1. O documento não muda ─────────────────────────────────────────────────

describe("HTML do demonstrativo (PDF/Word) — gravado antes da extração", () => {
  for (const [nome, p, pepRows] of CASOS) {
    test(`${nome} — PDF`, () => {
      expect(montarHtmlDocumentoFaturamento(p, { ...opts(pepRows), autoPrint: true })).toMatchSnapshot()
    })
    test(`${nome} — Word`, () => {
      expect(montarHtmlDocumentoFaturamento(p, { ...opts(pepRows), wordMode: true })).toMatchSnapshot()
    })
  }
})

describe("DocInfo", () => {
  test("snapshot do cabeçalho", () => {
    for (const [, p] of CASOS) {
      const { tipo, icone, docLabel, docNumero, principal, principalUpper, responsavelLegal, contrato } =
        montarInfoDocumentoPrestador(p, cadastroPrestadores)
      expect({ tipo, icone, docLabel, docNumero, principal, principalUpper, responsavelLegal, contrato }).toMatchSnapshot()
    }
  })
})

// ─── 2. A conta que a tela mostra ────────────────────────────────────────────

const conta = (p: ProfRemunReal, pepRows: PepApuracaoMensal[] | null) =>
  montarDemonstrativo(p, { ccPA: 50, etaBonus: 100, taxasPA: opts(null).taxasPA, pep: pepDasLinhas(pepRows) })

describe("montarDemonstrativo", () => {
  test("CC: PA por contrato, PEP apurada e substituição inconsistente → divergente", () => {
    const d = conta(cc, pep([120.5, 80]))
    expect(d.isCC).toBe(true)
    expect(d.linhas.map(l => l.tipo)).toEqual(["pa", "pa", "pep"])
    // A substituição inconsistente cai na linha do CC pelo fallback ccPA (50).
    expect(d.linhas[0]).toMatchObject({ detalhe: "Coordenação Técnica ABA de Caso", qtd: 3, valor: 120 })
    expect(d.linhas[1]).toMatchObject({ detalhe: "Aplicador ABA (PS)", qtd: 3, taxa: 30, valor: 90 })
    expect(d.linhas[2]).toMatchObject({ tipo: "pep", qtd: 2, valor: 200.5 })
    expect(d.total).toBeCloseTo(160 + 200.5)
    expect(d.somaLinhas).toBeCloseTo(120 + 90 + 200.5)
    expect(d.divergente).toBe(true)
    // A causa, com sinal: listada a R$ 50 na linha de PA, não paga → itens a mais.
    expect(d.diferencas).toMatchObject([{ causa: "substituicaoEmConferencia", sessoes: 1, valor: -50 }])
    expect(descreverDiferenca(d.diferencas[0]).efeito).toBe("O documento mostra R$ 50,00 que não vai ser pago.")
    // A sessão exata por trás da causa — id, data, hora, especialidade — é o
    // que a Visão Geral expande para achar o profissional e o atendimento.
    const substSessao = cc.sessoes.find(s => s.papel === "Substituição realizada")!
    expect(d.diferencas[0].sessoesDetalhe).toEqual([
      { id: substSessao.id, data: substSessao.data, hora: substSessao.hora, especialidade: "Coordenador de Caso", valor: -50 },
    ])
    expect(d.pepPendente).toBe(false)
    // Inclui o paciente da substituição inconsistente — o documento lista todos os CC.
    expect(d.pacientesCC.length).toBe(3)
  })

  test("banco de horas híbrido: linhas sem PA não somam, fixo soma, conta fecha", () => {
    const d = conta(bh, null)
    expect(d.linhas.map(l => l.tipo)).toEqual(["pa", "semPA", "semPA", "fixoBH"])
    expect(d.linhas.find(l => l.detalhe === "Fonoaudiologia")).toMatchObject({ qtd: 2, valor: null, valorTexto: "Incluído no valor fixo" })
    expect(d.linhas.find(l => l.detalhe === "Psicologia")).toMatchObject({ valorTexto: "Tratado em outro contrato" })
    expect(d.total).toBe(45 + 3000)
    expect(d.divergente).toBe(false)
    expect(d.diferencas).toEqual([])
    expect(d.rotuloTotalSessoes).toBe("Total elegíveis ao PA")
  })

  test("ETA: sessão administrativa paga fica fora das linhas → divergente", () => {
    const d = conta(eta, null)
    expect(d.linhas.map(l => l.tipo)).toEqual(["pa", "ppd", "eta"])
    expect(d.linhas[2]).toMatchObject({ qtd: 2, taxa: 100, valor: 200 })
    expect(d.total).toBe(570)
    expect(d.somaLinhas).toBe(550)
    expect(d.divergente).toBe(true)
    expect(d.diferencas).toMatchObject([{ causa: "horarioAdministrativo", sessoes: 1, valor: 20 }])
    expect(d.diferencas[0].sessoesDetalhe).toHaveLength(1)
    const t = descreverDiferenca(d.diferencas[0])
    expect(t.explicacao).toBe("1 sessão de “Horário Administrativo” está paga (R$ 20,00), mas o documento não a mostra.")
    expect(t.efeito).toBe("Vai ser pago R$ 20,00 que o documento não mostra.")
  })

  test("CC sem PEP: linha pendente sem valor e evolução duplicada fora das linhas", () => {
    const d = conta(ccSemPep, [])
    expect(d.pepPendente).toBe(true)
    expect(d.linhas.at(-1)).toMatchObject({ tipo: "pep", valor: null, calculoTexto: "Ainda não apurada nesta competência" })
    expect(d.linhas[0]).toMatchObject({ qtd: 1, valor: 35 })
    expect(d.total).toBe(70)
    expect(d.divergente).toBe(true)
    expect(d.diferencas).toMatchObject([{ causa: "evolucaoDuplicada", sessoes: 1, valor: 35 }])
    expect(d.diferencas[0].sessoesDetalhe).toHaveLength(1)
  })

  test("PEP e bônus sem linha no documento, e o resto sempre dito", () => {
    // Não é CC, mas tem PEP apurada; não é ETA, mas tem bônus; e o PPD do
    // cálculo difere do detalhamento — nenhuma causa conhecida explica esse resto.
    const p = prof("Eva Estranha", [sessao({ valorPA: 40 })], {
      etaBonusPeriodo: 100,
      diariaPeriodo: 60,
      diariaDetalhe: [{ esp: "Psicologia", dias: 1, rate: 50, total: 50 }],
      valorConfirmado: 40 + 100 + 60,
    })
    const d = conta(p, pep([30]))
    expect(d.diferencas).toMatchObject([
      { causa: "pepSemItem", sessoes: 0, valor: 30 },
      { causa: "bonusEtaSemItem", sessoes: 0, valor: 100 },
      { causa: "diferencaSemCausa", sessoes: 0, valor: 10 },
    ])
    // Nenhuma delas vem de uma sessão específica — não há o que apontar na grade.
    expect(d.diferencas.every(x => x.sessoesDetalhe.length === 0)).toBe(true)
    // Por construção: as causas somam exatamente a diferença entre total e itens.
    expect(d.diferencas.reduce((s, x) => s + x.valor, 0)).toBeCloseTo(d.total - d.somaLinhas)
  })

  test("as causas sempre fecham com a diferença, em todos os casos", () => {
    for (const [, p, pepRows] of CASOS) {
      const d = conta(p, pepRows)
      expect(d.diferencas.reduce((s, x) => s + x.valor, 0)).toBeCloseTo(d.total - d.somaLinhas)
    }
  })

  test("banco de horas puro: rótulo das sessões muda", () => {
    expect(conta({ ...bh, modalidade: "banco_horas" } as ProfRemunReal, null).rotuloTotalSessoes).toBe("Cobertas pelo valor fixo")
  })
})

describe("DocInfo — dado provisório", () => {
  test("sinaliza o que o documento imprime com placeholder", () => {
    const info = (p: ProfRemunReal) => montarInfoDocumentoPrestador(p, cadastroPrestadores)
    expect(info(cc)).toMatchObject({ docProvisorio: false, razaoProvisoria: false, contratoProvisorio: false })
    expect(info(bh)).toMatchObject({ tipo: "pf", docProvisorio: false, razaoProvisoria: false, contratoProvisorio: true })
    expect(info(eta)).toMatchObject({ tipo: "pj", docProvisorio: true, razaoProvisoria: true, contratoProvisorio: true })
    expect(info(ccSemPep)).toMatchObject({ docProvisorio: false, razaoProvisoria: true })
  })
})

describe("sessoesDoResumo", () => {
  test("só linhas com PA, contadas por papel e agrupadas por dia em ordem", () => {
    const r = sessoesDoResumo([
      sessao({ data: "05/08/2026", valorPA: 30 }),
      sessao({ data: "02/08/2026", valorPA: 30, papel: "Substituição realizada" }),
      sessao({ data: "05/08/2026", valorPA: 30 }),
      sessao({ data: "03/08/2026" }),
    ])
    expect(r.rowsProf).toHaveLength(3)
    expect(r.proprias).toBe(2)
    expect(r.subs).toBe(1)
    expect(r.sessoesPorDia.map(g => [g.data, g.rows.length])).toEqual([["02/08/2026", 1], ["05/08/2026", 2]])
  })
})
