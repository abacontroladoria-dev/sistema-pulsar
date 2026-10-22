import { extractUser }     from '@/lib/central/auth'
import { mapCentralError } from '@/lib/central/errors'
import { ok }              from '@/lib/central/response'
import { createConversationService } from '@/modules/atendimento/services'

// GET /api/central/conversations/contagem → { abertas }
//
// O número do item "Atendimentos" no menu do Connect: conversas em Aberto — a
// Maia passou para a equipe (ou o número é só de gente) e ninguém falou ainda.
// Só a contagem, nenhuma linha: roda a cada poucos segundos por aba aberta.
//
// Client do usuário: a RLS de central.conversations decide, então cada pessoa
// conta só as caixas que enxerga — o mesmo número que a coluna "Aberto" da
// triagem mostra para ela.
export async function GET() {
  try {
    const { user, supabase } = await extractUser()
    const abertas = await createConversationService(supabase).contar({ orgId: user.orgId, status: 'open' })
    return ok({ abertas })
  } catch (err) {
    return mapCentralError(err)
  }
}
