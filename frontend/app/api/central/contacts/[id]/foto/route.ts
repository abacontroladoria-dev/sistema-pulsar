import { NextResponse, type NextRequest } from 'next/server'
import { extractUser }     from '@/lib/central/auth'
import { mapCentralError } from '@/lib/central/errors'
import { supabaseService } from '@/lib/supabase/service'

type Ctx = { params: Promise<{ id: string }> }

// GET /api/central/contacts/[id]/foto
// A foto de perfil do contato, copiada pelo worker `avatar` para o bucket
// PRIVADO central-avatares. O portão é ler o contato com o client do usuário
// (RLS): quem não enxerga o contato recebe 404, não a foto. Daí o redirect para
// uma URL assinada curta.
export async function GET(_request: NextRequest, ctx: Ctx) {
  try {
    const { user, supabase } = await extractUser()
    const { id } = await ctx.params

    const { data: contato } = await supabase
      .schema('central')
      .from('contacts')
      .select('id, organization_id')
      .eq('id', id)
      .maybeSingle()
    if (!contato || contato.organization_id !== user.orgId) {
      return new NextResponse(null, { status: 404 })
    }

    const { data, error } = await supabaseService.storage
      .from('central-avatares')
      .createSignedUrl(`${user.orgId}/${id}.jpg`, 3600)
    if (error || !data?.signedUrl) return new NextResponse(null, { status: 404 })

    const res = NextResponse.redirect(data.signedUrl, 302)
    // Privado ao navegador de quem está logado; a URL da tela já muda (`?v=`)
    // quando a foto muda.
    res.headers.set('Cache-Control', 'private, max-age=3000')
    return res
  } catch (err) {
    return mapCentralError(err)
  }
}
