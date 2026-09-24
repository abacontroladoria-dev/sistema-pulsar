import { extractUser }     from '@/lib/central/auth'
import { mapCentralError } from '@/lib/central/errors'
import { ok }              from '@/lib/central/response'

// GET /api/central/channels/acessiveis
// Os números que ESTE usuário pode atender — é o que alimenta o seletor de
// números da /connect/inbox.
//
// Com o client do usuário, de propósito: quem decide é a RLS. Admin e director
// veem todos os canais da organização; operator vê os das inboxes em que é
// membro (20260924180200). Diferente de /api/central/channels, inclui os números
// desconectados: a atendente precisa ver que o número caiu, e não que sumiu.
export async function GET() {
  try {
    const { user, supabase } = await extractUser()

    const { data, error } = await supabase
      .schema('central')
      .from('channels')
      .select('id, name, provider, status')
      .eq('organization_id', user.orgId)
      .eq('active', true)
      .order('provider', { ascending: false })
      .order('name')

    if (error) throw error
    return ok(data ?? [])
  } catch (err) {
    return mapCentralError(err)
  }
}
