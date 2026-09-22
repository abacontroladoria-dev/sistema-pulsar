import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { auditarEvolucaoComIA } from '@/lib/auditoria/auditorEngine'

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
    const { gradeIds, limite = 10, dataInicio = '2026-09-01', dataFim, reauditar = false } = body

    // 1. Obter registros de grade para auditar
    let query = supabase
      .from('csv_grades_profissionais')
      .select(`
        id,
        tita_agendamento_id,
        data,
        profissional_id,
        profissional_nome,
        paciente_id,
        paciente_nome,
        terapia_nome,
        unidade_id,
        unidade_nome,
        descricao_evolucao
      `)
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

    const resultadosProcessados: any[] = []

    for (const item of lote) {
      try {
        const analise = await auditarEvolucaoComIA({
          pacienteNome: item.paciente_nome || 'Paciente',
          profissionalNome: item.profissional_nome || 'Profissional',
          terapiaNome: item.terapia_nome,
          dataSessao: item.data,
          textoOriginal: item.descricao_evolucao || ''
        })

        const record = {
          grade_id: item.id,
          tita_agendamento_id: item.tita_agendamento_id,
          data_sessao: item.data,
          profissional_id: item.profissional_id,
          profissional_nome: item.profissional_nome || 'Profissional',
          paciente_id: item.paciente_id,
          paciente_nome: item.paciente_nome || 'Paciente',
          terapia_nome: item.terapia_nome,
          unidade_id: item.unidade_id,
          unidade_nome: item.unidade_nome,
          texto_original: item.descricao_evolucao,
          status_risco: analise.status_risco,
          resumo_justificativa: analise.resumo_justificativa,
          apontamentos: analise.apontamentos,
          checklist_perguntas: analise.checklist_perguntas,
          inconsistencias_estruturais: analise.inconsistencias_estruturais,
          texto_revisado: analise.texto_revisado,
          modelo_ia: analise.modelo_usado,
          auditado_em: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }

        const { data: upsertData, error: upsertErr } = await supabase
          .from('auditoria_evolucoes')
          .upsert(record, { onConflict: 'grade_id' })
          .select()
          .single()

        if (upsertErr) {
          console.error('[Auditoria] Erro ao gravar auditoria:', upsertErr)
        } else {
          resultadosProcessados.push(upsertData)
        }
      } catch (itemErr: any) {
        console.error(`[Auditoria] Falha ao processar item ${item.id}:`, itemErr.message)
      }
    }

    return NextResponse.json({
      success: true,
      processados: resultadosProcessados.length,
      total_solicitados: lote.length,
      itens: resultadosProcessados
    })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || 'Erro interno no servidor' }, { status: 500 })
  }
}
