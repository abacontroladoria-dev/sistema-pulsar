import type { NextRequest } from 'next/server'
import { extractUser }     from '@/lib/central/auth'
import { mapCentralError } from '@/lib/central/errors'
import { ok, badRequest, unprocessable } from '@/lib/central/response'

// Conversas fixadas por quem está logado (central.conversation_pins,
// 20261007120000). Tudo com o client do usuário: a RLS só deixa ver e mexer
// nas fixações da própria pessoa — não há o que conferir aqui além do corpo.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/central/conversations/fixadas → string[] (ids)
export async function GET() {
  try {
    const { supabase } = await extractUser()
    const { data, error } = await supabase
      .schema('central')
      .from('conversation_pins')
      .select('conversation_id')
      .order('created_at', { ascending: true })
    if (error) throw error
    return ok(((data ?? []) as { conversation_id: string }[]).map(r => r.conversation_id))
  } catch (err) {
    return mapCentralError(err)
  }
}

// POST { conversationId } fixa; DELETE { conversationId } desafixa.
export async function POST(request: NextRequest) {
  try {
    const { supabase } = await extractUser()
    const id = await lerId(request)
    if (!id) return badRequest('conversationId inválido')

    const { error } = await supabase
      .schema('central')
      .from('conversation_pins')
      .upsert({ conversation_id: id }, { onConflict: 'user_id,conversation_id', ignoreDuplicates: true })
    if (error) {
      if (error.hint === 'LIMITE_FIXADAS') return unprocessable('LIMITE_FIXADAS', error.message)
      throw error
    }
    return ok({ fixada: true })
  } catch (err) {
    return mapCentralError(err)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { supabase } = await extractUser()
    const id = await lerId(request)
    if (!id) return badRequest('conversationId inválido')

    const { error } = await supabase
      .schema('central')
      .from('conversation_pins')
      .delete()
      .eq('conversation_id', id)
    if (error) throw error
    return ok({ fixada: false })
  } catch (err) {
    return mapCentralError(err)
  }
}

async function lerId(request: NextRequest): Promise<string | null> {
  const json = await request.json().catch(() => null)
  const id = json?.conversationId
  return typeof id === 'string' && UUID.test(id) ? id : null
}
