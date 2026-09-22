import type { SupabaseClient } from '@supabase/supabase-js'
import type { FraseCadastrada } from '../agente/origem-campanha'

// ============================================================================
// CampaignPhraseRepository
//
// central.campaign_phrases — o catálogo de frases pré-preenchidas por
// anúncio (migration 20260922100200), consultado pelo matcher de campanha
// (agente/origem-campanha.ts, Regra 5). Mantido pelo marketing; nesta
// primeira entrega, por migration/SQL direto — sem tela de administração.
// ============================================================================

const COLUNAS = 'origem_tag, frase_exata, campanha, pronta_para_match'

export class CampaignPhraseRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listar(orgId: string): Promise<FraseCadastrada[]> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('campaign_phrases')
      .select(COLUNAS)
      .eq('organization_id', orgId)

    if (error) throw error

    return ((data ?? []) as {
      origem_tag: string
      frase_exata: string | null
      campanha: string
      pronta_para_match: boolean
    }[]).map((f) => ({
      origemTag:       f.origem_tag,
      fraseExata:      f.frase_exata,
      campanha:        f.campanha,
      prontaParaMatch: f.pronta_para_match,
    }))
  }
}
