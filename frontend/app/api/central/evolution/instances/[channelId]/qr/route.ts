import type { NextRequest } from 'next/server'

import { extractUser } from '@/lib/central/auth'
import { mapCentralError } from '@/lib/central/errors'
import { ok, forbidden } from '@/lib/central/response'
import { pedirQr } from '@/modules/atendimento/evolution/instancias'

type Ctx = { params: Promise<{ channelId: string }> }

// GET /api/central/evolution/instances/[channelId]/qr
// QR novo a cada chamada (o do WhatsApp expira em ~20s). Não é gravado: quem
// tivesse o QR conectaria o número no próprio celular.
export async function GET(_request: NextRequest, ctx: Ctx) {
  try {
    const { user } = await extractUser()
    if (user.centralRole !== 'admin') return forbidden('Apenas administradores gerenciam os números')
    const { channelId } = await ctx.params

    return ok(await pedirQr(user.orgId, channelId))
  } catch (err) {
    return mapCentralError(err)
  }
}
