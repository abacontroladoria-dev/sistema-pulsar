import type { NextRequest } from 'next/server'

import { extractUser } from '@/lib/central/auth'
import { mapCentralError } from '@/lib/central/errors'
import { ok, forbidden } from '@/lib/central/response'
import { consultarStatus, podeConectarNumero, MENSAGEM_SEM_PERMISSAO_CONECTAR } from '@/modules/atendimento/evolution/instancias'

type Ctx = { params: Promise<{ channelId: string }> }

// GET /api/central/evolution/instances/[channelId]/status
// Pergunta à Evolution e sincroniza o status no banco — serve para o modal de
// QR saber quando o número conectou sem depender de o webhook chegar. Mesmo
// portão do QR (admin, diretoria e membros do número).
export async function GET(_request: NextRequest, ctx: Ctx) {
  try {
    const { user } = await extractUser()
    const { channelId } = await ctx.params
    if (!(await podeConectarNumero(user, channelId))) return forbidden(MENSAGEM_SEM_PERMISSAO_CONECTAR)

    return ok({ estado: await consultarStatus(user.orgId, channelId) })
  } catch (err) {
    return mapCentralError(err)
  }
}
