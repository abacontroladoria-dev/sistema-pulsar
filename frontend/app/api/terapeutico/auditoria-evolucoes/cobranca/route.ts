import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user }
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ success: false, error: 'Não autenticado' }, { status: 401 })
    }

    const body = await req.json()
    const { auditoriaId, auditoriaIds, novoStatus, observacao } = body

    if (!novoStatus) {
      return NextResponse.json({ success: false, error: 'novoStatus é obrigatório' }, { status: 400 })
    }

    // Buscar nome do usuário atual
    const { data: usuarioPerfil } = await supabase
      .from('usuarios')
      .select('nome')
      .eq('id', user.id)
      .maybeSingle()

    const usuarioNome = usuarioPerfil?.nome || user.email || 'Usuário'

    const idsParaAtualizar: string[] = Array.isArray(auditoriaIds)
      ? auditoriaIds
      : auditoriaId
      ? [auditoriaId]
      : []

    if (idsParaAtualizar.length === 0) {
      return NextResponse.json({ success: false, error: 'Nenhum ID de auditoria fornecido' }, { status: 400 })
    }

    const resultados: string[] = []

    for (const id of idsParaAtualizar) {
      const { data: atual } = await supabase
        .from('auditoria_evolucoes')
        .select('historico_cobranca')
        .eq('id', id)
        .single()

      const historico = Array.isArray(atual?.historico_cobranca) ? [...atual.historico_cobranca] : []
      
      historico.push({
        data: new Date().toISOString(),
        usuario: usuarioNome,
        acao: `Alterou status para ${novoStatus}`,
        observacao: observacao || undefined
      })

      const updatePayload: any = {
        status_cobranca: novoStatus,
        historico_cobranca: historico,
        updated_at: new Date().toISOString()
      }

      if (novoStatus === 'cobrado') {
        updatePayload.cobrado_em = new Date().toISOString()
        updatePayload.cobrado_por_nome = usuarioNome
      }

      const { error: updErr } = await supabase
        .from('auditoria_evolucoes')
        .update(updatePayload)
        .eq('id', id)

      if (!updErr) {
        resultados.push(id)
      }
    }

    return NextResponse.json({
      success: true,
      atualizados: resultados.length
    })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || 'Erro interno' }, { status: 500 })
  }
}
