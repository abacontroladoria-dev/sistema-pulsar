import type { NextRequest } from 'next/server'

import { extractUser } from '@/lib/central/auth'
import { mapCentralError } from '@/lib/central/errors'
import { ok, badRequest, forbidden } from '@/lib/central/response'
import { createCentralUserService } from '@/modules/atendimento/services'
import { listarMembros, definirMembros } from '@/modules/atendimento/evolution/instancias'

type Ctx = { params: Promise<{ channelId: string }> }

// GET /api/central/evolution/instances/[channelId]/membros
//   → { membros: userId[], usuarios: {id, nome, central_role}[] }
// PUT /api/central/evolution/instances/[channelId]/membros  { userIds: string[] }
//   Substitui a lista de quem enxerga este número.

export async function GET(_request: NextRequest, ctx: Ctx) {
  try {
    const { user } = await extractUser()
    if (user.centralRole !== 'admin') return forbidden('Apenas administradores gerenciam os números')
    const { channelId } = await ctx.params

    const [membros, usuarios] = await Promise.all([
      listarMembros(user.orgId, channelId),
      createCentralUserService().listarAtribuiveis(user.orgId),
    ])
    return ok({ membros, usuarios })
  } catch (err) {
    return mapCentralError(err)
  }
}

export async function PUT(request: NextRequest, ctx: Ctx) {
  try {
    const { user } = await extractUser()
    if (user.centralRole !== 'admin') return forbidden('Apenas administradores gerenciam os números')
    const { channelId } = await ctx.params

    const corpo = (await request.json().catch(() => ({}))) as { userIds?: unknown }
    if (!Array.isArray(corpo.userIds) || !corpo.userIds.every(id => typeof id === 'string')) {
      return badRequest('userIds deve ser uma lista de ids', 'userIds')
    }

    const usuarios = await createCentralUserService().listarAtribuiveis(user.orgId)
    const validos = new Set(usuarios.map(u => u.id))
    const membros = await definirMembros(user.orgId, channelId, corpo.userIds as string[], validos)
    return ok({ membros })
  } catch (err) {
    return mapCentralError(err)
  }
}
