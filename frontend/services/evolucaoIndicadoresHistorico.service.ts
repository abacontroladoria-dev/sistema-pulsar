// Leitura das tabelas-resumo da evolução mensal (Ocupação Clínica e Dashboard
// de Pacientes), gravadas pela rota /api/indicadores/evolucao-snapshot.
// Mesmo padrão de previsaoReceitasHistoricoResumo.service.ts: cache de 5 min,
// `inflight` contra chamadas simultâneas e `peek…` para não piscar o carregando.
//
// Tabela ausente (o localhost usa o banco de produção, que pode ainda não ter a
// migration — 42P01/PGRST205): devolve `null` e a tela simplesmente não mostra
// o gráfico. Qualquer outro erro sobe.

import { getSupabaseClient } from "@/lib/supabase/client"
import type { LinhaOcupacaoHistorico, LinhaPacientesHistorico } from "@/lib/cronograma/evolucaoPontos"

const CACHE_TTL_MS = 5 * 60 * 1000

function tabelaAusente(e: { code?: string; message?: string }): boolean {
  return e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/i.test(e.message ?? "")
}

function criarLeitor<T>(tabela: string, colunas: string, mapear: (r: Record<string, unknown>) => T) {
  let cache: { data: T[] | null; em: number } | null = null
  let inflight: Promise<T[] | null> | null = null

  const peek = (): T[] | null | undefined => (cache && Date.now() - cache.em < CACHE_TTL_MS ? cache.data : undefined)

  const buscar = async (): Promise<T[] | null> => {
    const c = peek()
    if (c !== undefined) return c
    if (inflight) return inflight
    inflight = (async () => {
      const { data, error } = await getSupabaseClient().from(tabela).select(colunas).order("competencia")
      if (error) {
        if (tabelaAusente(error)) { cache = { data: null, em: Date.now() }; return null }
        throw new Error(error.message)
      }
      const linhas = ((data ?? []) as unknown as Record<string, unknown>[]).map(mapear)
      cache = { data: linhas, em: Date.now() }
      return linhas
    })()
    try { return await inflight } finally { inflight = null }
  }
  return { peek, buscar }
}

export const historicoOcupacao = criarLeitor<LinhaOcupacaoHistorico>(
  "ocupacao_clinica_historico_resumo",
  "competencia, unidade, total, paciente, aberta, administrativo, regularizar, vazia, status",
  r => ({
    competencia: String(r.competencia), unidade: String(r.unidade),
    total: Number(r.total), paciente: Number(r.paciente), aberta: Number(r.aberta),
    administrativo: Number(r.administrativo), regularizar: Number(r.regularizar), vazia: Number(r.vazia),
    status: r.status as LinhaOcupacaoHistorico["status"],
  }),
)

export const historicoPacientes = criarLeitor<LinhaPacientesHistorico>(
  "pacientes_historico_resumo",
  "competencia, segmento, unidade, pacientes, sessoes, horas, status",
  r => ({
    competencia: String(r.competencia), segmento: r.segmento as LinhaPacientesHistorico["segmento"], unidade: String(r.unidade),
    pacientes: Number(r.pacientes), sessoes: Number(r.sessoes), horas: Number(r.horas),
    status: r.status as LinhaPacientesHistorico["status"],
  }),
)
