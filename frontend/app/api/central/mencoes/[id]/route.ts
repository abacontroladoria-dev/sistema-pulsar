import type { NextRequest } from 'next/server'
import { extractUser }     from '@/lib/central/auth'
import { mapCentralError } from '@/lib/central/errors'
import { noContent, badRequest } from '@/lib/central/response'
import { parseMarcarMencaoBody } from '@/modules/atendimento/dto/nota-interna.dto'
import { createMencaoService }   from '@/modules/atendimento/services'

type Ctx = { params: Promise<{ id: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// PATCH /api/central/mencoes/[id]   { lida: boolean }
// Marca uma menção como lida ou não lida. Só a da própria pessoa: o filtro
// pelo id da sessão está no repositório — menção de outra pessoa responde 404.
export async function PATCH(request: NextRequest, ctx: Ctx) {
  try {
    const { user, supabase } = await extractUser()
    const { id } = await ctx.params
    if (!UUID.test(id)) return badRequest('id da menção inválido')

    const parsed = parseMarcarMencaoBody(await request.json().catch(() => null))
    if (!parsed.ok) return badRequest(parsed.errors.join('; '))

    await createMencaoService(supabase).marcar({
      id, userId: user.id, orgId: user.orgId, lida: parsed.data.lida,
    })
    return noContent()
  } catch (err) {
    return mapCentralError(err)
  }
}
