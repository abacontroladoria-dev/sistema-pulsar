import type { NextRequest } from 'next/server'

import { extractUser } from '@/lib/central/auth'
import { mapCentralError } from '@/lib/central/errors'
import { ok, forbidden } from '@/lib/central/response'
import { consultarStatus, canalParaConectar, MENSAGEM_SEM_PERMISSAO_CONECTAR } from '@/modules/atendimento/evolution/instancias'

type Ctx = { params: Promise<{ channelId: string }> }

// GET /api/central/evolution/instances/[channelId]/status
// Pergunta à Evolution e sincroniza o status no banco — serve para o modal de
// QR saber quando o número conectou sem depender de o webhook chegar. Mesmo
// portão do QR (admin, diretoria e membros do número).
export async function GET(_request: NextRequest, ctx: Ctx) {
  try {
    const { user, supabase } = await extractUser()
    const { channelId } = await ctx.params
    const canal = await canalParaConectar(user, supabase, channelId)
    if (!canal) return forbidden(MENSAGEM_SEM_PERMISSAO_CONECTAR)

    return ok({ estado: await consultarStatus(user.orgId, canal) })
  } catch (err) {
    return mapCentralError(err)
  }
}
