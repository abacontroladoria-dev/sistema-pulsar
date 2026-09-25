// Visão geral de Entregas PEP (/relacionamento-prestador/pep) — o que a tela
// mostra ANTES de escolher um Analista do Comportamento.
//
// PURO e SÓ LEITURA. Cruza duas fontes que já existem:
//   • a Grade do mês (quem é analista e quais pacientes ele atende) — a mesma
//     regra "sessão de Coordenador de Caso" que a tela do analista usa;
//   • as linhas já gravadas em pep_apuracao_mensal para a competência.
// Nunca apura: abrir um analista é que grava (apurarESalvarPEP). "Não apurado"
// é justamente paciente da Grade sem linha na apuração.
//
// A conta do teto fecha por construção:
//   teto = apurado + descontos e saldos + não apurado
// com teto = pacientes × V, apurado = Σ líquido, descontos = Σ (bruto − líquido)
// e não apurado = teto − Σ bruto — todos sobre os pacientes da Grade. Linha de
// paciente que não está na Grade daquele analista (trocou de analista no mês,
// saiu da agenda) fica FORA da conta e é mostrada à parte.

import type { ProfRemunReal } from "./calculo"
import { COMPETENCIA_TESTE_PEP } from "./calculoPEP"
import type { PepApuracaoLinhaCompetencia } from "@/services/pepApuracao.service"

export const ESPECIALIDADE_PEP = "Coordenador de Caso"

/** O profissional atende como Analista do Comportamento (sessão de Coordenador de Caso) no mês. */
export function ehAnalistaPep(p: Pick<ProfRemunReal, "sessoes">): boolean {
  return p.sessoes.some(s => s.especialidade === ESPECIALIDADE_PEP)
}

/** Pacientes únicos das sessões de Coordenador de Caso — os que entram na PEP dele. */
export function pacientesCCDoProfissional(p: Pick<ProfRemunReal, "sessoes">): string[] {
  return Array.from(new Set(
    p.sessoes.filter(s => s.especialidade === ESPECIALIDADE_PEP && s.paciente).map(s => s.paciente)
  )).sort((a, b) => a.localeCompare(b))
}

export type AnalistaDaGrade = { nome: string; pacientes: string[] }

/** Analistas do mês a partir da Grade, cada um com seus pacientes da PEP. */
export function analistasDaGrade(resultado: Pick<ProfRemunReal, "prof" | "sessoes">[]): AnalistaDaGrade[] {
  return resultado
    .filter(ehAnalistaPep)
    .map(p => ({ nome: p.prof, pacientes: pacientesCCDoProfissional(p) }))
    .sort((a, b) => a.nome.localeCompare(b.nome))
}

// ─── Resumo da competência ──────────────────────────────────────────────────

export type StatusApuracaoAnalista = "nao_aberto" | "parcial" | "apurado" | "liberado"

/** Ordem da tabela: o que falta fazer primeiro. */
export const ORDEM_STATUS: StatusApuracaoAnalista[] = ["nao_aberto", "parcial", "apurado", "liberado"]

export type AnalistaPep = {
  nome: string
  pacientes: number
  /** pacientes × V */
  teto: number
  /** Σ valor_bruto das linhas dos pacientes da Grade. */
  bruto: number
  /** Σ valor_liquido — o que vai ser pago. */
  apurado: number
  /** bruto − apurado: entregas faltando, saldo abatido, menos devolução. */
  descontos: number
  /** teto − bruto: pacientes da Grade ainda sem linha. */
  naoApurado: number
  /** apurado ÷ teto, em %; null quando não há teto. */
  pctTeto: number | null
  pacientesSemApuracao: string[]
  status: StatusApuracaoAnalista
}

export type LinhaForaDaGrade = { prestador: string; paciente: string; valorLiquido: number }

export type ResumoPep = {
  competencia: string
  modoTeste: boolean
  valorPorPaciente: number
  analistas: number
  pacientes: number
  pacientesPorAnalista: { media: number; min: number; max: number }
  teto: number
  apurado: number
  descontos: {
    /** Σ (bruto − líquido) — é este que fecha a conta. */
    total: number
    /** Detalhe informativo (em modo teste os ajustes existem, mas não descontam). */
    recorrentes: number
    semestrais: number
    saldoAnterior: number
    devolucao: number
  }
  naoApurado: number
  pacientesNaoApurados: number
  porStatus: Record<StatusApuracaoAnalista, number>
  /** Uma linha por analista, na ORDEM_STATUS e depois por nome. */
  porAnalista: AnalistaPep[]
  foraDaGrade: LinhaForaDaGrade[]
}

const chave = (prestador: string, paciente: string) => `${prestador}\u0000${paciente}`
const n = (v: unknown) => Number(v) || 0

export function resumoPepCompetencia({ analistas, linhas, valorPorPaciente, competencia }: {
  analistas: AnalistaDaGrade[]
  linhas: PepApuracaoLinhaCompetencia[]
  valorPorPaciente: number
  competencia: string
}): ResumoPep {
  const porChave = new Map<string, PepApuracaoLinhaCompetencia>()
  for (const l of linhas) porChave.set(chave(l.prestador_nome, l.paciente_nome), l)

  const casadas = new Set<string>()
  const descontos = { total: 0, recorrentes: 0, semestrais: 0, saldoAnterior: 0, devolucao: 0 }
  const porStatus: Record<StatusApuracaoAnalista, number> = { nao_aberto: 0, parcial: 0, apurado: 0, liberado: 0 }
  let teto = 0, apurado = 0, naoApurado = 0, pacientesNaoApurados = 0

  const porAnalista: AnalistaPep[] = analistas.map(a => {
    const tetoA = a.pacientes.length * valorPorPaciente
    let brutoA = 0, apuradoA = 0, liberadas = 0
    const semApuracao: string[] = []
    for (const paciente of a.pacientes) {
      const k = chave(a.nome, paciente)
      const l = porChave.get(k)
      if (!l) { semApuracao.push(paciente); continue }
      casadas.add(k)
      brutoA += n(l.valor_bruto)
      apuradoA += n(l.valor_liquido)
      descontos.recorrentes += n(l.ajuste_recorrentes_valor)
      descontos.semestrais += n(l.ajuste_semestrais_valor)
      descontos.saldoAnterior += n(l.saldo_remanescente_anterior)
      descontos.devolucao += n(l.devolucao_valor)
      if (l.estado === "liberado") liberadas++
    }
    const comLinha = a.pacientes.length - semApuracao.length
    const status: StatusApuracaoAnalista =
      comLinha === 0 ? "nao_aberto"
      : semApuracao.length > 0 ? "parcial"
      : liberadas === comLinha ? "liberado"
      : "apurado"

    teto += tetoA
    apurado += apuradoA
    descontos.total += brutoA - apuradoA
    naoApurado += tetoA - brutoA
    pacientesNaoApurados += semApuracao.length
    porStatus[status]++

    return {
      nome: a.nome,
      pacientes: a.pacientes.length,
      teto: tetoA,
      bruto: brutoA,
      apurado: apuradoA,
      descontos: brutoA - apuradoA,
      naoApurado: tetoA - brutoA,
      pctTeto: tetoA > 0 ? (apuradoA / tetoA) * 100 : null,
      pacientesSemApuracao: semApuracao,
      status,
    }
  })

  porAnalista.sort((x, y) =>
    ORDEM_STATUS.indexOf(x.status) - ORDEM_STATUS.indexOf(y.status) || x.nome.localeCompare(y.nome)
  )

  const foraDaGrade: LinhaForaDaGrade[] = linhas
    .filter(l => !casadas.has(chave(l.prestador_nome, l.paciente_nome)))
    .map(l => ({ prestador: l.prestador_nome, paciente: l.paciente_nome, valorLiquido: n(l.valor_liquido) }))
    .sort((a, b) => a.prestador.localeCompare(b.prestador) || a.paciente.localeCompare(b.paciente))

  const contagens = analistas.map(a => a.pacientes.length)
  const pacientes = contagens.reduce((s, x) => s + x, 0)

  return {
    competencia,
    modoTeste: competencia === COMPETENCIA_TESTE_PEP,
    valorPorPaciente,
    analistas: analistas.length,
    pacientes,
    pacientesPorAnalista: {
      media: analistas.length > 0 ? pacientes / analistas.length : 0,
      min: contagens.length > 0 ? Math.min(...contagens) : 0,
      max: contagens.length > 0 ? Math.max(...contagens) : 0,
    },
    teto,
    apurado,
    descontos,
    naoApurado,
    pacientesNaoApurados,
    porStatus,
    porAnalista,
    foraDaGrade,
  }
}
