import type { NextRequest }  from 'next/server'
import { extractUser }       from '@/lib/central/auth'
import { mapCentralError }   from '@/lib/central/errors'
import { ok }                from '@/lib/central/response'
import { createCentralUserService } from '@/modules/atendimento/services'

// GET /api/central/users
//
// Quem pode ser responsável por uma conversa: os usuários ativos da
// organização com `central_role`.
//
// A organização vem de `user.orgId` — da sessão validada, nunca de parâmetro.
// O repositório lê com service role (a RLS de public.usuarios deixaria um
// director ver só a si mesmo), então este filtro é a única coisa entre o
// pedido e os usuários de outra organização. Não aceitar orgId por query é
// parte do contrato desta rota, não um detalhe de implementação.
export async function GET(_request: NextRequest) {
  try {
    const { user } = await extractUser()

    const service  = createCentralUserService()
    const usuarios = await service.listarAtribuiveis(user.orgId)

    return ok(usuarios)
  } catch (err) {
    return mapCentralError(err)
  }
}
