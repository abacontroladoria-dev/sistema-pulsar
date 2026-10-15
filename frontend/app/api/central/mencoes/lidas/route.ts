import type { NextRequest } from 'next/server'
import { extractUser }     from '@/lib/central/auth'
import { mapCentralError } from '@/lib/central/errors'
import { ok, badRequest }  from '@/lib/central/response'
import { parseMarcarLidasBody } from '@/modules/atendimento/dto/nota-interna.dto'
import { createMencaoService }  from '@/modules/atendimento/services'

// POST /api/central/mencoes/lidas   { conversationId } | { todas: true }
//
// { conversationId }: o inbox chama ao abrir a conversa — as menções a quem
//   abriu, nela, passam a lidas.
// { conversationId, noteIds }: com a conversa já aberta, só as menções das
//   notas que acabaram de chegar (o lembrete que a pessoa deixou para si fica).
// { todas: true }: o "Marcar todas como lidas" da página de menções.
//
// Responde { marcadas } para o menu saber se precisa recontar.
export async function POST(request: NextRequest) {
  try {
    const { user, supabase } = await extractUser()

    const parsed = parseMarcarLidasBody(await request.json().catch(() => null))
    if (!parsed.ok) return badRequest(parsed.errors.join('; '))

    const marcadas = await createMencaoService(supabase).marcarLidas({
      userId: user.id, orgId: user.orgId, ...parsed.data,
    })
    return ok({ marcadas })
  } catch (err) {
    return mapCentralError(err)
  }
}
