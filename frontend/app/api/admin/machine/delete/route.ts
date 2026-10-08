import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'

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

export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request)
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })
  if (!(await isAdmin(user))) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  try {
    const { machineId } = await request.json()
    if (!machineId) return NextResponse.json({ error: 'machineId obrigatório' }, { status: 400 })

    const { error } = await supabaseService.from('maquinas').delete().eq('id', machineId)

    if (error) {
      // autorizacoes.machine_id aponta para maquinas(id) sem cascade: máquina com
      // histórico não pode sumir sem levar o rastro de quem autorizou o quê.
      if (error.code === '23503') {
        return NextResponse.json(
          { error: 'Esta máquina tem autorizações registradas e não pode ser excluída. Use "Desativar".' },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
