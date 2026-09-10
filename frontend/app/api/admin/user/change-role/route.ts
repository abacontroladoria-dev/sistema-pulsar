import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

function buildCookieStore(request: NextRequest) {
  return {
    getAll() {
      return request.cookies.getAll()
    },
    setAll(cookies: any) {
      // no-op in API route
    },
  }
}

async function getCurrentUser(request: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: buildCookieStore(request),
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  return user
}

async function isAdmin(user: any) {
  if (!user) return false

  const { data: perfil } = await supabaseService
    .from('usuarios')
    .select('role, ativo')
    .eq('id', user.id)
    .single()

  if (!perfil && user.email) {
    const fallback = await supabaseService
      .from('usuarios')
      .select('role, ativo')
      .eq('email', user.email)
      .single()
    return fallback.data?.role === 'admin' && fallback.data?.ativo
  }

  return perfil?.role === 'admin' && perfil?.ativo
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request)

  if (!user) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })
  }

  if (!(await isAdmin(user))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Rate limit: 10 admin operations per minute per user
  const rateLimitKey = `admin:change-role:${user.id}`
  if (checkRateLimit(rateLimitKey, 10, 60 * 1000)) {
    return NextResponse.json(
      { error: 'Too many admin operations. Please try again in a moment.' },
      { status: 429 }
    )
  }

  const body = await request.json()
  const { userId, role } = body as { userId: string; role: string }

  const ROLES_VALIDAS = ['admin', 'recepcao', 'diretoria', 'terapeutico', 'faturamento', 'autorizacao', 'rp', 'cronograma', 'disponibilidade_terapeuta', 'marketing']

  if (!userId || !role || !ROLES_VALIDAS.includes(role)) {
    return NextResponse.json(
      { error: 'invalid_payload' },
      { status: 400 }
    )
  }

  const { error } = await supabaseService
    .from('usuarios')
    .update({ role })
    .eq('id', userId)

  if (error) {
    return NextResponse.json(
      { error: 'update_failed', message: error.message },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true })
}
