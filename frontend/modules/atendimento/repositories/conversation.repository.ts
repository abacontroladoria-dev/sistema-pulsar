import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AIMode,
  Conversation,
  ConversationStatus,
  PaginatedResult,
} from '../types/central.types'

// ============================================================================
// ConversationRepository
//
// Acesso exclusivo à tabela central.conversations.
// Nunca contém lógica de negócio — toda orquestração pertence ao ConversationService.
//
// Indexes utilizados (migration 20260701000500):
//   findById                          → PK lookup
//   findActiveByContactAndChannel     → uq_conversations_active_per_contact_channel
//   list                              → idx_conversations_org_inbox_status
//                                     → idx_conversations_org_status_last_msg
//   listByContact                     → idx_conversations_org_contact
// ============================================================================

export interface ListConversationsFilters {
  orgId:           string
  inboxId?:        string
  status?:         ConversationStatus | ConversationStatus[]
  // null = buscar não atribuídas; string = buscar por operador específico
  assignedUserId?: string | null
  // 'qualquer' = atribuídas a alguém, sem dizer a quem. Não dá para expressar
  // isso com `assignedUserId`, que só tem "este operador" e "ninguém" — e a
  // ausência de filtro não serve, porque traria também as não atribuídas.
  responsavel?:    'qualquer'
  contactId?:      string
  // Modos aceitos na coluna `ai_mode`. `null` no array significa "e também as
  // que ninguém decidiu" — a coluna é NULL na maioria das conversas e quer dizer
  // "vale o padrão da clínica" (ver 20260915220000).
  //
  // Precisa ser lista com null porque a triagem pergunta coisas como "a Maia
  // está atendendo?", e isso é `ai_mode = 'autonomous'` OU `ai_mode IS NULL com
  // o padrão em autonomous`. Quem chama resolve o padrão ANTES e traduz a
  // pergunta para os valores concretos de coluna que a satisfazem; o
  // repositório não conhece agent_settings.
  aiModeIn?:       (AIMode | null)[]
  // Ordem por `last_message_at`. O default 'recente' é o do inbox: a conversa
  // que acabou de se mexer no topo.
  //
  // 'espera' inverte, e é a ordem de FILA: no topo fica a conversa cuja última
  // mensagem é a mais antiga — ou seja, quem está esperando há mais tempo. É o
  // oposto do inbox de propósito. O inbox mostra movimento; uma fila de triagem
  // tem que mostrar abandono, e a conversa esquecida há quatro horas é
  // exatamente a que o inbox empurra para o fim da lista, onde ninguém olha.
  ordem?:          'recente' | 'espera'
  limit?:          number   // default 30
  offset?:         number   // default 0
}

export interface CreateConversationInput {
  organization_id:   string
  inbox_id:          string
  channel_id:        string
  contact_id:        string
  assigned_user_id?: string | null
  status?:           ConversationStatus   // default 'open'
}

// A cláusula de `ai_mode`, isolada porque `list` e `contar` precisam da MESMA —
// e um contador que filtra diferente da lista que ele rotula é o defeito que
// esta página inteira existe para não ter.
//
// `is.null` e `in.()` no mesmo `.or()` é o único jeito de expressar "herdadas +
// explícitas" numa query só; separá-las em duas consultas somaria linhas
// repetidas na paginação.
function aplicarAiMode(query: any, modos: (AIMode | null)[] | undefined): any {
  if (!modos || modos.length === 0) return query

  const explicitos = modos.filter((m): m is AIMode => m !== null)
  const aceitaNulo = modos.includes(null)

  if (aceitaNulo && explicitos.length === 0) return query.is('ai_mode', null)
  if (!aceitaNulo) return query.in('ai_mode', explicitos)

  return query.or(`ai_mode.is.null,ai_mode.in.(${explicitos.join(',')})`)
}

export class ConversationRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  // Só a contagem, sem trazer linha nenhuma (`head: true`). Os quatro cards da
  // triagem chamam isto quatro vezes; puxar as conversas só para descartá-las
  // tornaria a tela cara à toa.
  async contar(filters: ListConversationsFilters): Promise<number> {
    let query = (this.supabase as any)
      .schema('central')
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', filters.orgId)

    if (filters.inboxId) query = query.eq('inbox_id', filters.inboxId)

    if (filters.status !== undefined) {
      query = Array.isArray(filters.status)
        ? query.in('status', filters.status)
        : query.eq('status', filters.status)
    }

    if (filters.assignedUserId !== undefined) {
      query = filters.assignedUserId === null
        ? query.is('assigned_user_id', null)
        : query.eq('assigned_user_id', filters.assignedUserId)
    }

    if (filters.responsavel === 'qualquer') {
      query = query.not('assigned_user_id', 'is', null)
    }

    query = aplicarAiMode(query, filters.aiModeIn)

    const { count, error } = await query
    if (error) throw error
    return count ?? 0
  }

  async findById(id: string): Promise<Conversation | null> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('conversations')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (error) throw error
    return (data ?? null) as Conversation | null
  }

  // Hot path do webhook processor.
  // Verifica se existe conversa ativa (open|assigned|waiting) para o par
  // contato+canal antes de criar uma nova. Usa o índice parcial único
  // uq_conversations_active_per_contact_channel via filtro equivalente.
  async findActiveByContactAndChannel(
    contactId: string,
    channelId: string
  ): Promise<Conversation | null> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('conversations')
      .select('*')
      .eq('contact_id', contactId)
      .eq('channel_id', channelId)
      .in('status', ['open', 'assigned', 'waiting'])
      .maybeSingle()

    if (error) throw error
    return (data ?? null) as Conversation | null
  }

  async list(filters: ListConversationsFilters): Promise<PaginatedResult<Conversation>> {
    const limit  = filters.limit  ?? 30
    const offset = filters.offset ?? 0

    let query = (this.supabase as any)
      .schema('central')
      .from('conversations')
      .select('*', { count: 'exact' })
      .eq('organization_id', filters.orgId)
      // `nullsFirst: false` nas DUAS ordens, e não é simetria à toa: uma conversa
      // sem `last_message_at` é uma conversa sem mensagem nenhuma, e ela não
      // espera há infinito — não espera por nada. Com `nullsFirst: true` na ordem
      // de espera, essas linhas ocupariam o topo da fila e empurrariam para baixo
      // justamente quem está esperando de verdade.
      .order('last_message_at', {
        ascending: filters.ordem === 'espera',
        nullsFirst: false,
      })
      .range(offset, offset + limit - 1)

    if (filters.inboxId) {
      query = query.eq('inbox_id', filters.inboxId)
    }

    if (filters.status !== undefined) {
      if (Array.isArray(filters.status)) {
        query = query.in('status', filters.status)
      } else {
        query = query.eq('status', filters.status)
      }
    }

    if (filters.assignedUserId !== undefined) {
      if (filters.assignedUserId === null) {
        query = query.is('assigned_user_id', null)
      } else {
        query = query.eq('assigned_user_id', filters.assignedUserId)
      }
    }

    if (filters.responsavel === 'qualquer') {
      query = query.not('assigned_user_id', 'is', null)
    }

    if (filters.contactId) {
      query = query.eq('contact_id', filters.contactId)
    }

    query = aplicarAiMode(query, filters.aiModeIn)

    const { data, count, error } = await query
    if (error) throw error

    return {
      data:  (data ?? []) as Conversation[],
      count: count ?? 0,
    }
  }

  // INSERT sem ON CONFLICT porque o índice único parcial do PostgreSQL
  // (uq_conversations_active_per_contact_channel) não suporta ON CONFLICT
  // com predicado composto. Race conditions são tratadas pelo ConversationService:
  // captura o código 23505 e faz retry em findActiveByContactAndChannel.
  async create(input: CreateConversationInput): Promise<Conversation> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('conversations')
      .insert({
        organization_id:  input.organization_id,
        inbox_id:         input.inbox_id,
        channel_id:       input.channel_id,
        contact_id:       input.contact_id,
        assigned_user_id: input.assigned_user_id ?? null,
        status:           input.status ?? 'open',
      })
      .select()
      .single()

    if (error) throw error
    return data as Conversation
  }

  async updateStatus(
    id:     string,
    status: ConversationStatus,
    extra?: { resolved_at?: string; archived_at?: string }
  ): Promise<void> {
    const patch: Record<string, unknown> = { status }
    if (extra?.resolved_at) patch.resolved_at = extra.resolved_at
    if (extra?.archived_at) patch.archived_at = extra.archived_at

    const { error } = await (this.supabase as any)
      .schema('central')
      .from('conversations')
      .update(patch)
      .eq('id', id)

    if (error) throw error
  }

  // Busca conversas ativas de uma lista de contatos.
  // Usado pela search API para correlacionar contatos com suas conversas abertas.
  async listByContactIds(orgId: string, contactIds: string[], limit: number): Promise<Conversation[]> {
    if (contactIds.length === 0) return []

    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('conversations')
      .select('*')
      .eq('organization_id', orgId)
      .in('contact_id', contactIds)
      .in('status', ['open', 'assigned', 'waiting'])
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(limit)

    if (error) throw error
    return (data ?? []) as Conversation[]
  }

  // Escreve a decisão de IA DESTA conversa. `null` devolve a conversa ao padrão
  // da inbox/organização — não é o mesmo que 'off', que é uma decisão de
  // desligar. Ver 20260915220000.
  // Escrita crua do array inteiro — quem decide o que entra/sai por grupo é
  // ConversationService.atualizarTags (merge por grupo, validação contra o
  // catálogo). Este método só grava o que mandaram, igual updatePriority.
  async updateTags(id: string, tags: string[]): Promise<void> {
    const { error } = await (this.supabase as any)
      .schema('central')
      .from('conversations')
      .update({ tags })
      .eq('id', id)

    if (error) throw error
  }

  // Campo, não tag (aba Regras, item 5) — coluna própria (20260922100200).
  // Só o matcher de campanha (agente/origem-campanha.ts) grava aqui; a Maia
  // nunca decide este campo.
  async updateCampanha(id: string, campanha: string): Promise<void> {
    const { error } = await (this.supabase as any)
      .schema('central')
      .from('conversations')
      .update({ campanha })
      .eq('id', id)

    if (error) throw error
  }

  // Campo, não tag (aba Regras, item 8) — coluna própria (20260922100200),
  // fora de conversations.tags.
  async updateObjecao(id: string, objecao: string | null): Promise<void> {
    const { error } = await (this.supabase as any)
      .schema('central')
      .from('conversations')
      .update({ objecao })
      .eq('id', id)

    if (error) throw error
  }

  async updateAiMode(id: string, aiMode: AIMode | null): Promise<void> {
    const { error } = await (this.supabase as any)
      .schema('central')
      .from('conversations')
      .update({ ai_mode: aiMode })
      .eq('id', id)

    if (error) throw error
  }

  async updateAssignee(id: string, userId: string | null): Promise<void> {
    const { error } = await (this.supabase as any)
      .schema('central')
      .from('conversations')
      .update({ assigned_user_id: userId })
      .eq('id', id)

    if (error) throw error
  }

  // `priority` é a urgência da conversa na fila de atendimento humano. Coluna
  // `text` livre em central.conversations (20260701000500), sem CHECK; os valores
  // que o produto usa são 'low' | 'medium' | 'high' | 'urgent', documentados lá.
  //
  // Quem lê: a triagem acende o selo "escalada pela Maia" em 'high'
  // (PainelAtendimentos.tsx). Quem escrevia, até agora, era só o UPDATE cru do
  // worker ao escalar — é por isso que este método nasce agora, junto com
  // ConversationService.escalarParaAtendimentoHumano.
  async updatePriority(id: string, priority: string | null): Promise<void> {
    const { error } = await (this.supabase as any)
      .schema('central')
      .from('conversations')
      .update({ priority })
      .eq('id', id)

    if (error) throw error
  }

  // --------------------------------------------------------------------------
  // Marca d'água de leitura (20260921140000)
  //
  // Escrita crua, sem regra: quem decide QUAL instante gravar é o service. Aqui
  // só se grava o que mandaram — inclusive `null`, que é um valor legítimo
  // ("ninguém abriu ainda") e não a ausência de parâmetro.
  // --------------------------------------------------------------------------
  async updateLastReadAt(id: string, quando: string | null): Promise<void> {
    const { error } = await (this.supabase as any)
      .schema('central')
      .from('conversations')
      .update({ last_read_at: quando })
      .eq('id', id)

    if (error) throw error
  }

  // O `sent_at` da penúltima mensagem inbound da conversa, ou null quando só
  // existe uma (ou nenhuma).
  //
  // É o instante para onde a marca recua ao "marcar como não lida": posta ali,
  // a última mensagem do contato passa a ficar DEPOIS da marca, e o não-lido
  // vira exatamente 1. Recuar mais (para o começo do tempo, ou para null)
  // ressuscitaria um histórico inteiro de não-lidas — o repo de referência
  // evita o mesmo problema tocando só a última mensagem.
  //
  // `sent_at` pode ser null em linha mal formada; a ordenação com
  // `nullsFirst: false` mantém essas no fim, e o caller trata o null.
  async penultimaEntradaEm(conversationId: string): Promise<string | null> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('messages')
      .select('sent_at')
      .eq('conversation_id', conversationId)
      .eq('direction', 'inbound')
      .is('deleted_at', null)
      .order('sent_at', { ascending: false, nullsFirst: false })
      .limit(2)

    if (error) throw error
    const linhas = (data ?? []) as { sent_at: string | null }[]
    // [0] é a última; queremos a de baixo dela.
    return linhas[1]?.sent_at ?? null
  }
}
