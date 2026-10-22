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
// cards que precisam de leitura e grava a leitura (funil_ia_*, 20261022140000
// e 20261022150000).
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

  // Só os cards que precisam de leitura, mais nova primeiro — o filtro é do
  // banco (crm.funil_cards_para_ler, 20261022150000): marca d'água, calma,
  // contato vinculado a paciente fora. A conversa é a MAIS RECENTE do contato,
  // não a do card: deals.conversation_id fica na conversa em que ele nasceu.
  async listarParaLeitura(orgId: string, limite: number, calmaMs: number): Promise<CardParaLeitura[]> {
    const { data, error } = await this.supabase
      .schema('crm')
      .rpc('funil_cards_para_ler', {
        p_org:    orgId,
        p_limite: limite,
        p_calma:  `${Math.round(calmaMs / 1000)} seconds`,
      })
    if (error) throw new Error(`[funil] funil_cards_para_ler: ${error.message}`)
    return ((data ?? []) as Array<{
      deal_id: string; contact_id: string; conversation_id: string; etapa: string | null
      trilha: string | null; funil_ia_ate: string | null; last_message_at: string | null; tags: string[] | null
    }>).map((d) => ({
      id:              d.deal_id,
      contactId:       d.contact_id,
      conversationId:  d.conversation_id,
      etapa:           d.etapa,
      trilha:          d.trilha === 'particular' || d.trilha === 'convenio' ? d.trilha : null,
      funil_ia_ate:    d.funil_ia_ate,
      last_message_at: d.last_message_at,
      tags:            d.tags ?? [],
    }))
  }

  async gravarLeitura(dealId: string, colunas: LeituraFunilColunas): Promise<void> {
    const { error } = await this.supabase
      .schema('crm')
      .from('deals')
      .update(colunas)
      .eq('id', dealId)
    if (error) throw new Error(`[funil] gravar leitura: ${error.message}`)
  }

  // Só a marca d'água, sem tocar na última leitura: conversa sem texto para
  // ler (áudio, foto) ou resposta do modelo fora do formato. O card volta a
  // ser lido na próxima mensagem, e a leitura válida anterior continua lá.
  async avancarMarca(dealId: string, ate: string | null): Promise<void> {
    const { error } = await this.supabase
      .schema('crm')
      .from('deals')
      .update({ funil_ia_ate: ate })
      .eq('id', dealId)
    if (error) throw new Error(`[funil] avançar marca: ${error.message}`)
  }
}
