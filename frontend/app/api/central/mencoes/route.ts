import type { NextRequest } from 'next/server'
import { extractUser }     from '@/lib/central/auth'
import { mapCentralError } from '@/lib/central/errors'
import { ok, badRequest }  from '@/lib/central/response'
import { parseListarMencoesQuery } from '@/modules/atendimento/dto/nota-interna.dto'
import { createMencaoService }     from '@/modules/atendimento/services'

// GET /api/central/mencoes?status=nao_lidas|lidas|todas&limit=&before=
// As menções a quem está logado — "Menções a mim" e o aviso da página inicial.
// Mais nova primeiro; `before` é o criadaEm da última da página anterior.
export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await extractUser()

    const parsed = parseListarMencoesQuery(request.nextUrl.searchParams)
    if (!parsed.ok) return badRequest(parsed.errors.join('; '))

    const lista = await createMencaoService(supabase).listar({
      orgId:   user.orgId,
      userId:  user.id,
      filtro:  parsed.data.filtro,
      limit:   parsed.data.limit,
      antesDe: parsed.data.antesDe,
    })

    return ok(lista, {
      limit:      parsed.data.limit,
      hasMore:    lista.length === parsed.data.limit,
      nextCursor: lista.at(-1)?.criadaEm,
    })
  } catch (err) {
    return mapCentralError(err)
  }
}
