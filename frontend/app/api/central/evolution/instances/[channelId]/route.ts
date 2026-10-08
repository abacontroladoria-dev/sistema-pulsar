import type { NextRequest } from 'next/server'

import { extractUser } from '@/lib/central/auth'
import { mapCentralError } from '@/lib/central/errors'
import { ok, noContent, badRequest, forbidden } from '@/lib/central/response'
import { reiniciar, desconectar, removerNumero, definirMaiaSugestao, podeGerenciarNumeros, MENSAGEM_SEM_PERMISSAO_NUMEROS } from '@/modules/atendimento/evolution/instancias'

type Ctx = { params: Promise<{ channelId: string }> }

// PATCH  /api/central/evolution/instances/[channelId] — { action: 'restart' | 'logout' }
//        ou { action: 'maia_sugestao', ligar: boolean }
// DELETE /api/central/evolution/instances/[channelId] — remove da Evolution e desativa
//        (o histórico de conversas fica)

export async function PATCH(request: NextRequest, ctx: Ctx) {
  try {
    const { user } = await extractUser()
    if (!podeGerenciarNumeros(user.centralRole)) return forbidden(MENSAGEM_SEM_PERMISSAO_NUMEROS)
    const { channelId } = await ctx.params

    const { action, ligar } = (await request.json().catch(() => ({}))) as { action?: unknown; ligar?: unknown }
    if (action === 'restart') await reiniciar(user.orgId, channelId)
    else if (action === 'logout') await desconectar(user.orgId, channelId)
    else if (action === 'maia_sugestao' && typeof ligar === 'boolean') await definirMaiaSugestao(user.orgId, channelId, ligar)
    else return badRequest("action deve ser 'restart', 'logout' ou 'maia_sugestao' (com ligar: boolean)", 'action')

    return ok({ ok: true })
  } catch (err) {
    return mapCentralError(err)
  }
}

export async function DELETE(_request: NextRequest, ctx: Ctx) {
  try {
    const { user } = await extractUser()
    if (!podeGerenciarNumeros(user.centralRole)) return forbidden(MENSAGEM_SEM_PERMISSAO_NUMEROS)
    const { channelId } = await ctx.params

    await removerNumero(user.orgId, channelId)
    return noContent()
  } catch (err) {
    return mapCentralError(err)
  }
}
