import { getSupabaseClient } from '@/lib/supabase/client'
import type { 
  RegistroAuditoriaEvolucao,
  EvolucaoPendenteAuditoria,
  ResumoProfissionalAuditoria,
  StatusCobrancaEvolucao,
  StatusRiscoEvolucao
} from '@/types/auditoriaEvolucoes'

export interface FiltrosAuditoriaEvolucoes {
  dataInicio?: string
  dataFim?: string
  profissionalId?: number | null
  unidadeId?: number | null
  statusRisco?: StatusRiscoEvolucao | 'todos'
  statusCobranca?: StatusCobrancaEvolucao | 'todos'
  apenasComEvolucao?: boolean
  busca?: string
}

const DATA_CORTE_PADRAO = '2026-09-01'

/**
 * Busca evoluções de `csv_grades_profissionais` e seus resultados de auditoria em `auditoria_evolucoes`
 * Restrito por padrão a partir de 01/09/2026.
 */
export async function buscarEvolucoesComAuditoria(
  filtros: FiltrosAuditoriaEvolucoes = {}
): Promise<{ data: EvolucaoPendenteAuditoria[]; error: string | null }> {
  const supabase = getSupabaseClient()
  
  const dataInicio = filtros.dataInicio || DATA_CORTE_PADRAO
  
  try {
    // 1. Buscar sessões com evolução preenchida
    let queryGrade = supabase
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
        descricao_evolucao,
        status_execucao
      `)
      .gte('data', dataInicio)
      .eq('ativo', true)
      .not('descricao_evolucao', 'is', null)
      .neq('descricao_evolucao', '')
      .order('data', { ascending: false })

    if (filtros.dataFim) {
      queryGrade = queryGrade.lte('data', filtros.dataFim)
    }
    if (filtros.profissionalId) {
      queryGrade = queryGrade.eq('profissional_id', filtros.profissionalId)
    }
    if (filtros.unidadeId) {
      queryGrade = queryGrade.eq('unidade_id', filtros.unidadeId)
    }

    const { data: gradeRows, error: gradeErr } = await queryGrade

    if (gradeErr) {
      return { data: [], error: `Erro ao buscar grade: ${gradeErr.message}` }
    }

    if (!gradeRows || gradeRows.length === 0) {
      return { data: [], error: null }
    }

    // 2. Buscar registros de auditoria correspondentes
    const gradeIds = gradeRows.map(r => r.id)
    
    // Chunking to prevent URL length limits if gradeIds is huge
    const chunkSize = 200
    const auditoriaMap = new Map<string, RegistroAuditoriaEvolucao>()

    for (let i = 0; i < gradeIds.length; i += chunkSize) {
      const chunk = gradeIds.slice(i, i + chunkSize)
      const { data: audRows, error: audErr } = await supabase
        .from('auditoria_evolucoes')
        .select('*')
        .in('grade_id', chunk)

      if (!audErr && audRows) {
        for (const a of audRows) {
          auditoriaMap.set(a.grade_id, a as unknown as RegistroAuditoriaEvolucao)
        }
      }
    }

    // 3. Mesclar resultados
    let resultado: EvolucaoPendenteAuditoria[] = gradeRows.map(r => {
      const auditoria = auditoriaMap.get(r.id) || null
      return {
        grade_id: r.id,
        tita_agendamento_id: r.tita_agendamento_id,
        data_sessao: r.data,
        profissional_id: r.profissional_id,
        profissional_nome: r.profissional_nome || 'Profissional não identificado',
        paciente_id: r.paciente_id,
        paciente_nome: r.paciente_nome || 'Paciente não identificado',
        terapia_nome: r.terapia_nome,
        unidade_id: r.unidade_id,
        unidade_nome: r.unidade_nome,
        texto_original: r.descricao_evolucao || '',
        status_execucao: r.status_execucao,
        auditoria
      }
    })

    // Aplicar filtros de status_risco e status_cobranca em memória caso solicitados
    if (filtros.statusRisco && filtros.statusRisco !== 'todos') {
      resultado = resultado.filter(r => r.auditoria?.status_risco === filtros.statusRisco)
    }

    if (filtros.statusCobranca && filtros.statusCobranca !== 'todos') {
      resultado = resultado.filter(r => r.auditoria?.status_cobranca === filtros.statusCobranca)
    }

    if (filtros.busca) {
      const b = filtros.busca.toLowerCase()
      resultado = resultado.filter(r => 
        r.paciente_nome.toLowerCase().includes(b) ||
        r.profissional_nome.toLowerCase().includes(b) ||
        (r.terapia_nome && r.terapia_nome.toLowerCase().includes(b)) ||
        (r.texto_original && r.texto_original.toLowerCase().includes(b))
      )
    }

    return { data: resultado, error: null }
  } catch (err: any) {
    return { data: [], error: err.message || 'Erro inesperado ao buscar auditorias' }
  }
}

/**
 * Agrupa as auditorias por profissional para a visão de cobrança / ranking
 */
export function calcularResumoProfissionais(
  evolucoes: EvolucaoPendenteAuditoria[]
): ResumoProfissionalAuditoria[] {
  const mapa = new Map<string, ResumoProfissionalAuditoria>()

  for (const item of evolucoes) {
    const key = item.profissional_id ? String(item.profissional_id) : item.profissional_nome

    if (!mapa.has(key)) {
      mapa.set(key, {
        profissional_id: item.profissional_id,
        profissional_nome: item.profissional_nome,
        terapia_nome: item.terapia_nome,
        unidade_nome: item.unidade_nome,
        total_evolucoes: 0,
        total_auditadas: 0,
        sem_risco: 0,
        risco_especifico: 0,
        risco_relevante: 0,
        pendentes_cobranca: 0,
        taxa_conformidade: 0,
        evolucoes_com_risco: []
      })
    }

    const resumo = mapa.get(key)!
    resumo.total_evolucoes++

    if (item.auditoria) {
      resumo.total_auditadas++
      if (item.auditoria.status_risco === 'sem_risco') {
        resumo.sem_risco++
      } else if (item.auditoria.status_risco === 'risco_especifico') {
        resumo.risco_especifico++
        resumo.evolucoes_com_risco.push(item.auditoria)
      } else if (item.auditoria.status_risco === 'risco_relevante') {
        resumo.risco_relevante++
        resumo.evolucoes_com_risco.push(item.auditoria)
      }

      if (
        item.auditoria.status_risco !== 'sem_risco' &&
        item.auditoria.status_cobranca === 'pendente'
      ) {
        resumo.pendentes_cobranca++
      }
    }
  }

  const lista = Array.from(mapa.values())

  for (const r of lista) {
    r.taxa_conformidade = r.total_auditadas > 0 
      ? Math.round((r.sem_risco / r.total_auditadas) * 100) 
      : 0
  }

  // Ordenar prioritariamente quem tem mais riscos relevantes e pendências de cobrança
  return lista.sort((a, b) => {
    if (b.risco_relevante !== a.risco_relevante) {
      return b.risco_relevante - a.risco_relevante
    }
    if (b.risco_especifico !== a.risco_especifico) {
      return b.risco_especifico - a.risco_especifico
    }
    return a.taxa_conformidade - b.taxa_conformidade
  })
}

/**
 * Atualiza o status de cobrança de uma evolução auditada
 */
export async function atualizarStatusCobranca(params: {
  auditoriaId: string
  novoStatus: StatusCobrancaEvolucao
  usuarioNome: string
  observacao?: string
}): Promise<{ ok: boolean; error: string | null }> {
  const supabase = getSupabaseClient()
  
  try {
    // Buscar histórico atual
    const { data: atual, error: buscaErr } = await supabase
      .from('auditoria_evolucoes')
      .select('historico_cobranca, status_cobranca')
      .eq('id', params.auditoriaId)
      .single()

    if (buscaErr) {
      return { ok: false, error: buscaErr.message }
    }

    const historico = Array.isArray(atual.historico_cobranca) ? [...atual.historico_cobranca] : []
    
    historico.push({
      data: new Date().toISOString(),
      usuario: params.usuarioNome || 'Usuário do sistema',
      acao: `Alterou status para ${params.novoStatus}`,
      observacao: params.observacao || undefined
    })

    const updatePayload: any = {
      status_cobranca: params.novoStatus,
      historico_cobranca: historico,
      updated_at: new Date().toISOString()
    }

    if (params.novoStatus === 'cobrado') {
      updatePayload.cobrado_em = new Date().toISOString()
      updatePayload.cobrado_por_nome = params.usuarioNome
    }

    const { error: updErr } = await supabase
      .from('auditoria_evolucoes')
      .update(updatePayload)
      .eq('id', params.auditoriaId)

    if (updErr) {
      return { ok: false, error: updErr.message }
    }

    return { ok: true, error: null }
  } catch (err: any) {
    return { ok: false, error: err.message || 'Erro ao atualizar cobrança' }
  }
}
