import type { MencaoRepository, FiltroMencoes, MencaoComContexto } from '../repositories/mencao.repository'
import type { CentralUserRepository } from '../repositories/central-user.repository'
import type { ConversationStatus } from '../types/central.types'
import { MencaoNaoEncontradaError } from '../types/errors.types'
import { isTabelaAusente } from '../utils/pg-errors'

// ============================================================================
// MencaoService
//
// "Menções a mim" (menu do Connect) e o aviso da página inicial do Pulsar.
//
// `userId` e `orgId` vêm SEMPRE da sessão (extractUser), nunca do pedido: é o
// filtro `mentioned_user_id = userId` nas escritas que impede alguém de marcar
// a menção de outra pessoa.
//
// Migration não aplicada (localhost usa o banco de produção): leituras
// respondem vazio/zero e marcações não fazem nada — o menu mostra zero e a
// página inicial não abre aviso, em vez de quebrar.
// ============================================================================

export interface MencaoVista {
  id:                string
  conversationId:    string
  noteId:            string
  lida:              boolean
  lidaEm:            string | null
  criadaEm:          string
  autor:             { id: string; nome: string }
  // A própria pessoa se marcou (lembrete).
  deMim:             boolean
  trecho:            string
  contato:           string
  conversaEncerrada: boolean
  // A nota que mencionou também passou a conversa para esta pessoa.
  delegadaAMim:      boolean
}

const ENCERRADA: ConversationStatus[] = ['resolved', 'archived']

export class MencaoService {
  constructor(
    private readonly mencoes:  MencaoRepository,
    // Service role: a RLS de public.usuarios só mostra o próprio perfil.
    private readonly usuarios: CentralUserRepository,
  ) {}

  async listar(input: {
    orgId: string; userId: string; filtro: FiltroMencoes; limit: number; antesDe?: string
  }): Promise<MencaoVista[]> {
    let linhas: MencaoComContexto[]
    try {
      linhas = await this.mencoes.listar(input)
    } catch (err) {
      if (isTabelaAusente(err)) return []
      throw err
    }

    const nomes = await this.usuarios.nomesDe(input.orgId, [...new Set(linhas.map(l => l.author_user_id))])

    return linhas
      // A nota vem pela RLS dela; se não veio, não há o que mostrar.
      .filter(l => l.nota !== null)
      .map(l => ({
        id:                l.id,
        conversationId:    l.conversation_id,
        noteId:            l.note_id,
        lida:              l.lida_em !== null,
        lidaEm:            l.lida_em,
        criadaEm:          l.created_at,
        autor:             { id: l.author_user_id, nome: nomes.get(l.author_user_id) ?? 'Alguém da equipe' },
        deMim:             l.author_user_id === input.userId,
        trecho:            l.nota!.body,
        contato:           l.conversa?.contact?.name?.trim()
                           || l.conversa?.contact?.display_phone
                           || 'Contato sem nome',
        conversaEncerrada: !!l.conversa && ENCERRADA.includes(l.conversa.status),
        delegadaAMim:      l.nota!.delegated_to_user_id === input.userId,
      }))
  }

  async contarNaoLidas(userId: string): Promise<number> {
    try {
      return await this.mencoes.contarNaoLidas(userId)
    } catch (err) {
      if (isTabelaAusente(err)) return 0
      throw err
    }
  }

  async marcar(input: { id: string; userId: string; orgId: string; lida: boolean }): Promise<void> {
    let achou: boolean
    try {
      achou = await this.mencoes.marcar(input)
    } catch (err) {
      if (isTabelaAusente(err)) throw new MencaoNaoEncontradaError(input.id)
      throw err
    }
    if (!achou) throw new MencaoNaoEncontradaError(input.id)
  }

  async marcarLidas(input: {
    userId: string; orgId: string; conversationId?: string; noteIds?: string[]
  }): Promise<number> {
    try {
      return await this.mencoes.marcarLidasEmLote(input)
    } catch (err) {
      if (isTabelaAusente(err)) return 0
      throw err
    }
  }
}
