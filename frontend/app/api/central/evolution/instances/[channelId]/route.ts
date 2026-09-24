import type { NextRequest } from 'next/server'

import { extractUser } from '@/lib/central/auth'
import { mapCentralError } from '@/lib/central/errors'
import { ok, noContent, badRequest, forbidden } from '@/lib/central/response'
import { reiniciar, desconectar, removerNumero } from '@/modules/atendimento/evolution/instancias'

type Ctx = { params: Promise<{ channelId: string }> }

// PATCH  /api/central/evolution/instances/[channelId] — { action: 'restart' | 'logout' }
// DELETE /api/central/evolution/instances/[channelId] — remove da Evolution e desativa
//        (o histórico de conversas fica)

export async function PATCH(request: NextRequest, ctx: Ctx) {
  try {
    const { user } = await extractUser()
    if (user.centralRole !== 'admin') return forbidden('Apenas administradores gerenciam os números')
    const { channelId } = await ctx.params

    const { action } = (await request.json().catch(() => ({}))) as { action?: unknown }
    if (action === 'restart') await reiniciar(user.orgId, channelId)
    else if (action === 'logout') await desconectar(user.orgId, channelId)
    else return badRequest("action deve ser 'restart' ou 'logout'", 'action')

    return ok({ ok: true })
  } catch (err) {
    return mapCentralError(err)
  }
}

export async function DELETE(_request: NextRequest, ctx: Ctx) {
  try {
    const { user } = await extractUser()
    if (user.centralRole !== 'admin') return forbidden('Apenas administradores gerenciam os números')
    const { channelId } = await ctx.params

    await removerNumero(user.orgId, channelId)
    return noContent()
  } catch (err) {
    return mapCentralError(err)
  }
}
