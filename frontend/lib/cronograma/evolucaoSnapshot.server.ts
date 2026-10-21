import "server-only"

// Retrato mensal da evolução (Ocupação Clínica e Dashboard de Pacientes) —
// lê o banco com a chave de serviço, calcula com os motores das telas
// (evolucaoIndicadores.ts) e grava nas tabelas-resumo. Chamado pela rota
// /api/indicadores/evolucao-snapshot (pg_cron diário, fechamento do dia 5 e a
// carga do passado). Só escreve nas duas tabelas-resumo; não toca em mais nada.

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  buscarGradeParaSalas, buscarLinhasPacientesPeriodo, linhasAgendaParaSalasDe, listarAlocacoes,
  listarExclusividadesTerapia, listarSalas, turnosBloqueioAdministrativoDe,
} from "@/services/salas.service"
import { listarFeriadosDoPeriodo } from "@/services/feriados.service"
import {
  limitesDaCompetencia, ocupacaoDaCompetencia, pacientesDaCompetencia, semanasDaCompetencia, type StatusRetrato,
} from "./evolucaoIndicadores"

export const TABELA_OCUPACAO = "ocupacao_clinica_historico_resumo"
export const TABELA_PACIENTES = "pacientes_historico_resumo"

export interface OpcoesRetrato {
  /** Fechamento do mês (dia 5 do seguinte, ou carga do passado de Pacientes). */
  fechamento?: boolean
  /** Ocupação recalculada com o mapa de salas ATUAL (carga do passado). */
  aproximado?: boolean
  /** Qual indicador gravar (padrão: os dois). */
  ocupacao?: boolean
  pacientes?: boolean
}

export interface ResultadoRetrato {
  competencia: string
  ocupacao?: number
  pacientes?: number
  erro?: string
}

/** Grava as linhas da competência e apaga as que sumiram (unidade que deixou de existir). */
async function substituirCompetencia(sb: SupabaseClient, tabela: string, competencia: string, linhas: Record<string, unknown>[], chaves: string[]) {
  if (linhas.length) {
    const { error } = await sb.from(tabela).upsert(linhas, { onConflict: ["competencia", ...chaves].join(",") })
    if (error) throw new Error(`${tabela}: ${error.message}`)
  }
  const { data: existentes, error: eSel } = await sb.from(tabela).select(chaves.join(",")).eq("competencia", competencia)
  if (eSel) throw new Error(`${tabela}: ${eSel.message}`)
  const vivas = new Set(linhas.map(l => chaves.map(k => String(l[k])).join("|")))
  for (const r of (existentes ?? []) as unknown as Record<string, unknown>[]) {
    if (vivas.has(chaves.map(k => String(r[k])).join("|"))) continue
    let q = sb.from(tabela).delete().eq("competencia", competencia)
    for (const k of chaves) q = q.eq(k, r[k] as string)
    const { error } = await q
    if (error) throw new Error(`${tabela}: ${error.message}`)
  }
}

export async function retratoOcupacao(sb: SupabaseClient, competencia: string, status: StatusRetrato, hoje: string): Promise<number> {
  const semanas = semanasDaCompetencia(competencia)
  const de = semanas[0].inicio
  const ate = semanas[semanas.length - 1].fim
  // Uma leitura da grade para as duas derivações (a tela faz duas).
  const [salas, alocacoes, exclusividades, grade, feriados] = await Promise.all([
    listarSalas(sb), listarAlocacoes(sb), listarExclusividadesTerapia(sb),
    buscarGradeParaSalas(de, ate, sb), listarFeriadosDoPeriodo(de, ate, sb),
  ])
  const linhas = ocupacaoDaCompetencia({
    competencia, salas, alocacoes, exclusividades, feriados,
    linhas: linhasAgendaParaSalasDe(grade), turnosBloqueioAdmin: turnosBloqueioAdministrativoDe(grade),
  })
  const agora = new Date().toISOString()
  await substituirCompetencia(sb, TABELA_OCUPACAO, competencia, linhas.map(l => ({
    competencia, unidade: l.unidade, terceirizada: l.terceirizada,
    total: l.contagem.total, paciente: l.contagem.paciente, aberta: l.contagem.aberta,
    administrativo: l.contagem.administrativo, regularizar: l.contagem.regularizar, vazia: l.contagem.vazia,
    dias: l.dias, status, snapshot_data: hoje, atualizado_em: agora,
  })), ["unidade"])
  return linhas.length
}

export async function retratoPacientes(sb: SupabaseClient, competencia: string, status: Exclude<StatusRetrato, "aproximado">, hoje: string): Promise<number> {
  const { inicio, fim } = limitesDaCompetencia(competencia)
  const rows = await buscarLinhasPacientesPeriodo(inicio, fim, sb)
  const linhas = pacientesDaCompetencia(rows, competencia)
  const agora = new Date().toISOString()
  await substituirCompetencia(sb, TABELA_PACIENTES, competencia, linhas.map(l => ({
    competencia, segmento: l.segmento, unidade: l.unidade,
    pacientes: l.pacientes, sessoes: l.sessoes, horas: Math.round(l.horas * 100) / 100,
    status, snapshot_data: hoje, atualizado_em: agora,
  })), ["segmento", "unidade"])
  return linhas.length
}

/** Calcula e grava as competências pedidas, uma de cada vez. Nunca lança: o erro volta no resultado. */
export async function gerarRetratosEvolucao(sb: SupabaseClient, competencias: string[], opcoes: OpcoesRetrato, hoje: string): Promise<ResultadoRetrato[]> {
  const fazerOcupacao = opcoes.ocupacao !== false
  const fazerPacientes = opcoes.pacientes !== false
  const statusOcupacao: StatusRetrato = opcoes.aproximado ? "aproximado" : opcoes.fechamento ? "fechado" : "parcial"
  const statusPacientes = opcoes.fechamento ? "fechado" : "parcial"
  const out: ResultadoRetrato[] = []
  for (const competencia of competencias) {
    const r: ResultadoRetrato = { competencia }
    try {
      if (fazerOcupacao) r.ocupacao = await retratoOcupacao(sb, competencia, statusOcupacao, hoje)
      if (fazerPacientes) r.pacientes = await retratoPacientes(sb, competencia, statusPacientes, hoje)
    } catch (e) {
      r.erro = e instanceof Error ? e.message : String(e)
      console.error(`[evolucao-snapshot] ${competencia}:`, r.erro)
    }
    out.push(r)
  }
  return out
}
