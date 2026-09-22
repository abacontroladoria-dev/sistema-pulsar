import { NextResponse } from 'next/server'
import { exigirPermissaoAuditoria, respostaDeErroAuth } from '@/lib/auditoria/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    // Sem isto, qualquer usuário logado alterava cobrança de qualquer
    // profissional: o matcher do proxy.ts não cobre /api.
    const { supabase, usuarioNome } = await exigirPermissaoAuditoria()

    const body = await req.json()
    const { auditoriaId, auditoriaIds, novoStatus, observacao } = body

    if (!novoStatus) {
      return NextResponse.json({ success: false, error: 'novoStatus é obrigatório' }, { status: 400 })
    }

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
    const authErr = respostaDeErroAuth(err)
    if (authErr) {
      return NextResponse.json({ success: false, error: authErr.error }, { status: authErr.status })
    }
    return NextResponse.json({ success: false, error: err.message || 'Erro interno' }, { status: 500 })
  }
}
