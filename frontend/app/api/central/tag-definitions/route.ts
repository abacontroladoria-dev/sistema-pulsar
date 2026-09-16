import type { NextRequest }  from 'next/server'
import { extractUser }       from '@/lib/central/auth'
import { mapCentralError }   from '@/lib/central/errors'
import { ok }                from '@/lib/central/response'
import { createTagDefinitionService } from '@/modules/atendimento/services'

// GET /api/central/tag-definitions
//
// O catálogo de tags da organização, para o painel de detalhamento montar o
// seletor e traduzir as `key` gravadas em contacts.tags para rótulo e cor.
//
// Só as ativas: uma tag desativada não deve ser oferecida para aplicar. As já
// aplicadas continuam sendo exibidas pela tela, que cai no `key` cru quando não
// acha o rótulo — perder o rótulo é melhor que esconder a tag.
export async function GET(_request: NextRequest) {
  try {
    const { user, supabase } = await extractUser()

    const service = createTagDefinitionService(supabase)
    const tags    = await service.listar(user.orgId)

    return ok(tags)
  } catch (err) {
    return mapCentralError(err)
  }
}
