import { NextResponse } from 'next/server'
import { exigirPermissaoAuditoria, respostaDeErroAuth } from '@/lib/auditoria/auth'
import { auditarEPersistir, COLUNAS_GRADE, type GradeParaAuditar } from '@/lib/auditoria/auditarEPersistir'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const { supabase } = await exigirPermissaoAuditoria()

    const body = await req.json()
    const { gradeIds, limite = 10, dataInicio = '2026-09-01', dataFim, reauditar = false } = body

    // 1. Obter registros de grade para auditar
    let query = supabase
      .from('csv_grades_profissionais')
      .select(COLUNAS_GRADE)
      .gte('data', dataInicio)
      .eq('ativo', true)
      .not('descricao_evolucao', 'is', null)
      .neq('descricao_evolucao', '')

    if (dataFim) {
      query = query.lte('data', dataFim)
    }

    if (Array.isArray(gradeIds) && gradeIds.length > 0) {
      query = query.in('id', gradeIds)
    }

    const { data: itens, error: queryErr } = await query

    if (queryErr) {
      return NextResponse.json({ success: false, error: queryErr.message }, { status: 500 })
    }

    if (!itens || itens.length === 0) {
      return NextResponse.json({ success: true, processados: 0, mensagem: 'Nenhuma evolução encontrada para auditar.' })
    }

    // Se não foi pedido para reauditar, filtrar os que já têm auditoria salva
    let pendentes = itens
    if (!reauditar && (!gradeIds || gradeIds.length > 1)) {
      const { data: jaAuditados } = await supabase
        .from('auditoria_evolucoes')
        .select('grade_id')
        .in('grade_id', itens.map(i => i.id))

      const setAuditados = new Set(jaAuditados?.map(a => a.grade_id) || [])
      pendentes = itens.filter(i => !setAuditados.has(i.id))
    }

    // Limitar o lote para não estourar tempo de resposta
    const lote = pendentes.slice(0, limite)

    if (lote.length === 0) {
      return NextResponse.json({ success: true, processados: 0, mensagem: 'Todas as evoluções do período já foram auditadas.' })
    }

    const { processados, falhas, criteriosVersao } = await auditarEPersistir(
      supabase,
      lote as GradeParaAuditar[]
    )

    return NextResponse.json({
      success: true,
      processados: processados.length,
      total_solicitados: lote.length,
      itens: processados,
      falhas,
      criterios_versao: criteriosVersao
    })
  } catch (err: any) {
    const authErr = respostaDeErroAuth(err)
    if (authErr) {
      return NextResponse.json({ success: false, error: authErr.error }, { status: authErr.status })
    }
    return NextResponse.json({ success: false, error: err.message || 'Erro interno no servidor' }, { status: 500 })
  }
}
