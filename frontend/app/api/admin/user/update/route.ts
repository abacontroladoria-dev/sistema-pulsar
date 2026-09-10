import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import { checkRateLimit } from '@/lib/rate-limit'
import { UNIDADES_DISPONIVEIS } from '@/lib/admin/unidades'

const ROLES_VALIDAS = ['admin', 'recepcao', 'diretoria', 'terapeutico', 'faturamento', 'autorizacao', 'rp', 'cronograma', 'disponibilidade_terapeuta', 'marketing']

async function getCurrentUser(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user } } = await supabaseService.auth.getUser(token)
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

// Salva role + unidades em uma única requisição (o admin edita os dois campos
// na tabela e confirma com um botão "Salvar" em vez de cada clique disparar
// uma chamada separada).
export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request)
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })
  if (!(await isAdmin(user))) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const rateLimitKey = `admin:update-user:${user.id}`
  if (checkRateLimit(rateLimitKey, 10, 60 * 1000)) {
    return NextResponse.json(
      { error: 'Too many admin operations. Please try again in a moment.' },
      { status: 429 }
    )
  }

  try {
    const { userId, role, unidades } = await request.json()

    if (!userId || !role || !ROLES_VALIDAS.includes(role) || !Array.isArray(unidades)) {
      return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })
    }

    const unidadeInvalida = unidades.find((u) => !UNIDADES_DISPONIVEIS.includes(u))
    if (unidadeInvalida) {
      return NextResponse.json({ error: `unidade_invalida: ${unidadeInvalida}` }, { status: 400 })
    }

    const { error } = await supabaseService
      .from('usuarios')
      .update({ role, unidades: unidades.length > 0 ? unidades : null })
      .eq('id', userId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
