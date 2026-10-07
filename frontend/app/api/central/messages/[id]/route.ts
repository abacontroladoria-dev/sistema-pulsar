import type { NextRequest } from 'next/server'
import { extractUser }     from '@/lib/central/auth'
import { mapCentralError } from '@/lib/central/errors'
import { ok, badRequest }  from '@/lib/central/response'
import { createMessageService } from '@/modules/atendimento/services'

type Ctx = { params: Promise<{ id: string }> }

// DELETE /api/central/messages/[id]
// O botão "Apagar" da bolha. Soft delete no Pulsar e, quando a mensagem é nossa,
// recente e saiu por número Evolution, também no WhatsApp do contato — ver
// utils/apagar-mensagem.ts. `apagadaNoWhatsapp` diz qual das duas aconteceu.
// Idempotente: mensagem já apagada ou inexistente responde 200 sem efeito.
export async function DELETE(_request: NextRequest, ctx: Ctx) {
  try {
    const { user, supabase } = await extractUser()
    const { id } = await ctx.params

    const service = createMessageService(supabase)
    return ok(await service.softDelete(id, user.id, user.orgId))
  } catch (err) {
    return mapCentralError(err)
  }
}

// PATCH /api/central/messages/[id]  { body: string }
// O lápis da bolha. Só texto nosso, por Evolution, nos últimos 15 minutos —
// ver podeEditar em utils/apagar-mensagem.ts. 422 quando a regra não vale.
export async function PATCH(request: NextRequest, ctx: Ctx) {
  try {
    const { user, supabase } = await extractUser()
    const { id } = await ctx.params

    const json  = await request.json().catch(() => null)
    const texto = typeof json?.body === 'string' ? json.body.trim() : ''
    if (!texto) return badRequest('body é obrigatório')
    if (texto.length > 4096) return badRequest('body acima de 4096 caracteres')

    const service = createMessageService(supabase)
    return ok(await service.editar(id, texto, user.id, user.orgId))
  } catch (err) {
    return mapCentralError(err)
  }
}
