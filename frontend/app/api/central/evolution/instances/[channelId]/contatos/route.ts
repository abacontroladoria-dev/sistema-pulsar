import type { NextRequest } from 'next/server'

import { extractUser } from '@/lib/central/auth'
import { mapCentralError } from '@/lib/central/errors'
import { ok, forbidden } from '@/lib/central/response'
import { importarContatos, podeGerenciarNumeros, MENSAGEM_SEM_PERMISSAO_NUMEROS } from '@/modules/atendimento/evolution/instancias'

type Ctx = { params: Promise<{ channelId: string }> }

// Agenda de milhares de contatos: o lote leva alguns segundos.
export const maxDuration = 60

// POST /api/central/evolution/instances/[channelId]/contatos
// Importa os contatos do WhatsApp do número para central.contacts.
export async function POST(_request: NextRequest, ctx: Ctx) {
  try {
    const { user } = await extractUser()
    if (!podeGerenciarNumeros(user.centralRole)) return forbidden(MENSAGEM_SEM_PERMISSAO_NUMEROS)
    const { channelId } = await ctx.params

    return ok(await importarContatos(user.orgId, channelId))
  } catch (err) {
    return mapCentralError(err)
  }
}
