import { NextResponse } from 'next/server'
import { auditarEvolucaoComIA } from '@/lib/auditoria/auditorEngine'
import { exigirPermissaoAuditoria, respostaDeErroAuth } from '@/lib/auditoria/auth'
import { carregarCriteriosVigentes } from '@/lib/auditoria/criterios'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const { supabase } = await exigirPermissaoAuditoria()

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
    const falhas: { grade_id: string; paciente_nome: string; motivo: string }[] = []

    // Fora do loop: os critérios valem para o lote inteiro, e o loop é
    // sequencial — resolver aqui evita N leituras do banco e garante que todas
    // as linhas do lote fiquem carimbadas com a MESMA versão.
    const { criterios, versaoId, versaoNumero } = await carregarCriteriosVigentes(supabase)

    for (const item of lote) {
      try {
        const analise = await auditarEvolucaoComIA({
          pacienteNome: item.paciente_nome || 'Paciente',
          profissionalNome: item.profissional_nome || 'Profissional',
          terapiaNome: item.terapia_nome,
          dataSessao: item.data,
          textoOriginal: item.descricao_evolucao || '',
          criterios
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
          criterios_versao_id: versaoId,
          criterios_versao_numero: versaoNumero,
          // Deu certo agora: limpa o erro de uma tentativa anterior.
          erro_auditoria: null,
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
          falhas.push({
            grade_id: item.id,
            paciente_nome: item.paciente_nome || 'Paciente',
            motivo: upsertErr.message
          })
        } else {
          resultadosProcessados.push(upsertData)
        }
      } catch (itemErr: any) {
        const motivo = itemErr?.message || 'Erro desconhecido'
        console.error(`[Auditoria] Falha ao processar item ${item.id}:`, motivo)
        falhas.push({
          grade_id: item.id,
          paciente_nome: item.paciente_nome || 'Paciente',
          motivo
        })

        // `status_risco` é NOT NULL + CHECK: não existe veredito "erro". Então
        // só dá para registrar a falha onde JÁ existe uma auditoria anterior —
        // o veredito antigo fica preservado e a tela o marca como desatualizado.
        // Item nunca auditado não vira linha: some da lista de auditados e
        // aparece em `falhas`, que a tela informa. O que não pode acontecer é o
        // que acontecia antes: inventar um veredito para a linha.
        const { error: erroMarcacao } = await supabase
          .from('auditoria_evolucoes')
          .update({ erro_auditoria: motivo, updated_at: new Date().toISOString() })
          .eq('grade_id', item.id)

        if (erroMarcacao) {
          console.error('[Auditoria] Falha ao registrar erro_auditoria:', erroMarcacao.message)
        }
      }
    }

    return NextResponse.json({
      success: true,
      processados: resultadosProcessados.length,
      total_solicitados: lote.length,
      itens: resultadosProcessados,
      falhas,
      criterios_versao: versaoNumero
    })
  } catch (err: any) {
    const authErr = respostaDeErroAuth(err)
    if (authErr) {
      return NextResponse.json({ success: false, error: authErr.error }, { status: authErr.status })
    }
    return NextResponse.json({ success: false, error: err.message || 'Erro interno no servidor' }, { status: 500 })
  }
}
