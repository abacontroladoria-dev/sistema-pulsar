import type { NextRequest }  from 'next/server'
import { extractUser }       from '@/lib/central/auth'
import { mapComercialError } from '@/lib/comercial/errors'
import { ok, badRequest }    from '@/lib/central/response'
import { createDealService } from '@/modules/comercial/services'

type Ctx = { params: Promise<{ id: string }> }

// ============================================================================
// POST /api/crm/deals/:id/move
// Body: { stageId: string }
//
// Move o negócio para outra coluna do Kanban. Rota própria (em vez de um campo
// no PATCH) porque mover NÃO é só gravar stage_id:
//
//   1. valida que o estágio destino é da MESMA organização — sem isso o deal
//      sairia do board sem aparecer em nenhum outro
//   2. aplica auto_win / auto_lose do estágio destino, que o banco não aplica
//      sozinho (não há trigger; a migration documenta a intenção)
//   3. registra a mudança na timeline do negócio
//
// Ter isso numa rota separada torna impossível mover um card sem passar pelas
// três etapas.
// ============================================================================
export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const { user, supabase } = await extractUser()

    const body = await request.json().catch(() => null)
    const stageId = body?.stageId ?? body?.stage_id

    if (!stageId || typeof stageId !== 'string') {
      return badRequest('stageId é obrigatório', 'stageId')
    }

    const deal = await createDealService(supabase)
      .moverParaEstagio(id, user.orgId, stageId, user.id)

    return ok(deal)
  } catch (err) {
    return mapComercialError(err)
  }
}
