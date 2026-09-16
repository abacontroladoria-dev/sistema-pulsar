import type { NextRequest }        from 'next/server'
import { extractUser }             from '@/lib/central/auth'
import { mapCentralError }         from '@/lib/central/errors'
import { ok, created, badRequest } from '@/lib/central/response'
import {
  parseListTasksQuery,
  parseCreateTaskBody,
} from '@/modules/atendimento/dto/task.dto'
import { createTaskService } from '@/modules/atendimento/services'

// GET /api/central/tasks
// As pendências de um contato ou de uma conversa.
// O painel de detalhamento chama com ?contactId=…&status=pending.
export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await extractUser()

    const parsed = parseListTasksQuery(request.nextUrl.searchParams)
    if (!parsed.ok) return badRequest(parsed.errors.join('; '))

    const { contactId, conversationId, status, limit, offset } = parsed.data

    const service = createTaskService(supabase)
    const result  = await service.listar({
      orgId: user.orgId, contactId, conversationId, status, limit, offset,
    })

    return ok(result.data, {
      total:   result.count,
      limit,
      offset,
      hasMore: offset + result.data.length < result.count,
    })
  } catch (err) {
    return mapCentralError(err)
  }
}

// POST /api/central/tasks
//
// `organization_id` e `created_by` vêm da sessão, nunca do corpo — o DTO nem os
// aceita. O vínculo (contactId ou conversationId) é obrigatório, espelhando o
// ck_tasks_vinculo da tabela: tarefa sem vínculo não apareceria em tela alguma.
export async function POST(request: NextRequest) {
  try {
    const { user, supabase } = await extractUser()

    const body   = await request.json().catch(() => null)
    const parsed = parseCreateTaskBody(body)
    if (!parsed.ok) return badRequest(parsed.errors.join('; '))

    const service = createTaskService(supabase)
    const tarefa  = await service.criar(user.orgId, parsed.data, user.id)

    return created(tarefa)
  } catch (err) {
    return mapCentralError(err)
  }
}
