import type { NextRequest } from 'next/server'

import { extractUser } from '@/lib/central/auth'
import { mapCentralError } from '@/lib/central/errors'
import { ok, forbidden } from '@/lib/central/response'
import { pedirQr, canalParaConectar, MENSAGEM_SEM_PERMISSAO_CONECTAR } from '@/modules/atendimento/evolution/instancias'

type Ctx = { params: Promise<{ channelId: string }> }

// GET /api/central/evolution/instances/[channelId]/qr
// QR novo a cada chamada (o do WhatsApp expira em ~20s). Não é gravado: quem
// tivesse o QR conectaria o número no próprio celular. Admin, diretoria e os
// membros do número.
export async function GET(_request: NextRequest, ctx: Ctx) {
  try {
    const { user, supabase } = await extractUser()
    const { channelId } = await ctx.params
    const canal = await canalParaConectar(user, supabase, channelId)
    if (!canal) return forbidden(MENSAGEM_SEM_PERMISSAO_CONECTAR)

    return ok(await pedirQr(canal))
  } catch (err) {
    return mapCentralError(err)
  }
}
