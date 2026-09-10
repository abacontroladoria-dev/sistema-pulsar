import type { NextRequest }   from 'next/server'
import { extractUser }        from '@/lib/central/auth'
import { mapComercialError }  from '@/lib/comercial/errors'
import { ok, created, badRequest } from '@/lib/central/response'
import { createDealService }  from '@/modules/comercial/services'
import type { DealStatus, DealPriority } from '@/modules/comercial/types/crm.types'

const STATUS_VALIDOS: DealStatus[]     = ['open', 'won', 'lost']
const PRIORIDADES: DealPriority[]      = ['low', 'medium', 'high', 'urgent']

// ============================================================================
// GET /api/crm/deals
//
// Lista os negócios da organização do usuário. Sem filtro de status devolve
// TUDO (open, won e lost) porque o Kanban precisa mostrar as colunas de
// fechamento também.
//
// Query params:
//   status  — 'open' | 'won' | 'lost' (repetível: ?status=open&status=won)
//   stageId — filtra uma coluna só
//   search  — ilike no título
//   limit   — default 500 (board inteiro), teto 1000
//   offset  — paginação
//
// O teto de 1000 não é arbitrário: o PostgREST corta QUALQUER resposta em
// max_rows sem sinalizar erro, então pedir mais devolveria uma página truncada
// que se parece com o resultado completo.
// ============================================================================
export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await extractUser()
    const params = request.nextUrl.searchParams

    const statusBruto = params.getAll('status').filter(Boolean)
    for (const s of statusBruto) {
      if (!STATUS_VALIDOS.includes(s as DealStatus)) {
        return badRequest(`status inválido: ${s}`, 'status')
      }
    }

    const limitBruto = Number(params.get('limit') ?? 500)
    if (!Number.isFinite(limitBruto) || limitBruto < 1 || limitBruto > 1000) {
      return badRequest('limit deve estar entre 1 e 1000', 'limit')
    }

    const offsetBruto = Number(params.get('offset') ?? 0)
    if (!Number.isFinite(offsetBruto) || offsetBruto < 0) {
      return badRequest('offset deve ser >= 0', 'offset')
    }

    const service = createDealService(supabase)
    const result  = await service.list({
      orgId:   user.orgId,
      status:  statusBruto.length ? (statusBruto as DealStatus[]) : undefined,
      stageId: params.get('stageId') ?? undefined,
      search:  params.get('search')  ?? undefined,
      limit:   limitBruto,
      offset:  offsetBruto,
    })

    return ok(result.data, {
      total:   result.count,
      limit:   limitBruto,
      offset:  offsetBruto,
      hasMore: offsetBruto + result.data.length < result.count,
    })
  } catch (err) {
    return mapComercialError(err)
  }
}

// ============================================================================
// POST /api/crm/deals
//
// Cria um negócio. `stageId` é opcional — sem ele o deal entra no primeiro
// estágio do funil, igual ao trigger crm.auto_create_deal_on_lead().
//
// organization_id NUNCA vem do corpo: é sempre o do usuário autenticado.
// Aceitar do cliente permitiria criar deal na org alheia (a policy barraria no
// insert, mas o erro seria obscuro e a tentativa não deve nem existir).
// ============================================================================
export async function POST(request: NextRequest) {
  try {
    const { user, supabase } = await extractUser()

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return badRequest('Corpo inválido')

    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) return badRequest('title é obrigatório', 'title')

    if (body.priority && !PRIORIDADES.includes(body.priority)) {
      return badRequest(`priority inválida: ${body.priority}`, 'priority')
    }

    // value chega como number ou string do formulário; normaliza e valida.
    let value: number | null = null
    if (body.value !== undefined && body.value !== null && body.value !== '') {
      const n = Number(body.value)
      if (!Number.isFinite(n) || n < 0) {
        return badRequest('value deve ser um número >= 0', 'value')
      }
      value = n
    }

    const service = createDealService(supabase)
    const deal    = await service.criar(
      {
        organization_id:     user.orgId,
        stage_id:            body.stageId ?? body.stage_id ?? undefined,
        title,
        contact_id:          body.contactId      ?? body.contact_id      ?? null,
        conversation_id:     body.conversationId ?? body.conversation_id ?? null,
        description:         body.description ?? null,
        value,
        priority:            body.priority ?? 'medium',
        expected_close_date: body.expectedCloseDate ?? body.expected_close_date ?? null,
        assigned_to:         body.assignedTo ?? body.assigned_to ?? null,
        source:              body.source ?? 'manual',
        source_campaign:     body.sourceCampaign ?? body.source_campaign ?? null,
        tags:                Array.isArray(body.tags) ? body.tags : undefined,
      },
      user.id
    )

    return created(deal)
  } catch (err) {
    return mapComercialError(err)
  }
}
