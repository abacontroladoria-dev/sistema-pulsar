import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import { checkRateLimit } from '@/lib/rate-limit'

// Liga (ou desliga) o login de um terapeuta do app ao seu cadastro em
// public.profissionais. É essa ligação que decide de quem é a agenda que ele vê
// e evolui no app, por isso só admin grava — e pelo servidor: a coluna está na
// trava de usuarios (20261019170000), o próprio usuário não se liga a ninguém.
// Um login por profissional: índice único uq_usuarios_profissional_id (20261019200000).

async function getCurrentUser(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user } } = await supabaseService.auth.getUser(token)
  return user
}

async function isAdmin(userId: string) {
  const { data: perfil } = await supabaseService
    .from('usuarios')
    .select('role, ativo')
    .eq('id', userId)
    .maybeSingle()
  return perfil?.role === 'admin' && perfil?.ativo === true
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request)
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })
  if (!(await isAdmin(user.id))) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  if (checkRateLimit(`admin:user-profissional:${user.id}`, 20, 60 * 1000)) {
    return NextResponse.json({ error: 'Muitas alterações seguidas. Tente de novo em instantes.' }, { status: 429 })
  }

  try {
    const { userId, profissionalId } = await request.json()
    const desligar = profissionalId === null

    if (typeof userId !== 'string' || (!desligar && !Number.isInteger(profissionalId))) {
      return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })
    }

    const { data: alvo } = await supabaseService
      .from('usuarios')
      .select('role')
      .eq('id', userId)
      .maybeSingle()
    if (!alvo) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 })
    if (!desligar && alvo.role !== 'terapeuta') {
      return NextResponse.json(
        { error: 'Só usuário do grupo "Terapeuta (App)" é ligado a um profissional.' },
        { status: 400 }
      )
    }

    if (!desligar) {
      const { data: profissional } = await supabaseService
        .from('profissionais')
        .select('ativo')
        .eq('id', profissionalId)
        .maybeSingle()
      if (!profissional?.ativo) {
        return NextResponse.json({ error: 'Profissional não encontrado ou inativo.' }, { status: 400 })
      }
    }

    const { error } = await supabaseService
      .from('usuarios')
      .update({ profissional_id: desligar ? null : profissionalId })
      .eq('id', userId)

    if (error?.code === '23505') {
      return NextResponse.json({ error: 'Este profissional já está ligado a outro usuário.' }, { status: 409 })
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
