import { extractUser }     from '@/lib/central/auth'
import { mapCentralError } from '@/lib/central/errors'
import { ok }              from '@/lib/central/response'
import { createMencaoService } from '@/modules/atendimento/services'

// GET /api/central/mencoes/contagem → { naoLidas }
// O número do item "Menções a mim" no menu do Connect. Só a contagem, nenhuma
// linha: roda a cada 30s por aba aberta.
export async function GET() {
  try {
    const { user, supabase } = await extractUser()
    const naoLidas = await createMencaoService(supabase).contarNaoLidas(user.id)
    return ok({ naoLidas })
  } catch (err) {
    return mapCentralError(err)
  }
}
