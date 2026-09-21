// Índice mensal do histórico de Previsão de Receitas (Etapa 4, complemento) —
// 1 linha por competência, gravada pela Edge Function snapshot-previsao-receitas
// (execuções diárias normais deixam status='parcial'; o job de fechamento,
// dia 5 do mês seguinte, marca 'fechado' com os números finais).

import { getSupabaseClient } from "@/lib/supabase/client"

export interface PrevisaoReceitasResumoMes {
  competencia: string
  status: "parcial" | "fechado"
  snapshotData: string
  sessoesMes: number
  faltasMes: number
  pacientesUnicos: number
  receitaSemDeducao: number
  deducaoFalta: number
  receitaComDeducao: number
}

// Cache em memória — o dado só muda com o snapshot diário, então não há
// motivo pra refazer a query toda vez que o usuário troca de tab (historico
// x previsao-receitas) ou de mês dentro de previsao-receitas. `inflight`
// deduplica chamadas simultâneas disparadas por dois componentes montando
// quase ao mesmo tempo.
const CACHE_TTL_MS = 5 * 60 * 1000
let cache: { data: PrevisaoReceitasResumoMes[]; buscadoEm: number } | null = null
let inflight: Promise<PrevisaoReceitasResumoMes[]> | null = null

/** Retorna o cache se ainda válido, sem disparar rede. Usado pra hidratar estado inicial sem flash de loading. */
export function peekResumoHistoricoReceitasCache(): PrevisaoReceitasResumoMes[] | null {
  return cache && Date.now() - cache.buscadoEm < CACHE_TTL_MS ? cache.data : null
}

export function invalidarCacheResumoHistoricoReceitas(): void {
  cache = null
}

/** Todos os meses com resumo gravado (parcial ou fechado), mais recente primeiro. */
export async function buscarResumoHistoricoReceitas(opts?: { forceRefresh?: boolean }): Promise<PrevisaoReceitasResumoMes[]> {
  if (!opts?.forceRefresh) {
    const cached = peekResumoHistoricoReceitasCache()
    if (cached) return cached
    if (inflight) return inflight
  }

  inflight = (async () => {
    const sb = getSupabaseClient()
    const { data, error } = await sb
      .from("previsao_receitas_historico_resumo")
      .select("competencia, status, snapshot_data, sessoes_mes, faltas_mes, pacientes_unicos, receita_sem_deducao, deducao_falta, receita_com_deducao")
      .order("competencia", { ascending: false })

    if (error) throw new Error(error.message)

    const mapeado = (data ?? []).map((r: any) => ({
      competencia: r.competencia,
      status: r.status,
      snapshotData: r.snapshot_data,
      sessoesMes: r.sessoes_mes,
      faltasMes: r.faltas_mes,
      pacientesUnicos: r.pacientes_unicos,
      receitaSemDeducao: Number(r.receita_sem_deducao),
      deducaoFalta: Number(r.deducao_falta),
      receitaComDeducao: Number(r.receita_com_deducao),
    }))
    cache = { data: mapeado, buscadoEm: Date.now() }
    return mapeado
  })()

  try {
    return await inflight
  } finally {
    inflight = null
  }
}
