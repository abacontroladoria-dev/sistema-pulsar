// Linhas das tabelas-resumo → pontos do EvolucaoMensalChart (Ocupação Clínica
// e Dashboard de Pacientes). Puro: as telas só chamam e desenham.

import { UNID_COR } from "./constants"
import { UNIDADE_REDE, UNIDADE_TOTAL, type SegmentoEvolucao } from "./evolucaoIndicadores"
import type { MetricaEvolucao, PontoEvolucao, SerieEvolucao, StatusPonto } from "@/components/cronograma/indicadores/evolucao/EvolucaoMensalChart"

/** Ordem fixa (a cor acompanha a unidade, nunca a posição) — mesma do validador de paleta. */
export const UNIDADES_EVOLUCAO = ["Fazendinha", "Padre Miguel", "Realengo"] as const

function seriesUnidades(totalKey: string, totalLabel: string): SerieEvolucao[] {
  return [
    ...UNIDADES_EVOLUCAO.map(u => ({ key: u, label: u, cor: UNID_COR[u] })),
    { key: totalKey, label: totalLabel, cor: "var(--foreground)", destaque: true },
  ]
}

// ─── Ocupação Clínica ────────────────────────────────────────────────────────

export interface LinhaOcupacaoHistorico {
  competencia: string
  unidade: string
  total: number
  paciente: number
  aberta: number
  administrativo: number
  regularizar: number
  vazia: number
  status: StatusPonto
}

export const SERIES_OCUPACAO = seriesUnidades(UNIDADE_REDE, "Total")

// Base comum dos percentuais: as vagas de 40 min das salas EM USO (fora
// administrativas, NTI e bloqueadas), só nos dias e turnos em que cada sala
// funciona, sem feriados. Vaga = lugar de um profissional na sala naquele
// horário (individual 1, dupla 2, múltipla 3).
const BASE_VAGAS = "Conta sobre as vagas de 40 min das salas em uso (salas administrativas, de NTI e bloqueadas ficam fora), só nos dias e turnos em que cada sala funciona, sem feriados. Sala individual tem 1 vaga por horário, dupla 2, múltipla 3."

export const METRICAS_OCUPACAO: MetricaEvolucao[] = [
  {
    key: "pctPaciente", label: "% com paciente", formato: "pct",
    info: `Das vagas, quantas tiveram sessão com paciente. Sessão em grupo conta 1 vaga. ${BASE_VAGAS} Exemplo: 8 salas individuais funcionando manhã e tarde; se 3 delas têm paciente o dia todo e as outras 5 nunca têm, dá 3 ÷ 8 = 37,5%.`,
  },
  {
    key: "pctProfissional", label: "% com profissional", formato: "pct",
    info: `Das vagas, quantas têm um profissional reservado na sala, com ou sem paciente. ${BASE_VAGAS} Exemplo: 8 salas individuais funcionando manhã e tarde; 2 têm profissional o dia todo → 2 ÷ 8 = 25%. Se esses 2 ficam só de manhã → 12,5%. Numa sala dupla, 1 profissional ocupa metade das vagas dela.`,
  },
  {
    key: "aproveitamento", label: "Aproveitamento", formato: "pct",
    info: "Do tempo em que há profissional na sala, quanto é com paciente (% com paciente ÷ % com profissional). Exemplo: em 10 horários com profissional na sala, 7 foram com paciente e 3 ficaram com agenda livre, administrativo ou reserva sem agenda → 7 ÷ 10 = 70%.",
  },
  {
    key: "vagasLivres", label: "Vagas livres", formato: "int",
    info: "Quantidade de vagas sem nenhum profissional reservado no mês — nelas não dá para agendar sem antes colocar alguém na sala. Não é o mesmo que \"Livre para agendar\" (profissional na sala, sem paciente). Exemplo: uma sala dupla sem ninguém num horário conta 2 vagas livres naquele horário; o mês soma todos os horários.",
  },
]

function metricasDaContagem(l: LinhaOcupacaoHistorico): Record<string, number | null> {
  const comProfissional = l.paciente + l.aberta + l.administrativo + l.regularizar
  return {
    pctPaciente: l.total > 0 ? l.paciente / l.total : null,
    pctProfissional: l.total > 0 ? comProfissional / l.total : null,
    aproveitamento: comProfissional > 0 ? l.paciente / comProfissional : null,
    vagasLivres: l.vazia,
  }
}

export function montarPontosOcupacao(linhas: LinhaOcupacaoHistorico[]): PontoEvolucao[] {
  const porMes = new Map<string, PontoEvolucao>()
  for (const l of linhas) {
    const p = porMes.get(l.competencia) ?? { competencia: l.competencia, status: l.status, valores: {} }
    p.valores[l.unidade] = metricasDaContagem(l)
    // O status do mês é o da linha da rede (todas as linhas do mês saem juntas).
    if (l.unidade === UNIDADE_REDE) p.status = l.status
    porMes.set(l.competencia, p)
  }
  return [...porMes.values()].sort((a, b) => a.competencia.localeCompare(b.competencia))
}

// ─── Pacientes ───────────────────────────────────────────────────────────────

export interface LinhaPacientesHistorico {
  competencia: string
  segmento: SegmentoEvolucao
  unidade: string
  pacientes: number
  sessoes: number
  horas: number
  status: StatusPonto
}

export const SERIES_PACIENTES = seriesUnidades(UNIDADE_TOTAL, "Total")

export const METRICAS_PACIENTES: MetricaEvolucao[] = [
  {
    key: "pacientes", label: "Pacientes ativos", formato: "int",
    info: "Pacientes diferentes com pelo menos uma sessão agendada no mês (faltas e cancelamentos contam). No Total, cada paciente conta uma vez, mesmo indo a mais de uma unidade. Exemplo: Ana vai a Realengo e Fazendinha e Bia só a Realengo → Realengo 2, Fazendinha 1, Total 2.",
  },
  {
    key: "sessoes", label: "Sessões no mês", formato: "int",
    info: "Quantidade de sessões agendadas no mês (faltas e cancelamentos contam). Exemplo: um paciente com 3 sessões por semana, num mês de 4 semanas, soma 12 sessões.",
  },
  {
    key: "horas", label: "CH no mês", formato: "horas",
    info: "Carga horária: a duração das sessões do mês somada. Exemplo: 12 sessões de 40 min = 480 min = 8h.",
  },
]

export function montarPontosPacientes(linhas: LinhaPacientesHistorico[], segmento: SegmentoEvolucao): PontoEvolucao[] {
  const porMes = new Map<string, PontoEvolucao>()
  for (const l of linhas) {
    if (l.segmento !== segmento) continue
    const p = porMes.get(l.competencia) ?? { competencia: l.competencia, status: l.status, valores: {} }
    p.valores[l.unidade] = { pacientes: l.pacientes, sessoes: l.sessoes, horas: l.horas }
    if (l.unidade === UNIDADE_TOTAL) p.status = l.status
    porMes.set(l.competencia, p)
  }
  return [...porMes.values()].sort((a, b) => a.competencia.localeCompare(b.competencia))
}
