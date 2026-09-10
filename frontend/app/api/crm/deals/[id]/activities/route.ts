import type { NextRequest }  from 'next/server'
import { extractUser }       from '@/lib/central/auth'
import { mapComercialError } from '@/lib/comercial/errors'
import { ok, created, badRequest } from '@/lib/central/response'
import { createDealActivityRepository, createDealService } from '@/modules/comercial/services'
import type { DealActivityType } from '@/modules/comercial/types/crm.types'

type Ctx = { params: Promise<{ id: string }> }

const TIPOS: DealActivityType[] = [
  'note', 'call', 'email', 'meeting', 'task', 'status_change', 'ai_analysis',
]

// GET /api/crm/deals/:id/activities — timeline, mais recente primeiro
export async function GET(_request: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const { user, supabase } = await extractUser()

    // Confirma que o negócio existe e é visível para este usuário antes de
    // listar. Sem isso, um id de outra org devolveria [] — indistinguível de
    // "negócio sem atividades".
    await createDealService(supabase).findById(id, user.orgId)

    const activities = await createDealActivityRepository(supabase)
      .listByDeal(id, user.orgId)

    return ok(activities)
  } catch (err) {
    return mapComercialError(err)
  }
}

// ============================================================================
// POST /api/crm/deals/:id/activities
// Body: { type, title?, description? }
//
// Registra nota, ligação, reunião ou tarefa na timeline.
//
// created_by é sempre o usuário autenticado e created_by_ai é sempre false:
// atividade criada por esta rota é humana por definição. A IA escreve pelo
// caminho do worker, com created_by = null — é o que permite distinguir na
// timeline quem escreveu o quê.
//
// 'status_change' é aceito no enum mas não deveria vir por aqui: quem o emite
// é o DealService ao mover/fechar. Não bloqueio para não travar um uso
// legítimo de correção manual, mas o normal é a UI oferecer só note/call/
// email/meeting/task.
// ============================================================================
export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const { user, supabase } = await extractUser()

    const body = await request.json().catch(() => null)
    const type = body?.type

    if (!TIPOS.includes(type)) {
      return badRequest(`type deve ser um de: ${TIPOS.join(', ')}`, 'type')
    }

    const title       = typeof body?.title === 'string' ? body.title.trim() : ''
    const description = typeof body?.description === 'string' ? body.description.trim() : ''

    // Uma atividade sem título nem descrição é uma linha em branco na timeline.
    if (!title && !description) {
      return badRequest('Informe ao menos title ou description')
    }

    await createDealService(supabase).findById(id, user.orgId)

    const activity = await createDealActivityRepository(supabase).create({
      organization_id: user.orgId,
      deal_id:         id,
      type,
      title:           title || null,
      description:     description || null,
      created_by:      user.id,
      created_by_ai:   false,
    })

    return created(activity)
  } catch (err) {
    return mapComercialError(err)
  }
}
