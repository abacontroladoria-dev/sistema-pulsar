import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseService } from '@/lib/supabase/service'
import { auditarEPersistir, buscarGradesPorId } from './auditarEPersistir'
import { carregarCriteriosVigentes } from './criterios'

/**
 * Processa a fila da reauditoria (tabela auditoria_reauditoria_fila).
 *
 * Quem chama: a rota do tique (pg_cron, a cada minuto) e o despacho em
 * processo logo depois de enfileirar. Os dois podem rodar ao mesmo tempo sem
 * lock próprio: `reservar_lote_reauditoria` usa FOR UPDATE SKIP LOCKED, e item
 * de worker que morreu volta pelo prazo de reserva (3 min).
 */

/** Chamadas à OpenAI em voo por rodada. */
export const CONCORRENCIA = 5

/**
 * Para de RESERVAR depois disto. Uma rodada já reservada ainda pode levar até
 * o timeout da IA (45s); o prazo de reserva de 3 min cobre essa sobra.
 */
const ORCAMENTO_PADRAO_MS = 30_000

/** Espera antes de tentar de novo: 1 min, depois 2 min. */
const esperaAposFalha = (tentativas: number) => new Date(Date.now() + tentativas * 60_000).toISOString()

interface ItemFila {
  id: number
  grade_id: string
  tentativas: number
  max_tentativas: number
}

export interface ResultadoTique {
  reservados: number
  feitos: number
  reagendados: number
  falharam: number
  duracaoMs: number
}

export async function processarFilaReauditoria(
  supabase: SupabaseClient,
  orcamentoMs = ORCAMENTO_PADRAO_MS
): Promise<ResultadoTique> {
  const inicio = Date.now()
  const r: ResultadoTique = { reservados: 0, feitos: 0, reagendados: 0, falharam: 0, duracaoMs: 0 }

  // Uma leitura por tique: se publicarem versão nova no meio, o próximo tique
  // já pega — e cada linha grava a versão com que foi de fato auditada.
  let criterios: Awaited<ReturnType<typeof carregarCriteriosVigentes>> | null = null

  while (Date.now() - inicio < orcamentoMs) {
    const { data, error } = await supabase.rpc('reservar_lote_reauditoria', { p_tamanho: CONCORRENCIA })
    if (error) throw new Error(`reservar_lote_reauditoria: ${error.message}`)
    const itens = (data ?? []) as ItemFila[]
    if (itens.length === 0) break
    r.reservados += itens.length

    criterios ??= await carregarCriteriosVigentes(supabase)
    const grades = await buscarGradesPorId(supabase, itens.map(i => i.grade_id))
    const { processados, falhas } = await auditarEPersistir(supabase, grades, {
      concorrencia: CONCORRENCIA,
      criterios
    })

    const ok = new Set(processados.map(p => p.grade_id as string))
    const motivos = new Map(falhas.map(f => [f.grade_id, f.motivo]))
    const existentes = new Set(grades.map(g => g.id))
    const agora = new Date().toISOString()

    const feitos = itens.filter(i => ok.has(i.grade_id)).map(i => i.id)
    if (feitos.length > 0) {
      const { error: e } = await supabase
        .from('auditoria_reauditoria_fila')
        .update({ status: 'feito', erro: null, concluido_em: agora, updated_at: agora })
        .in('id', feitos)
      if (e) console.error('[fila reauditoria] falha ao marcar feitos:', e.message)
      r.feitos += feitos.length
    }

    for (const item of itens.filter(i => !ok.has(i.grade_id))) {
      // Evolução inativada ou sem texto não melhora com nova tentativa.
      const sumiu = !existentes.has(item.grade_id)
      const definitivo = sumiu || item.tentativas >= item.max_tentativas
      const erro = sumiu
        ? 'evolução não encontrada, inativa ou sem texto'
        : (motivos.get(item.grade_id) ?? 'falha desconhecida')
      const { error: e } = await supabase
        .from('auditoria_reauditoria_fila')
        .update(
          definitivo
            ? { status: 'falhou', erro, concluido_em: agora, updated_at: agora }
            : { status: 'pendente', erro, reservado_em: null, disponivel_em: esperaAposFalha(item.tentativas), updated_at: agora }
        )
        .eq('id', item.id)
      if (e) console.error('[fila reauditoria] falha ao registrar falha:', e.message)
      if (definitivo) r.falharam++
      else r.reagendados++
    }
  }

  r.duracaoMs = Date.now() - inicio
  return r
}

let despachoEmCurso = false

/**
 * Começa a processar logo depois de enfileirar, sem esperar o cron (até 1 min).
 *
 * Em processo, como lib/central/despachar-worker.ts: HTTP para a própria rota
 * precisaria da URL pública e do segredo, sem acrescentar nada. Roda até a fila
 * esvaziar. Um despacho por processo; o cron e este podem se cruzar sem risco.
 */
export function despacharFilaReauditoria(): void {
  if (despachoEmCurso) return
  despachoEmCurso = true
  const timer = setTimeout(async () => {
    try {
      for (;;) {
        const r = await processarFilaReauditoria(supabaseService)
        if (r.reservados === 0) break
      }
    } catch (err) {
      // Aceleração, não o caminho garantido: o cron recupera. Deixar a exceção
      // subir num setTimeout derrubaria o processo Node inteiro.
      console.error('[fila reauditoria] despacho falhou; o cron recupera', err)
    } finally {
      despachoEmCurso = false
    }
  }, 0)
  timer.unref?.()
}
