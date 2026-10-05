import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================================
// A Maia move o card do funil (crm.deals)
//
// Toda a regra — só avança, não passa de "Entrevista agendada", encerra só no
// começo do funil, respeita a trilha, exige motivo onde a posição exige — mora
// em crm.maia_mover_negocio (20261005180000). Aqui só se chama e se traduz o
// código de volta. Mesma razão das ferramentas de agenda: se a regra tivesse
// duas cópias, as duas superfícies discordariam um dia.
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
}
