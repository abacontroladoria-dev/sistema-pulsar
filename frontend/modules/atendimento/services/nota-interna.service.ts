import type { NotaInternaRepository } from '../repositories/nota-interna.repository'
import type { MencaoRepository } from '../repositories/mencao.repository'
import type { ConversationRepository } from '../repositories/conversation.repository'
import type { CentralUserRepository, UsuarioCentral } from '../repositories/central-user.repository'
import type { AuditRepository } from '../repositories/audit.repository'
import type { Conversation, NotaInterna } from '../types/central.types'
// `import type` para não criar dependência de runtime entre dois services —
// mesma convenção de conversation.service.ts.
import type { ConversationService } from './conversation.service'
import {
  ConversationNotFoundError,
  NotaRecusadaError,
  NotasIndisponiveisError,
} from '../types/errors.types'
import { isTabelaAusente } from '../utils/pg-errors'

// ============================================================================
// NotaInternaService
//
// A nota interna da conversa: texto que só a equipe lê, com @menção a colegas
// e, opcionalmente, a conversa delegada a uma das pessoas mencionadas.
//
// Regras:
//   1. A nota NUNCA chega ao contato. Não passa por central.messages, por
//      MessageService nem por provider — é uma tabela à parte, e este service
//      não conhece nenhum deles.
//   2. Acesso à conversa conferido com o client do USUÁRIO antes de qualquer
//      escrita (a RLS de central.conversations decide). A escrita sai com
//      service role, porque as tabelas não aceitam INSERT de `authenticated`.
//   3. Só se menciona quem enxerga a conversa — admin/director ou membro da
//      caixa. O aviso de uma conversa que a pessoa não abre é um aviso inútil,
//      e a RLS das menções o esconderia de qualquer jeito.
//   4. Delegar = a transferência de sempre (ConversationService.transfer), com
//      o evento conversation.transferred. Só para quem foi mencionado.
//   5. A auditoria registra que a nota existe e quem foi avisado — nunca o
//      texto, que mora na própria tabela, sob a RLS dela.
// ============================================================================

export interface CriarNotaInternaInput {
  body:         string
  mencoes:      string[]
  delegarPara?: string | null
}

export interface PessoaNota {
  id:   string
  nome: string
}

// A nota como a tela a desenha: com os nomes resolvidos.
export interface NotaInternaVista extends NotaInterna {
  autor:        PessoaNota
  mencionados:  PessoaNota[]
  delegadaPara: PessoaNota | null
}

const ENCERRADA = ['resolved', 'archived']

export class NotaInternaService {
  constructor(
    private readonly notas:    NotaInternaRepository,
    private readonly mencoes:  MencaoRepository,
    // Client do usuário: é a leitura que prova o acesso.
    private readonly conv:     ConversationRepository,
    // Service role: a RLS de public.usuarios só mostra o próprio perfil.
    private readonly usuarios: CentralUserRepository,
    private readonly conversas: ConversationService,
    private readonly audit:    AuditRepository,
  ) {}

  // Organização divergente ou conversa invisível viram 404 — nunca "403 existe,
  // mas não é sua", que já confirmaria a existência da conversa.
  private async exigirConversa(orgId: string, conversationId: string): Promise<Conversation> {
    const conversa = await this.conv.findById(conversationId)
    if (!conversa || conversa.organization_id !== orgId) throw new ConversationNotFoundError(conversationId)
    return conversa
  }

  private async vista(orgId: string, notas: NotaInterna[]): Promise<NotaInternaVista[]> {
    const ids = new Set<string>()
    for (const n of notas) {
      ids.add(n.author_user_id)
      n.mentioned_user_ids.forEach(id => ids.add(id))
      if (n.delegated_to_user_id) ids.add(n.delegated_to_user_id)
    }
    const nomes = await this.usuarios.nomesDe(orgId, [...ids])
    const pessoa = (id: string): PessoaNota => ({ id, nome: nomes.get(id) ?? `Usuário ${id.slice(0, 8)}` })

    return notas.map(n => ({
      ...n,
      autor:        pessoa(n.author_user_id),
      mencionados:  n.mentioned_user_ids.map(pessoa),
      delegadaPara: n.delegated_to_user_id ? pessoa(n.delegated_to_user_id) : null,
    }))
  }

  async listar(orgId: string, conversationId: string): Promise<NotaInternaVista[]> {
    await this.exigirConversa(orgId, conversationId)
    try {
      return await this.vista(orgId, await this.notas.listarDaConversa(conversationId))
    } catch (err) {
      // Migration não aplicada: a conversa abre normalmente, só sem notas.
      if (isTabelaAusente(err)) return []
      throw err
    }
  }

  // O @autocomplete: quem enxerga esta conversa — inclusive quem está
  // escrevendo, que pode se marcar como lembrete.
  async mencionaveis(orgId: string, conversationId: string): Promise<UsuarioCentral[]> {
    const conversa = await this.exigirConversa(orgId, conversationId)
    return this.usuarios.listarComAcessoACaixa(orgId, conversa.inbox_id)
  }

  async criar(
    orgId: string,
    conversationId: string,
    input: CriarNotaInternaInput,
    actorId: string,
  ): Promise<NotaInternaVista> {
    const conversa = await this.exigirConversa(orgId, conversationId)

    const corpo = input.body.trim()
    // Repetir a mesma pessoa não avisa duas vezes. Mencionar a si mesmo é
    // permitido: vira lembrete em "Menções a mim".
    const mencionados = [...new Set(input.mencoes)]
    const delegarPara = input.delegarPara ?? null

    if (delegarPara && !mencionados.includes(delegarPara)) {
      throw new NotaRecusadaError('Só dá para delegar a conversa a alguém mencionado na nota.')
    }
    if (delegarPara && ENCERRADA.includes(conversa.status)) {
      throw new NotaRecusadaError('A conversa está encerrada. Reabra pelo botão no topo antes de delegar.')
    }

    if (mencionados.length > 0) {
      const comAcesso = new Set(
        (await this.usuarios.listarComAcessoACaixa(orgId, conversa.inbox_id)).map(u => u.id),
      )
      if (mencionados.some(id => !comAcesso.has(id))) {
        throw new NotaRecusadaError(
          'Uma das pessoas mencionadas não tem acesso a este número. Peça a um administrador para incluí-la na caixa, ou mencione outra pessoa.',
        )
      }
    }

    let nota: NotaInterna
    try {
      nota = await this.notas.criar({
        organization_id:      orgId,
        conversation_id:      conversationId,
        author_user_id:       actorId,
        body:                 corpo,
        mentioned_user_ids:   mencionados,
        delegated_to_user_id: delegarPara,
      })
    } catch (err) {
      if (isTabelaAusente(err)) throw new NotasIndisponiveisError()
      throw err
    }

    try {
      await this.mencoes.criarVarias(mencionados.map(id => ({
        organization_id:   orgId,
        note_id:           nota.id,
        conversation_id:   conversationId,
        mentioned_user_id: id,
        author_user_id:    actorId,
      })))
    } catch (err) {
      // Sem o aviso, a nota mente para quem a escreveu ("avisei a Danielle").
      // Melhor desfazer e devolver o erro: o texto continua no compositor.
      await this.notas.apagar(nota.id).catch(() => {})
      throw err
    }

    // A nota e os avisos estão gravados: daqui em diante ela é auditada mesmo
    // que a delegação falhe — com `delegouPara` dizendo o que de fato ocorreu.
    const auditar = (delegou: string | null) => void this.audit.insert({
      organization_id: orgId,
      conversation_id: conversationId,
      event_type:      'conversation.note_added',
      performed_by:    actorId,
      payload:         { noteId: nota.id, mencionados, delegouPara: delegou },
    })

    if (delegarPara) {
      try {
        // Conversa sem dono: atribuir, que também a tira da fila ('assigned').
        // Com dono: transferir, que preserva o "de quem para quem" no evento.
        // O motivo é fixo de propósito: o texto da nota fica na nota, sob a RLS
        // dela, e não é copiado para a trilha de auditoria.
        if (conversa.assigned_user_id === null) {
          await this.conversas.assign(conversationId, delegarPara, actorId)
        } else {
          await this.conversas.transfer({
            conversationId,
            toUserId: delegarPara,
            actorId,
            reason:   'Delegada por nota interna',
          })
        }
      } catch (err) {
        // A nota e o aviso ficam (a pessoa foi avisada), mas o selo "Delegou
        // para" não pode afirmar uma transferência que não aconteceu.
        await this.notas.limparDelegacao(nota.id).catch(() => {})
        auditar(null)
        throw new NotaRecusadaError(
          `A nota foi gravada e a pessoa avisada, mas a conversa não foi delegada: ${(err as Error).message}`,
        )
      }
    }

    auditar(delegarPara)

    const [vista] = await this.vista(orgId, [nota])
    return vista
  }
}
