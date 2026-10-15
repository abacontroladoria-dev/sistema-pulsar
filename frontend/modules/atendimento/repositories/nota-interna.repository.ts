import type { SupabaseClient } from '@supabase/supabase-js'
import type { NotaInterna } from '../types/central.types'

// ============================================================================
// NotaInternaRepository
//
// central.conversation_notes (migration 20261015120000).
//
// DOIS CLIENTES, DE PROPÓSITO
//
//   leitura — o client do USUÁRIO. A RLS decide quem lê a nota: admin/director
//             da organização ou membro da caixa da conversa.
//   escrita — SERVICE ROLE. A tabela não tem INSERT/UPDATE/DELETE para
//             `authenticated`; quem grava é a rota, depois de o service ter
//             conferido o acesso com o client do usuário. Mesma forma de
//             message_attachments (ver createMessageService).
// ============================================================================

const COLUNAS = `
  id, organization_id, conversation_id, author_user_id, body,
  mentioned_user_ids, delegated_to_user_id, created_at
`

export interface CriarNotaInput {
  organization_id:      string
  conversation_id:      string
  author_user_id:       string
  body:                 string
  mentioned_user_ids:   string[]
  delegated_to_user_id: string | null
}

export class NotaInternaRepository {
  constructor(
    private readonly leitura: SupabaseClient,
    private readonly escrita: SupabaseClient,
  ) {}

  // Todas as notas da conversa, da mais antiga para a mais nova — a ordem da
  // tela. Sem paginação: nota é escrita à mão por gente, uma conversa não junta
  // centenas delas.
  async listarDaConversa(conversationId: string): Promise<NotaInterna[]> {
    const { data, error } = await this.leitura
      .schema('central')
      .from('conversation_notes')
      .select(COLUNAS)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })

    if (error) throw error
    return (data ?? []) as NotaInterna[]
  }

  async criar(input: CriarNotaInput): Promise<NotaInterna> {
    const { data, error } = await this.escrita
      .schema('central')
      .from('conversation_notes')
      .insert(input)
      .select(COLUNAS)
      .single()

    if (error) throw error
    return data as NotaInterna
  }

  // A transferência pedida pela nota falhou: o selo "Delegou para" sai.
  async limparDelegacao(id: string): Promise<void> {
    const { error } = await this.escrita
      .schema('central')
      .from('conversation_notes')
      .update({ delegated_to_user_id: null })
      .eq('id', id)

    if (error) throw error
  }

  // Compensação: se as menções não entrarem, a nota sai. Nota que diz
  // "@Danielle" sem que a Danielle receba o aviso é pior que nota nenhuma —
  // quem escreveu acha que avisou.
  async apagar(id: string): Promise<void> {
    const { error } = await this.escrita
      .schema('central')
      .from('conversation_notes')
      .delete()
      .eq('id', id)

    if (error) throw error
  }
}
