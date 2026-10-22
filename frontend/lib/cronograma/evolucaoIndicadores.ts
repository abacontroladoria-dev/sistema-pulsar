// ─── Evolução mensal de Ocupação Clínica (A15) e Pacientes (A16) ────────────
//
// Parte PURA do retrato mensal: recebe as linhas já lidas e devolve as linhas
// das tabelas-resumo. Usa EXATAMENTE os motores das telas — calcularOcupacaoDaSala
// + calcularOcupacaoClinica (Ocupação Clínica) e calcularDashboardPacientes
// (Dashboard de Pacientes) — para o gráfico nunca divergir do número da tela.
// Decisão de 21/10/2026: nada de cópia em Deno; a leitura do banco e a
// gravação ficam em evolucaoSnapshot.server.ts, chamado pela rota
// /api/indicadores/evolucao-snapshot.
//
// Ocupação: o motor é SEMANAL e trabalha por dia da semana (dow), não por
// data. O mês vira a soma das semanas (seg–sáb) que o tocam, e os dias de
// cada semana que caem FORA do mês entram como "fechados" — o mesmo mecanismo
// do feriado (FechamentoDia): a vaga e a sessão desse dia saem da conta. Assim
// a semana partida da virada do mês conta só os seus dias. Feriado do mês
// também sai, como na tela.

import {
  calcularOcupacaoClinica, contagemVazia, fechamentosDaSemana, somarContagens,
  type ContagemCadeiras, type FechamentoDia, type FeriadoSemana,
} from "./ocupacaoClinica"
import { calcularOcupacaoDaSala, construirNomeDaSalaPorId } from "./salas"
import { construirIndiceExclusividadeTerapia } from "./exclusividadeTerapia"
import { calcularDashboardPacientes } from "./pacientesDashboard"
import type { AgendaSalaRow, AlocacaoSala, Sala, SalaTerapiaExclusiva } from "./salasTypes"

/** Chave da linha "rede" (soma das unidades próprias) na tabela de ocupação. */
export const UNIDADE_REDE = "__rede__"
/** Chave da linha "total" (pacientes únicos no total, não a soma) na tabela de pacientes. */
export const UNIDADE_TOTAL = "__total__"
/**
 * Prefixo das linhas por procedimento do Processo Diagnóstico na coluna
 * `unidade` da tabela de pacientes ("proc:Triagem"). Mesma tabela, sem coluna
 * nova: o prefixo não colide com nome de unidade (pedido de 22/10/2026).
 */
export const PREFIXO_PROCEDIMENTO = "proc:"

export type StatusRetrato = "parcial" | "fechado" | "aproximado"

// ─── Datas (texto "AAAA-MM-DD", aritmética em UTC: sem fuso no meio) ────────

function somarDiasIso(iso: string, dias: number): string {
  const [a, m, d] = iso.split("-").map(Number)
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10)
}

function dowIso(iso: string): number {
  const [a, m, d] = iso.split("-").map(Number)
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay() // 0 = domingo
}

/** Primeiro e último dia da competência "AAAA-MM". */
export function limitesDaCompetencia(competencia: string): { inicio: string; fim: string } {
  const [a, m] = competencia.split("-").map(Number)
  const inicio = `${competencia}-01`
  const fim = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10)
  return { inicio, fim }
}

/** Semanas (segunda a sábado) que tocam a competência, em ordem. */
export function semanasDaCompetencia(competencia: string): { inicio: string; fim: string }[] {
  const { inicio, fim } = limitesDaCompetencia(competencia)
  let seg = somarDiasIso(inicio, -((dowIso(inicio) + 6) % 7))
  const out: { inicio: string; fim: string }[] = []
  while (seg <= fim) {
    const sab = somarDiasIso(seg, 5)
    // Semana cujo único dia do mês é domingo não tem dia útil: pula.
    if (sab >= inicio) out.push({ inicio: seg, fim: sab })
    seg = somarDiasIso(seg, 7)
  }
  return out
}

/** Dias (dow 1–6) da semana que caem fora da competência — fechados o dia todo. */
export function fechamentosForaDoMes(semanaInicio: string, competencia: string): FechamentoDia[] {
  const out: FechamentoDia[] = []
  for (let dow = 1; dow <= 6; dow++) {
    const dia = somarDiasIso(semanaInicio, dow - 1)
    if (dia.slice(0, 7) !== competencia) out.push({ dow, inicio: 0, fim: 24 * 60, nome: "Fora do mês" })
  }
  return out
}

/** Dias de segunda a sábado da competência que não são feriado integral. */
export function diasUteisDaCompetencia(competencia: string, feriados: FeriadoSemana[]): number {
  const { inicio, fim } = limitesDaCompetencia(competencia)
  const integrais = new Set(feriados.filter(f => (f.tipo ?? "").toLowerCase() !== "parcial").map(f => f.data))
  let n = 0
  for (let d = inicio; d <= fim; d = somarDiasIso(d, 1)) {
    if (dowIso(d) !== 0 && !integrais.has(d)) n++
  }
  return n
}

// ─── Ocupação Clínica ────────────────────────────────────────────────────────

export interface OcupacaoMesEntrada {
  competencia: string
  salas: Sala[]
  alocacoes: AlocacaoSala[]
  exclusividades: SalaTerapiaExclusiva[]
  /** Linhas para a ocupação (linhasAgendaParaSalasDe) de TODAS as semanas do mês. */
  linhas: AgendaSalaRow[]
  /** Bloqueios administrativos (turnosBloqueioAdministrativoDe) do mesmo período. */
  turnosBloqueioAdmin: AgendaSalaRow[]
  /** Feriados do período das semanas (seg da 1ª a sáb da última). */
  feriados: FeriadoSemana[]
}

export interface LinhaOcupacaoMes {
  unidade: string
  terceirizada: boolean
  contagem: ContagemCadeiras
  dias: number
}

function naSemana(r: AgendaSalaRow, semana: { inicio: string; fim: string }): boolean {
  const d = String(r.data ?? "").slice(0, 10)
  return d >= semana.inicio && d <= semana.fim
}

/**
 * Ocupação do mês por unidade (+ a linha da rede). Cada semana roda o motor
 * da tela com o mapa de salas informado; as contagens se somam.
 */
export function ocupacaoDaCompetencia(e: OcupacaoMesEntrada): LinhaOcupacaoMes[] {
  const indice = construirIndiceExclusividadeTerapia(e.exclusividades)
  const nomeDaSala = construirNomeDaSalaPorId(e.salas)
  const porUnidade = new Map<string, { terceirizada: boolean; contagens: ContagemCadeiras[] }>()

  for (const semana of semanasDaCompetencia(e.competencia)) {
    const linhas = e.linhas.filter(r => naSemana(r, semana))
    const turnos = e.turnosBloqueioAdmin.filter(r => naSemana(r, semana))
    const feriadosSemana = e.feriados.filter(f => f.data >= semana.inicio && f.data <= semana.fim)
    const fechamentos = [...fechamentosDaSemana(feriadosSemana, semana.inicio), ...fechamentosForaDoMes(semana.inicio, e.competencia)]
    const salasComOcupacao = e.salas.map(sala => calcularOcupacaoDaSala(sala, e.alocacoes, linhas, indice, nomeDaSala))
    for (const u of calcularOcupacaoClinica(salasComOcupacao, linhas, turnos, fechamentos)) {
      const acc = porUnidade.get(u.unidade) ?? { terceirizada: u.terceirizada, contagens: [] }
      acc.contagens.push(u.contagem)
      porUnidade.set(u.unidade, acc)
    }
  }

  const dias = diasUteisDaCompetencia(e.competencia, e.feriados)
  const unidades: LinhaOcupacaoMes[] = [...porUnidade.entries()].map(([unidade, acc]) => ({
    unidade, terceirizada: acc.terceirizada, contagem: somarContagens(acc.contagens), dias,
  }))
  // Rede = só as unidades próprias (terceirizadas fora), como totalDaRede na tela.
  const rede = somarContagens(unidades.filter(u => !u.terceirizada).map(u => u.contagem))
  return [...unidades, { unidade: UNIDADE_REDE, terceirizada: false, contagem: unidades.length ? rede : contagemVazia(), dias }]
}

// ─── Pacientes ───────────────────────────────────────────────────────────────

export type SegmentoEvolucao = "multidisciplinar" | "diagnostico"

export interface LinhaPacientesMes {
  segmento: SegmentoEvolucao
  unidade: string
  pacientes: number
  sessoes: number
  horas: number
}

/**
 * Pacientes/sessões/horas do mês por segmento e unidade, pelo motor do
 * Dashboard de Pacientes com o período do mês inteiro. A linha "total" usa os
 * pacientes ÚNICOS do segmento (quem vai a duas unidades conta uma vez), não a
 * soma das unidades. `rows` = buscarLinhasPacientesPeriodo do mês (já sem
 * fictícios e sem a importação duplicada de 23–30/06).
 *
 * No Processo Diagnóstico vão também as linhas por procedimento (Avaliação
 * Neuropsicológica, Psiquiatra/Neurologista, Triagem — sempre as três), com a
 * chave PREFIXO_PROCEDIMENTO + nome. Elas detalham o mesmo total: quem fez dois
 * procedimentos conta nos dois, mas uma vez só no total.
 */
export function pacientesDaCompetencia(rows: AgendaSalaRow[], competencia: string): LinhaPacientesMes[] {
  const periodo = limitesDaCompetencia(competencia)
  const d = calcularDashboardPacientes(rows, null, periodo)
  const out: LinhaPacientesMes[] = []
  const segmentos: [SegmentoEvolucao, typeof d.multidisciplinar][] = [["multidisciplinar", d.multidisciplinar], ["diagnostico", d.processoDiagnostico]]
  for (const [segmento, r] of segmentos) {
    for (const u of r.porUnidade) {
      out.push({ segmento, unidade: u.chave, pacientes: u.pacientesUnicos, sessoes: u.sessoesTotal, horas: u.chSemanalTotal * r.semanas })
    }
    if (segmento === "diagnostico") {
      for (const p of r.porProcedimento) {
        out.push({ segmento, unidade: PREFIXO_PROCEDIMENTO + p.chave, pacientes: p.pacientesUnicos, sessoes: p.sessoesTotal, horas: p.chSemanalTotal * r.semanas })
      }
    }
    out.push({ segmento, unidade: UNIDADE_TOTAL, pacientes: r.pacientesUnicos, sessoes: r.sessoesTotal, horas: r.chTotalPeriodo })
  }
  return out
}
