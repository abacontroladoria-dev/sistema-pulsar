import type { NextRequest } from 'next/server'
import { extractUser }     from '@/lib/central/auth'
import { mapCentralError } from '@/lib/central/errors'
import { ok, badRequest }  from '@/lib/central/response'
import { createNotaInternaService } from '@/modules/atendimento/services'

type Ctx = { params: Promise<{ id: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/central/conversations/[id]/mencionaveis
// Quem pode ser mencionado (@) numa nota desta conversa: admin/director da
// organização ou membro da caixa dela — inclusive quem pergunta, que pode se
// marcar como lembrete. É o mesmo recorte
// que a RLS das notas usa para decidir quem lê — e o mesmo que o POST da nota
// confere de novo no servidor.
export async function GET(_request: NextRequest, ctx: Ctx) {
  try {
    const { user, supabase } = await extractUser()
    const { id } = await ctx.params
    if (!UUID.test(id)) return badRequest('id da conversa inválido')

    const lista = await createNotaInternaService(supabase).mencionaveis(user.orgId, id)
    return ok(lista)
  } catch (err) {
    return mapCentralError(err)
  }
}
