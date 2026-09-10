import type { SupabaseClient } from '@supabase/supabase-js'
import type { PipelineStageRow } from '../types/crm.types'
import { EstagioComNegociosError, SemPermissaoComercialError } from '../types/errors.types'

// ============================================================================
// PipelineStageRepository
//
// Acesso exclusivo a crm.pipeline_stages — as colunas do Kanban.
//
// PERMISSÕES (20260701020300_crm_rls.sql):
//   admin    → leitura + escrita (estrutura do funil)
//   director → SOMENTE LEITURA
//
// Um director que tente criar/editar estágio recebe 0 linhas afetadas, sem
// erro. Por isso toda escrita aqui confere o retorno e lança
// SemPermissaoComercialError — do contrário a UI mostraria a coluna criada e
// ela sumiria no próximo refresh.
//
// ATENÇÃO à constraint uq_pipeline_stage_org_position (organization_id,
// position): reordenar trocando duas posições diretamente viola o índice no
// meio da operação. Por isso `reordenar` usa deslocamento temporário.
// ============================================================================

export class PipelineStageRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  private get table() {
    return (this.supabase as any).schema('crm').from('pipeline_stages')
  }

  // Ordenado por position — é a ordem das colunas no Kanban.
  async list(orgId: string, apenasAtivos = true): Promise<PipelineStageRow[]> {
    let query = this.table
      .select('*')
      .eq('organization_id', orgId)

    if (apenasAtivos) query = query.eq('is_active', true)

    const { data, error } = await query.order('position', { ascending: true })

    if (error) throw error
    return (data ?? []) as PipelineStageRow[]
  }

  async findById(id: string, orgId: string): Promise<PipelineStageRow | null> {
    const { data, error } = await this.table
      .select('*')
      .eq('id', id)
      .eq('organization_id', orgId)
      .maybeSingle()

    if (error) throw error
    return (data ?? null) as PipelineStageRow | null
  }

  async create(input: {
    organization_id: string
    title:           string
    color?:          string
    position:        number
    description?:    string | null
    auto_win?:       boolean
    auto_lose?:      boolean
  }): Promise<PipelineStageRow> {
    const { data, error } = await this.table
      .insert(input)
      .select('*')
      .single()

    if (error) throw error
    if (!data) throw new SemPermissaoComercialError('criar estágios do funil')
    return data as PipelineStageRow
  }

  async update(
    id: string,
    orgId: string,
    patch: Partial<Pick<PipelineStageRow,
      'title' | 'color' | 'description' | 'position' | 'is_active' | 'auto_win' | 'auto_lose'
    >>
  ): Promise<PipelineStageRow> {
    const { data, error } = await this.table
      .update(patch)
      .eq('id', id)
      .eq('organization_id', orgId)
      .select('*')
      .maybeSingle()

    if (error) throw error
    if (!data) throw new SemPermissaoComercialError('editar estágios do funil')
    return data as PipelineStageRow
  }

  async delete(id: string, orgId: string): Promise<void> {
    const { data, error } = await this.table
      .delete()
      .eq('id', id)
      .eq('organization_id', orgId)
      .select('id')

    // 23503 = foreign_key_violation. stage_id em crm.deals é ON DELETE RESTRICT,
    // então o banco recusa apagar estágio que ainda tem deals — é proteção,
    // não falha: a UI precisa mandar mover os deals antes.
    if (error?.code === '23503') throw new EstagioComNegociosError(id)
    if (error) throw error
    if (!data || data.length === 0) {
      throw new SemPermissaoComercialError('excluir estágios do funil')
    }
  }

  // ---------------------------------------------------------------------------
  // reordenar — troca as posições das colunas do Kanban.
  //
  // uq_pipeline_stage_org_position impede duas linhas com a mesma position na
  // mesma org. Gravar a ordem nova direto quebra assim que a primeira linha
  // assume uma position que outra ainda ocupa.
  //
  // Solução em duas passadas: primeiro joga todo mundo para uma faixa negativa
  // (que ninguém usa), depois grava as posições finais. Duas linhas nunca
  // colidem porque as faixas não se cruzam.
  //
  // Não é atômico — são N+N requests via PostgREST, sem transação. Uma falha no
  // meio deixa o funil com posições negativas visíveis. O certo seria uma RPC
  // com todas as trocas numa transação; fica registrado como dívida porque
  // reordenar é operação rara e de admin, e a correção é reordenar de novo.
  // ---------------------------------------------------------------------------
  async reordenar(orgId: string, idsNaOrdem: string[]): Promise<void> {
    // Passada 1: faixa temporária negativa, livre de colisão.
    for (let i = 0; i < idsNaOrdem.length; i++) {
      const { error } = await this.table
        .update({ position: -(i + 1) })
        .eq('id', idsNaOrdem[i])
        .eq('organization_id', orgId)
      if (error) throw error
    }

    // Passada 2: posições finais.
    for (let i = 0; i < idsNaOrdem.length; i++) {
      const { error } = await this.table
        .update({ position: i })
        .eq('id', idsNaOrdem[i])
        .eq('organization_id', orgId)
      if (error) throw error
    }
  }
}
