import type { NextRequest } from 'next/server'
import { extractUser }     from '@/lib/central/auth'
import { mapCentralError } from '@/lib/central/errors'
import { ok }              from '@/lib/central/response'
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
