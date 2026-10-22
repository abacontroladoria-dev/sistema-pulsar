import type { SupabaseClient } from '@supabase/supabase-js'
import type { ConversationStatus, Mencao } from '../types/central.types'

// ============================================================================
// MencaoRepository
//
// central.conversation_mentions (migration 20261015120000) — "Menções a mim".
//
// Mesma divisão de NotaInternaRepository: lê com o client do usuário (a RLS só
// mostra a cada pessoa as menções a ela, e só enquanto ela enxerga a conversa)
// e grava com service role. Toda escrita aqui leva `mentioned_user_id = quem
// pediu` no filtro: é isso, e não a RLS, que impede marcar a menção de outra
// pessoa — o caller passa o id da sessão, nunca do corpo da requisição.
// ============================================================================

export type FiltroMencoes = 'nao_lidas' | 'lidas' | 'todas'

// Uma menção com o que a lista precisa mostrar, já com os vizinhos embutidos.
export interface MencaoComContexto extends Mencao {
  nota:     { body: string; delegated_to_user_id: string | null } | null
  conversa: {
    id:      string
    status:  ConversationStatus
    contact: { name: string | null; display_phone: string | null } | null
  } | null
}

const COLUNAS = `
  id, organization_id, note_id, conversation_id, mentioned_user_id,
  author_user_id, lida_em, created_at,
  nota:conversation_notes(body, delegated_to_user_id),
  conversa:conversations(id, status, contact:contacts(name, display_phone))
`

export interface CriarMencaoInput {
  organization_id:   string
  note_id:           string
  conversation_id:   string
  mentioned_user_id: string
  author_user_id:    string | null
}

export class MencaoRepository {
  constructor(
    private readonly leitura: SupabaseClient,
    private readonly escrita: SupabaseClient,
  ) {}

  async listar(input: {
    userId: string
    filtro: FiltroMencoes
    limit:  number
    // Cursor: created_at da última da página anterior.
    antesDe?: string
  }): Promise<MencaoComContexto[]> {
    let q = this.leitura
      .schema('central')
      .from('conversation_mentions')
      .select(COLUNAS)
      .eq('mentioned_user_id', input.userId)

    if (input.filtro === 'nao_lidas') q = q.is('lida_em', null)
    if (input.filtro === 'lidas')     q = q.not('lida_em', 'is', null)
    if (input.antesDe)                q = q.lt('created_at', input.antesDe)

    const { data, error } = await q
      .order('created_at', { ascending: false })
      .limit(input.limit)

    if (error) throw error
    // `unknown` no meio: sem os tipos gerados do schema, o supabase-js supõe que
    // todo embutido é lista. nota/conversa são muitos-para-um (FK note_id e
    // conversation_id) e o PostgREST os devolve como objeto.
    return (data ?? []) as unknown as MencaoComContexto[]
  }

  // `head: true`: só o número, nenhuma linha — roda a cada 30s por aba aberta.
  async contarNaoLidas(userId: string): Promise<number> {
    const { count, error } = await this.leitura
      .schema('central')
      .from('conversation_mentions')
      .select('id', { count: 'exact', head: true })
      .eq('mentioned_user_id', userId)
      .is('lida_em', null)

    if (error) throw error
    return count ?? 0
  }

  async criarVarias(linhas: CriarMencaoInput[]): Promise<void> {
    if (linhas.length === 0) return
    const { error } = await this.escrita
      .schema('central')
      .from('conversation_mentions')
      .insert(linhas)

    if (error) throw error
  }

  // Devolve se achou a menção. Não achar = não existe ou não é desta pessoa.
  async marcar(input: { id: string; userId: string; orgId: string; lida: boolean }): Promise<boolean> {
    const { data, error } = await this.escrita
      .schema('central')
      .from('conversation_mentions')
      .update({ lida_em: input.lida ? new Date().toISOString() : null })
      .eq('id', input.id)
      .eq('mentioned_user_id', input.userId)
      .eq('organization_id', input.orgId)
      .select('id')

    if (error) throw error
    return ((data ?? []) as unknown[]).length > 0
  }

  // Abrir a conversa marca como lidas as menções a esta pessoa nela; sem
  // `conversationId`, marca todas ("Marcar todas como lidas"). Só toca nas não
  // lidas: reescrever `lida_em` das já lidas apagaria quando foram lidas.
  async marcarLidasEmLote(input: {
    userId: string; orgId: string; conversationId?: string; noteIds?: string[]
  }): Promise<number> {
    let q = this.escrita
      .schema('central')
      .from('conversation_mentions')
      .update({ lida_em: new Date().toISOString() })
      .eq('mentioned_user_id', input.userId)
      .eq('organization_id', input.orgId)
      .is('lida_em', null)

    if (input.conversationId) q = q.eq('conversation_id', input.conversationId)
    if (input.noteIds)        q = q.in('note_id', input.noteIds)

    const { data, error } = await q.select('id')
    if (error) throw error
    return ((data ?? []) as unknown[]).length
  }
}
