import type { NextRequest }  from 'next/server'
import { extractUser }       from '@/lib/central/auth'
import { mapComercialError } from '@/lib/comercial/errors'
import { ok, noContent, badRequest } from '@/lib/central/response'
import { createDealService } from '@/modules/comercial/services'
import type { DealPriority } from '@/modules/comercial/types/crm.types'

const PRIORIDADES: DealPriority[] = ['low', 'medium', 'high', 'urgent']

// No Next 16 os params de rota dinâmica são assíncronos — precisam de await.
type Ctx = { params: Promise<{ id: string }> }

// GET /api/crm/deals/:id — negócio com o contato embutido
export async function GET(_request: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const { user, supabase } = await extractUser()

    const deal = await createDealService(supabase).findById(id, user.orgId)
    return ok(deal)
  } catch (err) {
    return mapComercialError(err)
  }
}

// ============================================================================
// PATCH /api/crm/deals/:id
//
// Edição de campos do negócio. NÃO muda status nem estágio:
//   mover de coluna    → POST /api/crm/deals/:id/move
//   ganhar/perder      → POST /api/crm/deals/:id/status
//
// A separação é deliberada. Mudança de estágio dispara auto_win/auto_lose e
// grava a timeline; se o PATCH aceitasse stage_id, arrastar um card por essa
// rota pularia essas regras e o funil divergiria em silêncio.
// ============================================================================
export async function PATCH(request: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const { user, supabase } = await extractUser()

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return badRequest('Corpo inválido')

    if (body.priority && !PRIORIDADES.includes(body.priority)) {
      return badRequest(`priority inválida: ${body.priority}`, 'priority')
    }

    const patch: Record<string, unknown> = {}

    if (typeof body.title === 'string') {
      const t = body.title.trim()
      if (!t) return badRequest('title não pode ser vazio', 'title')
      patch.title = t
    }
    if (body.description !== undefined) patch.description = body.description
    if (body.priority    !== undefined) patch.priority    = body.priority
    if (body.tags        !== undefined && Array.isArray(body.tags)) patch.tags = body.tags
    if (body.assignedTo  !== undefined) patch.assigned_to  = body.assignedTo
    if (body.assigned_to !== undefined) patch.assigned_to  = body.assigned_to

    if (body.expectedCloseDate  !== undefined) patch.expected_close_date = body.expectedCloseDate
    if (body.expected_close_date !== undefined) patch.expected_close_date = body.expected_close_date

    if (body.value !== undefined) {
      if (body.value === null || body.value === '') {
        patch.value = null
      } else {
        const n = Number(body.value)
        if (!Number.isFinite(n) || n < 0) {
          return badRequest('value deve ser um número >= 0', 'value')
        }
        patch.value = n
      }
    }

    if (Object.keys(patch).length === 0) {
      return badRequest('Nenhum campo para atualizar')
    }

    const deal = await createDealService(supabase).atualizar(id, user.orgId, patch)
    return ok(deal)
  } catch (err) {
    return mapComercialError(err)
  }
}

// ----------------------------------------------------------------------------
// DELETE /api/crm/deals/:id
//
// Admin apenas (policy deals_delete_admin). Um director recebe 403 com
// mensagem explícita — o repositório detecta as 0 linhas afetadas, já que o
// PostgREST não erra nesse caso.
// ----------------------------------------------------------------------------
export async function DELETE(_request: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const { user, supabase } = await extractUser()

    await createDealService(supabase).excluir(id, user.orgId)
    return noContent()
  } catch (err) {
    return mapComercialError(err)
  }
}
