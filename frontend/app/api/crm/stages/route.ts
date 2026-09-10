import type { NextRequest }  from 'next/server'
import { extractUser }       from '@/lib/central/auth'
import { mapComercialError } from '@/lib/comercial/errors'
import { ok, created, badRequest } from '@/lib/central/response'
import { createPipelineStageRepository } from '@/modules/comercial/services'

// ============================================================================
// GET /api/crm/stages
//
// As colunas do Kanban, ordenadas por `position`. Só estágios ativos.
//
// Uma lista vazia aqui NÃO é erro: significa que a organização ainda não tem
// funil configurado (ou que o seed de 20260701020400 rodou em outra org). O
// Kanban precisa distinguir isso de "erro ao carregar" — sem estágios ele deve
// oferecer a configuração do funil, não uma mensagem de falha.
// ============================================================================
export async function GET() {
  try {
    const { user, supabase } = await extractUser()

    const stages = await createPipelineStageRepository(supabase).list(user.orgId)
    return ok(stages)
  } catch (err) {
    return mapComercialError(err)
  }
}

// ============================================================================
// POST /api/crm/stages
//
// Cria uma coluna. ADMIN APENAS (policy pipeline_stages_insert_admin) — um
// director recebe 403 com mensagem explícita, porque o PostgREST devolveria
// sucesso com 0 linhas.
//
// `position` default = fim do funil. Colocar no fim é o único lugar que nunca
// colide com uq_pipeline_stage_org_position.
// ============================================================================
export async function POST(request: NextRequest) {
  try {
    const { user, supabase } = await extractUser()

    const body = await request.json().catch(() => null)
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    if (!title) return badRequest('title é obrigatório', 'title')

    const repo = createPipelineStageRepository(supabase)

    // Sem position explícita, entra no fim.
    let position = body?.position
    if (typeof position !== 'number') {
      const existentes = await repo.list(user.orgId, false)
      position = existentes.length
        ? Math.max(...existentes.map(s => s.position)) + 1
        : 0
    }

    const stage = await repo.create({
      organization_id: user.orgId,
      title,
      color:       body?.color ?? '#64748b',
      description: body?.description ?? null,
      position,
      auto_win:    body?.autoWin  ?? body?.auto_win  ?? false,
      auto_lose:   body?.autoLose ?? body?.auto_lose ?? false,
    })

    return created(stage)
  } catch (err) {
    return mapComercialError(err)
  }
}
