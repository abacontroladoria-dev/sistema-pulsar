import type { NextRequest } from 'next/server'
import { extractUser }      from '@/lib/central/auth'
import { mapCentralError }  from '@/lib/central/errors'
import { ok, badRequest }   from '@/lib/central/response'
import { parsePatchTaskBody } from '@/modules/atendimento/dto/task.dto'
import { createTaskService }  from '@/modules/atendimento/services'

type Ctx = { params: Promise<{ id: string }> }

// PATCH /api/central/tasks/[id]
//
// Ações de estado separadas da edição de campos porque `status` e
// `completed_at` precisam ser escritos JUNTOS — ck_tasks_conclusao recusa um
// sem o outro. Um PATCH genérico que aceitasse `status` solto produziria 500
// toda vez que alguém o usasse.
//
// 'cancel' existe ao lado de 'complete' porque "decidimos não fazer" é
// informação diferente de "foi feito", e apagar a linha perderia as duas.
export async function PATCH(request: NextRequest, ctx: Ctx) {
  try {
    const { user, supabase } = await extractUser()
    const { id } = await ctx.params

    const body   = await request.json().catch(() => null)
    const parsed = parsePatchTaskBody(body)
    if (!parsed.ok) return badRequest(parsed.errors.join('; '))

    const service = createTaskService(supabase)
    const d       = parsed.data

    if (d.action === 'update') {
      const { action: _acao, ...campos } = d
      const tarefa = await service.atualizar(user.orgId, id, campos, user.id)
      return ok(tarefa)
    }

    const status = d.action === 'complete' ? 'done'
                 : d.action === 'cancel'   ? 'cancelled'
                 : 'pending'   // reopen

    const tarefa = await service.mudarStatus(user.orgId, id, status, user.id)
    return ok(tarefa)
  } catch (err) {
    return mapCentralError(err)
  }
}
