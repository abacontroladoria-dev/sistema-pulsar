import type { NextRequest } from 'next/server'
import { extractUser }       from '@/lib/central/auth'
import { mapCentralError }   from '@/lib/central/errors'
import { ok, created, badRequest } from '@/lib/central/response'
import { parseCriarNotaBody } from '@/modules/atendimento/dto/nota-interna.dto'
import { createNotaInternaService } from '@/modules/atendimento/services'

type Ctx = { params: Promise<{ id: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/central/conversations/[id]/notas
// As notas internas da conversa, da mais antiga para a mais nova, com os nomes
// de autor, mencionados e de quem recebeu a conversa. O inbox chama junto do
// detalhe, no mesmo tique de 5s.
//
// Migration ainda não aplicada → [] (a conversa abre normalmente, sem notas).
export async function GET(_request: NextRequest, ctx: Ctx) {
  try {
    const { user, supabase } = await extractUser()
    const { id } = await ctx.params
    if (!UUID.test(id)) return badRequest('id da conversa inválido')

    const notas = await createNotaInternaService(supabase).listar(user.orgId, id)
    return ok(notas)
  } catch (err) {
    return mapCentralError(err)
  }
}

// POST /api/central/conversations/[id]/notas
// { body, mencoes: uuid[], delegarPara?: uuid | null }
//
// A nota NUNCA vai ao WhatsApp: este caminho não conhece MessageService nem
// provider. Autor e organização vêm da sessão, nunca do corpo.
export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const { user, supabase } = await extractUser()
    const { id } = await ctx.params
    if (!UUID.test(id)) return badRequest('id da conversa inválido')

    const parsed = parseCriarNotaBody(await request.json().catch(() => null))
    if (!parsed.ok) return badRequest(parsed.errors.join('; '))

    const nota = await createNotaInternaService(supabase).criar(user.orgId, id, parsed.data, user.id)
    return created(nota)
  } catch (err) {
    return mapCentralError(err)
  }
}
