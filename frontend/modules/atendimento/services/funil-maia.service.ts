import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================================
// A Maia move o card do funil (crm.deals)
//
// Toda a regra — só avança, não passa de "Agendamento", encerra só até
// Apresentação, respeita a trilha, exige motivo onde a coluna exige — mora em
// crm.maia_mover_negocio (20261022110000). Aqui só se chama e se traduz o
// código de volta. Mesma razão das ferramentas de agenda: se a regra tivesse
// duas cópias, as duas superfícies discordariam um dia.
//
// Também é por aqui que o worker do funil (workers/funil.worker.ts) lista os
// cards abertos e grava a leitura (funil_ia_*, 20261022140000).
//
// Precisa de cliente service role: a função só tem EXECUTE para service_role.
// ============================================================================

export type ResultadoFunil =
  | 'movido'
  | 'ja_esta'
  | 'sem_negocio'
  | 'posicao_inexistente'
  | 'posicao_nao_permitida'
  | 'nao_volta'
  | 'trilha_diferente'
  | 'falta_motivo'

// Um card aberto com o que a leitura precisa da conversa dele.
export interface CardParaLeitura {
  id:              string
  contactId:       string
  conversationId:  string
  etapa:           string | null
  trilha:          'particular' | 'convenio' | null
  funil_ia_ate:    string | null
  last_message_at: string | null
  tags:            string[]
}

export interface LeituraFunilColunas {
  funil_ia_ate:       string | null
  funil_ia_etapa:     string
  funil_ia_confianca: number
  funil_ia_motivo:    string
  funil_ia_em:        string
}

export class FunilMaiaService {
  constructor(private readonly supabase: SupabaseClient) {}

  async mover(orgId: string, contactId: string, slug: string, motivo: string | null): Promise<ResultadoFunil> {
    const { data, error } = await this.supabase
      .schema('crm')
      .rpc('maia_mover_negocio', {
        p_org:     orgId,
        p_contato: contactId,
        p_slug:    slug,
        p_motivo:  motivo,
      })
    if (error) throw new Error(`[funil] maia_mover_negocio: ${error.message}`)
    return data as ResultadoFunil
  }

  // Cards abertos com conversa, mais nova primeiro. Fora: contato vinculado a
  // paciente do TiTa — conversa de paciente não é venda; o ganho dele vem da
  // 1ª presença (crm.funil_regras_do_sistema).
  //
  // Três consultas, não um embed: o PostgREST não embute entre schemas (crm →
  // central dá PGRST200).
  async listarAbertosParaLeitura(orgId: string, limite: number): Promise<CardParaLeitura[]> {
    const { data: deals, error } = await this.supabase
      .schema('crm')
      .from('deals')
      .select('id, contact_id, conversation_id, trilha, funil_ia_ate, stage:pipeline_stages!inner(slug)')
      .eq('organization_id', orgId)
      .eq('status', 'open')
      .not('conversation_id', 'is', null)
      .not('contact_id', 'is', null)
      .limit(limite)
    if (error) throw new Error(`[funil] deals abertos: ${error.message}`)
    const linhas = (deals ?? []) as unknown as Array<{
      id: string; contact_id: string; conversation_id: string
      trilha: 'particular' | 'convenio' | null; funil_ia_ate: string | null
      stage: { slug: string | null } | { slug: string | null }[] | null
    }>
    if (linhas.length === 0) return []

    const [{ data: convs, error: eConv }, { data: links, error: eLink }] = await Promise.all([
      this.supabase
        .schema('central')
        .from('conversations')
        .select('id, last_message_at, tags')
        .in('id', linhas.map((d) => d.conversation_id)),
      this.supabase
        .schema('central')
        .from('contact_patient_links')
        .select('contact_id')
        .eq('organization_id', orgId)
        .in('contact_id', linhas.map((d) => d.contact_id)),
    ])
    if (eConv) throw new Error(`[funil] conversas dos cards: ${eConv.message}`)
    if (eLink) throw new Error(`[funil] vínculos dos cards: ${eLink.message}`)

    const porConversa = new Map(
      ((convs ?? []) as Array<{ id: string; last_message_at: string | null; tags: string[] | null }>)
        .map((c) => [c.id, c]),
    )
    const vinculados = new Set(((links ?? []) as Array<{ contact_id: string }>).map((l) => l.contact_id))

    return linhas
      .filter((d) => !vinculados.has(d.contact_id) && porConversa.has(d.conversation_id))
      .map((d) => {
        const conv = porConversa.get(d.conversation_id)!
        const stage = Array.isArray(d.stage) ? d.stage[0] : d.stage
        return {
          id:              d.id,
          contactId:       d.contact_id,
          conversationId:  d.conversation_id,
          etapa:           stage?.slug ?? null,
          trilha:          d.trilha,
          funil_ia_ate:    d.funil_ia_ate,
          last_message_at: conv.last_message_at,
          tags:            conv.tags ?? [],
        }
      })
      .sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''))
  }

  async gravarLeitura(dealId: string, colunas: LeituraFunilColunas): Promise<void> {
    const { error } = await this.supabase
      .schema('crm')
      .from('deals')
      .update(colunas)
      .eq('id', dealId)
    if (error) throw new Error(`[funil] gravar leitura: ${error.message}`)
  }
}
