import type { NextRequest }  from 'next/server'
import { extractUser }       from '@/lib/central/auth'
import { mapComercialError } from '@/lib/comercial/errors'
import { ok, badRequest }    from '@/lib/central/response'
import { createDealService } from '@/modules/comercial/services'

type Ctx = { params: Promise<{ id: string }> }

// ============================================================================
// POST /api/crm/deals/:id/status
// Body: { status: 'won' | 'lost' | 'open', reason?: string }
//
// Fecha ou reabre um negócio.
//
// `reason` é OBRIGATÓRIO para 'lost'. O motivo da perda é o dado que sustenta
// qualquer análise de "por que não fechamos" — permitir perda sem motivo
// produziria uma coluna de perdidos impossível de interpretar depois. A UI já
// exige (LostReasonModal), e a API exige também: validação de cliente não é
// validação.
//
// Reabrir ('open') pode colidir com uq_open_deal_per_contact quando o contato
// já tem outro negócio aberto — vira 409 com mensagem explícita.
// ============================================================================
export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const { user, supabase } = await extractUser()

    const body   = await request.json().catch(() => null)
    const status = body?.status

    if (!['won', 'lost', 'open'].includes(status)) {
      return badRequest("status deve ser 'won', 'lost' ou 'open'", 'status')
    }

    const service = createDealService(supabase)

    if (status === 'won') {
      return ok(await service.marcarGanho(id, user.orgId, user.id))
    }

    if (status === 'lost') {
      const motivo = typeof body?.reason === 'string' ? body.reason.trim() : ''
      if (!motivo) {
        return badRequest('reason é obrigatório ao marcar como perdido', 'reason')
      }
      return ok(await service.marcarPerdido(id, user.orgId, motivo, user.id))
    }

    return ok(await service.reabrir(id, user.orgId, user.id))
  } catch (err) {
    return mapComercialError(err)
  }
}
