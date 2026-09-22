import { getSupabaseClient } from '@/lib/supabase/client'
import { parseCriterios, CRITERIOS_FALLBACK } from '@/lib/auditoria/criterios'
import type { CriteriosAuditoria, VersaoCriteriosAuditoria } from '@/types/auditoriaCriterios'

export interface CriteriosVigentesUI {
  criterios: CriteriosAuditoria
  versao: number | null
  publicadoPorNome: string | null
  publicadoEm: string | null
  notaPublicacao: string | null
  /** true quando o conteúdo veio do código, não do banco (tabela vazia/RLS/erro). */
  usandoFallback: boolean
}

const VIGENTE_FALLBACK: CriteriosVigentesUI = {
  criterios: CRITERIOS_FALLBACK,
  versao: null,
  publicadoPorNome: null,
  publicadoEm: null,
  notaPublicacao: null,
  usandoFallback: true
}

/**
 * Critérios vigentes para exibição. Falha sempre cai no fallback em código: o
 * painel é informativo e não pode ficar em branco por causa do banco.
 */
export async function buscarCriteriosVigentes(): Promise<CriteriosVigentesUI> {
  try {
    const supabase = getSupabaseClient()
    const { data, error } = await supabase
      .from('auditoria_criterios_versoes')
      .select('versao, conteudo, publicado_por_nome, publicado_em, nota_publicacao')
      .order('versao', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data) return VIGENTE_FALLBACK

    return {
      criterios: parseCriterios(data.conteudo),
      versao: data.versao,
      publicadoPorNome: data.publicado_por_nome,
      publicadoEm: data.publicado_em,
      notaPublicacao: data.nota_publicacao,
      usandoFallback: false
    }
  } catch (e) {
    console.error('[criterios] falha ao buscar vigentes:', e)
    return VIGENTE_FALLBACK
  }
}

/** Histórico, mais recente primeiro. Lista vazia se algo falhar. */
export async function listarVersoes(limite = 20): Promise<VersaoCriteriosAuditoria[]> {
  try {
    const supabase = getSupabaseClient()
    const { data, error } = await supabase
      .from('auditoria_criterios_versoes')
      .select('id, versao, conteudo, publicado_por, publicado_por_nome, publicado_em, nota_publicacao')
      .order('versao', { ascending: false })
      .limit(limite)

    if (error || !data) return []
    return data as VersaoCriteriosAuditoria[]
  } catch (e) {
    console.error('[criterios] falha ao listar versões:', e)
    return []
  }
}
