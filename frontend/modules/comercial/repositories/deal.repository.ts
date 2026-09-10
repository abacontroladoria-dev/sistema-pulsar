import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  DealRow,
  DealWithContactRow,
  CreateDealInput,
  UpdateDealInput,
  ListDealsFilters,
  DealStatus,
} from '../types/crm.types'
import {
  DealJaAbertoParaContatoError,
  SemPermissaoComercialError,
} from '../types/errors.types'

// ============================================================================
// DealRepository
//
// Acesso exclusivo a crm.deals. Sem lógica de negócio — auto_win/auto_lose,
// registro de atividade e demais orquestrações vivem no DealService.
//
// PRÉ-REQUISITO: o schema `crm` precisa estar exposto no PostgREST
// (Settings → API → Exposed schemas). Sem isso toda chamada aqui devolve
// PGRST106 com HTTP 406 — que é fácil confundir com problema de `Accept`.
// Ver supabase/snippets/crm_diagnostico_pre_exposicao.sql.
//
// RLS: as policies de 20260701020300 filtram por
// organization_id = central.current_organization_id() e exigem role
// admin|director. O filtro .eq('organization_id', orgId) aqui é redundante
// com a policy de propósito: defesa em profundidade, e mantém o índice
// utilizável (a policy sozinha não guia o planner).
//
// Índices (20260701020200_crm_indexes.sql) + uq_open_deal_per_contact.
// ============================================================================

// O embed de central.contacts atravessa schemas. O PostgREST resolve pela FK
// deals.contact_id → central.contacts(id), não pelo nome do schema — mas isso
// só funciona se AMBOS os schemas estiverem expostos. `central` já está.
const SELECT_COM_CONTATO = `
  *,
  contact:contact_id (
    id,
    name,
    phone_number,
    email
  )
`

export class DealRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  private get table() {
    return (this.supabase as any).schema('crm').from('deals')
  }

  async findById(id: string, orgId: string): Promise<DealWithContactRow | null> {
    const { data, error } = await this.table
      .select(SELECT_COM_CONTATO)
      .eq('id', id)
      .eq('organization_id', orgId)
      .maybeSingle()

    if (error) throw error
    return (data ?? null) as DealWithContactRow | null
  }

  // Usado pelo Kanban: traz o board inteiro de uma vez.
  // O agrupamento por estágio é feito no cliente — são centenas de deals no
  // volume V1 previsto pela migration, não vale uma query por coluna.
  async list(filters: ListDealsFilters): Promise<{ data: DealWithContactRow[]; count: number }> {
    const limit  = filters.limit  ?? 500
    const offset = filters.offset ?? 0

    let query = this.table
      .select(SELECT_COM_CONTATO, { count: 'exact' })
      .eq('organization_id', filters.orgId)

    if (filters.status) {
      query = Array.isArray(filters.status)
        ? query.in('status', filters.status)
        : query.eq('status', filters.status)
    }
    if (filters.stageId) query = query.eq('stage_id', filters.stageId)
    // Busca só no título. Buscar também no nome do contato exigiria filtrar
    // sobre a tabela embutida, o que o PostgREST só faz com !inner — e isso
    // descartaria deals sem contato (contact_id é nullable por LGPD).
    if (filters.search)  query = query.ilike('title', `%${filters.search}%`)

    const { data, error, count } = await query
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error
    return { data: (data ?? []) as DealWithContactRow[], count: count ?? 0 }
  }

  async create(input: CreateDealInput): Promise<DealRow> {
    const { data, error } = await this.table
      .insert(input)
      .select('*')
      .single()

    // 23505 = unique_violation. O único índice único de crm.deals é
    // uq_open_deal_per_contact, então a causa é sempre a mesma.
    if (error?.code === '23505' && input.contact_id) {
      throw new DealJaAbertoParaContatoError(input.contact_id)
    }
    if (error) throw error
    return data as DealRow
  }

  // ---------------------------------------------------------------------------
  // update / updateStatus retornam null quando nenhuma linha foi afetada.
  //
  // Isso acontece em dois casos que o PostgREST NÃO distingue: o id não existe,
  // ou a policy de RLS barrou a escrita. Ambos chegam como 0 linhas e sucesso.
  // Quem chama precisa tratar o null — devolver "ok" aqui faria a UI mostrar o
  // deal movido enquanto o banco não mudou nada.
  // ---------------------------------------------------------------------------
  async update(id: string, orgId: string, patch: UpdateDealInput): Promise<DealRow | null> {
    const { data, error } = await this.table
      .update(patch)
      .eq('id', id)
      .eq('organization_id', orgId)
      .select('*')
      .maybeSingle()

    if (error) throw error
    return (data ?? null) as DealRow | null
  }

  // Fecha ou reabre. closed_at e closed_reason acompanham o status:
  // reabrir precisa limpá-los, senão o deal fica "open com data de fechamento".
  async updateStatus(
    id: string,
    orgId: string,
    status: DealStatus,
    closedReason?: string | null
  ): Promise<DealRow | null> {
    const patch: Record<string, unknown> = { status }

    if (status === 'open') {
      patch.closed_at     = null
      patch.closed_reason = null
    } else {
      patch.closed_at     = new Date().toISOString()
      patch.closed_reason = closedReason ?? null
    }

    const { data, error } = await this.table
      .update(patch)
      .eq('id', id)
      .eq('organization_id', orgId)
      .select('*')
      .maybeSingle()

    // Reabrir pode colidir com uq_open_deal_per_contact se outro deal do mesmo
    // contato já estiver aberto.
    if (error?.code === '23505') {
      throw new DealJaAbertoParaContatoError('(contato deste negócio)')
    }
    if (error) throw error
    return (data ?? null) as DealRow | null
  }

  // DELETE é admin-only na policy (deals_delete_admin). Um director recebe
  // 0 linhas afetadas, sem erro — daí a checagem explícita.
  async delete(id: string, orgId: string): Promise<void> {
    const { data, error } = await this.table
      .delete()
      .eq('id', id)
      .eq('organization_id', orgId)
      .select('id')

    if (error) throw error
    if (!data || data.length === 0) {
      throw new SemPermissaoComercialError('excluir negócios')
    }
  }

  // ---------------------------------------------------------------------------
  // Contagens para o Dashboard.
  //
  // head: true + count: 'exact' pede só o número, sem trafegar linha alguma.
  // Importante aqui porque o Dashboard faz várias dessas em paralelo.
  // ---------------------------------------------------------------------------
  async contarPorStatus(orgId: string, status: DealStatus): Promise<number> {
    const { count, error } = await this.table
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('status', status)

    if (error) throw error
    return count ?? 0
  }

  // Deals criados a partir de uma data. Usado para "novos no período".
  async contarCriadosDesde(orgId: string, desdeISO: string): Promise<number> {
    const { count, error } = await this.table
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .gte('created_at', desdeISO)

    if (error) throw error
    return count ?? 0
  }

  // Soma de `value` dos deals ganhos no período.
  //
  // Sem RPC de agregação no banco, a soma é feita aqui. Para o volume V1
  // (centenas de deals) é aceitável; se passar de alguns milhares, o certo é
  // uma RPC — mas note que RPC em `crm` também depende do schema exposto.
  async somarValorGanhoDesde(orgId: string, desdeISO: string): Promise<number> {
    const { data, error } = await this.table
      .select('value')
      .eq('organization_id', orgId)
      .eq('status', 'won')
      .gte('closed_at', desdeISO)

    if (error) throw error
    return (data ?? []).reduce(
      (soma: number, linha: { value: number | null }) => soma + (linha.value ?? 0),
      0
    )
  }
}
