import type { NextRequest } from 'next/server'

import { extractUser } from '@/lib/central/auth'
import { mapCentralError } from '@/lib/central/errors'
import { ok, forbidden } from '@/lib/central/response'
import { consultarStatus } from '@/modules/atendimento/evolution/instancias'

type Ctx = { params: Promise<{ channelId: string }> }

// GET /api/central/evolution/instances/[channelId]/status
// Pergunta à Evolution e sincroniza o status no banco — serve para o modal de
// QR saber quando o número conectou sem depender de o webhook chegar.
export async function GET(_request: NextRequest, ctx: Ctx) {
  try {
    const { user } = await extractUser()
    if (user.centralRole !== 'admin') return forbidden('Apenas administradores gerenciam os números')
    const { channelId } = await ctx.params

    return ok({ estado: await consultarStatus(user.orgId, channelId) })
  } catch (err) {
    return mapCentralError(err)
  }
}
