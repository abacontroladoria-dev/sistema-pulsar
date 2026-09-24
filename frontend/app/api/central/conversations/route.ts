import type { NextRequest }        from 'next/server'
import { extractUser }             from '@/lib/central/auth'
import { mapCentralError }         from '@/lib/central/errors'
import { ok, created, badRequest } from '@/lib/central/response'
import {
  parseListConversationsQuery,
  parseCreateConversationBody,
} from '@/modules/atendimento/dto/conversation.dto'
import {
  createConversationService,
} from '@/modules/atendimento/services'
import { lerAgentSettingsDaOrg } from '@/modules/atendimento/agente/agent-settings'

// GET /api/central/conversations
// Lista conversas com filtros opcionais. Paginação por cursor em last_message_at.
export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await extractUser()

    const parsed = parseListConversationsQuery(request.nextUrl.searchParams)
    if (!parsed.ok) return badRequest(parsed.errors.join('; '))

    const { limit, cursor, inboxId, channelIds, status, assignedUserId, contactId } = parsed.data

    // O padrão da clínica vai junto da lista porque a badge "quem atende" depende
    // dele: `conversations.ai_mode` é NULL na maioria das linhas e significa
    // "vale o padrão" (ver 20260915220000). Sem este campo o cliente comparava a
    // coluna crua com 'autonomous' e marcava como humana toda conversa que a
    // Maia atende por herança — divergindo da triagem, que resolve certo.
    //
    // Falha fechada em 'off', igual à rota de caixas e ao worker: sem settings
    // legível, ninguém é declarado "sendo atendido pela Maia".
    //
    // Mesma limitação conhecida da rota de caixas: usa o padrão da ORGANIZAÇÃO.
    // Uma inbox com ai_mode próprio não é respeitada aqui. Hoje não existe
    // nenhuma; quando existir, o recorte passa a ser por inbox nas duas rotas.
    const settings   = await lerAgentSettingsDaOrg(supabase, user.orgId).catch(() => null)
    const modoPadrao = settings?.ai_mode ?? 'off'

    const service = createConversationService(supabase)
    const result  = await service.list({
      orgId:          user.orgId,
      inboxId,
      channelIds,
      status,
      assignedUserId,
      contactId,
      limit,
      // cursor é last_message_at do último item — repassado como offset ISO
      // ConversationRepository.list usa .range(offset, ...) não cursor por enquanto;
      // passar como limit+offset até implementar cursor nativo na query
    })

    const lastItem  = result.data.at(-1)
    const nextCursor = lastItem
      ? (lastItem.last_message_at ?? lastItem.created_at)
      : undefined

    return ok(result.data, {
      total:      result.count,
      limit,
      hasMore:    result.data.length === limit,
      nextCursor: nextCursor ?? undefined,
    }, { modoPadrao })
  } catch (err) {
    return mapCentralError(err)
  }
}

// POST /api/central/conversations
// Cria ou retorna a conversa ativa para o par (contato, canal).
// 201 = criada; 200 = já existia.
export async function POST(request: NextRequest) {
  try {
    const { user, supabase } = await extractUser()

    const body   = await request.json().catch(() => null)
    const parsed = parseCreateConversationBody(body)
    if (!parsed.ok) return badRequest(parsed.errors.join('; '))

    const { contactId, channelId, inboxId } = parsed.data

    const service = createConversationService(supabase)
    const result  = await service.findOrCreate(contactId, channelId, inboxId, user.orgId)

    return result.created
      ? created({ ...result.conversation, created: true })
      : ok({ ...result.conversation, created: false })
  } catch (err) {
    return mapCentralError(err)
  }
}
