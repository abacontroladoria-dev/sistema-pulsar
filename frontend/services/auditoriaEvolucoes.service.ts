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
 * O PostgREST corta QUALQUER resposta em `max_rows` (1000 nesta base), e sem
 * `Range` ele corta calado — nada no retorno diz que faltou linha. Em 22/09/2026
 * isso deixava a tela cega: as 5.099 sessões do período viravam as 1.000 mais
 * recentes (16/09 a 21/09), e como as 155 auditorias eram todas de sessões
 * anteriores, NENHUMA aparecia. Os filtros de risco/cobrança rodam em memória,
 * então filtravam uma fatia sem auditoria alguma e devolviam sempre vazio.
 */
const TAMANHO_PAGINA = 1000

const COLUNAS_GRADE = `
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
`

/**
 * Busca evoluções de `csv_grades_profissionais` e seus resultados de auditoria em `auditoria_evolucoes`
 * Restrito por padrão a partir de 01/09/2026.
 *
 * Dois caminhos, porque o volume manda:
 * - COM filtro de risco/cobrança: parte de `auditoria_evolucoes` (centenas de
 *   linhas, filtradas no banco) e busca só as sessões correspondentes.
 * - SEM filtro: pagina a grade inteira, para o total e a taxa de conformidade
 *   valerem sobre todo o período, não sobre a primeira página.
 */
export async function buscarEvolucoesComAuditoria(
  filtros: FiltrosAuditoriaEvolucoes = {}
): Promise<{ data: EvolucaoPendenteAuditoria[]; error: string | null }> {
  const supabase = getSupabaseClient()

  const dataInicio = filtros.dataInicio || DATA_CORTE_PADRAO
  const filtraRisco = Boolean(filtros.statusRisco && filtros.statusRisco !== 'todos')
  const filtraCobranca = Boolean(filtros.statusCobranca && filtros.statusCobranca !== 'todos')

  try {
    const gradeRows = filtraRisco || filtraCobranca
      ? await buscarGradePelaAuditoria(supabase, dataInicio, filtros)
      : await buscarGradePaginada(supabase, dataInicio, filtros)

    if ('erro' in gradeRows) {
      return { data: [], error: gradeRows.erro }
    }

    if (gradeRows.linhas.length === 0) {
      return { data: [], error: null }
    }

    // 2. Buscar registros de auditoria correspondentes
    const gradeIds = gradeRows.linhas.map(r => r.id)

    // Chunking to prevent URL length limits if gradeIds is huge
    const chunkSize = 200
    const auditoriaMap = new Map<string, RegistroAuditoriaEvolucao>()

    for (let i = 0; i < gradeIds.length; i += chunkSize) {
      const chunk = gradeIds.slice(i, i + chunkSize)
      const { data: audRows, error: audErr } = await supabase
        .from('auditoria_evolucoes')
        .select('*')
        .in('grade_id', chunk)

      if (audErr) {
        return { data: [], error: `Erro ao buscar auditorias: ${audErr.message}` }
      }
      if (audRows) {
        for (const a of audRows) {
          auditoriaMap.set(a.grade_id, a as unknown as RegistroAuditoriaEvolucao)
        }
      }
    }

    // 3. Mesclar resultados
    let resultado: EvolucaoPendenteAuditoria[] = gradeRows.linhas.map(r => {
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

    // Os filtros de risco/cobrança já foram aplicados NO BANCO quando ativos
    // (ver buscarGradePelaAuditoria). Reaplicar aqui é de graça e protege contra
    // uma sessão que tenha perdido a auditoria entre as duas consultas.
    if (filtraRisco) {
      resultado = resultado.filter(r => r.auditoria?.status_risco === filtros.statusRisco)
    }

    if (filtraCobranca) {
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
  } catch (err: unknown) {
    return {
      data: [],
      error: err instanceof Error ? err.message : 'Erro inesperado ao buscar auditorias'
    }
  }
}

type LinhaGrade = {
  id: string
  tita_agendamento_id: number | null
  data: string
  profissional_id: number | null
  profissional_nome: string | null
  paciente_id: number | null
  paciente_nome: string | null
  terapia_nome: string | null
  unidade_id: number | null
  unidade_nome: string | null
  descricao_evolucao: string | null
  status_execucao: string | null
}

type ResultadoGrade = { linhas: LinhaGrade[] } | { erro: string }

/**
 * Percorre a grade em páginas de 1000 até a última, para o período inteiro
 * caber no resultado. Sem isto o PostgREST devolve só a primeira página e não
 * avisa — ver o comentário de TAMANHO_PAGINA.
 */
async function buscarGradePaginada(
  supabase: ReturnType<typeof getSupabaseClient>,
  dataInicio: string,
  filtros: FiltrosAuditoriaEvolucoes
): Promise<ResultadoGrade> {
  const linhas: LinhaGrade[] = []

  for (let pagina = 0; ; pagina++) {
    let query = supabase
      .from('csv_grades_profissionais')
      .select(COLUNAS_GRADE)
      .gte('data', dataInicio)
      .eq('ativo', true)
      .not('descricao_evolucao', 'is', null)
      .neq('descricao_evolucao', '')
      .order('data', { ascending: false })
      .order('id', { ascending: false }) // desempate estável entre páginas
      .range(pagina * TAMANHO_PAGINA, (pagina + 1) * TAMANHO_PAGINA - 1)

    if (filtros.dataFim) query = query.lte('data', filtros.dataFim)
    if (filtros.profissionalId) query = query.eq('profissional_id', filtros.profissionalId)
    if (filtros.unidadeId) query = query.eq('unidade_id', filtros.unidadeId)

    const { data, error } = await query
    if (error) return { erro: `Erro ao buscar grade: ${error.message}` }
    if (!data || data.length === 0) break

    linhas.push(...(data as unknown as LinhaGrade[]))
    if (data.length < TAMANHO_PAGINA) break
  }

  return { linhas }
}

/**
 * Caminho invertido: com filtro de risco/cobrança ativo, quem manda é a
 * auditoria. Filtrar no banco (centenas de linhas) e só então buscar as sessões
 * correspondentes evita arrastar milhares de linhas para descartar quase todas
 * — e, principalmente, não deixa o corte de 1000 esconder a auditoria que a
 * pessoa está justamente procurando.
 */
async function buscarGradePelaAuditoria(
  supabase: ReturnType<typeof getSupabaseClient>,
  dataInicio: string,
  filtros: FiltrosAuditoriaEvolucoes
): Promise<ResultadoGrade> {
  const idsAlvo: string[] = []

  for (let pagina = 0; ; pagina++) {
    let query = supabase
      .from('auditoria_evolucoes')
      .select('grade_id')
      .gte('data_sessao', dataInicio)
      .order('data_sessao', { ascending: false })
      .order('grade_id', { ascending: false })
      .range(pagina * TAMANHO_PAGINA, (pagina + 1) * TAMANHO_PAGINA - 1)

    if (filtros.dataFim) query = query.lte('data_sessao', filtros.dataFim)
    if (filtros.statusRisco && filtros.statusRisco !== 'todos') {
      query = query.eq('status_risco', filtros.statusRisco)
    }
    if (filtros.statusCobranca && filtros.statusCobranca !== 'todos') {
      query = query.eq('status_cobranca', filtros.statusCobranca)
    }
    if (filtros.profissionalId) query = query.eq('profissional_id', filtros.profissionalId)
    if (filtros.unidadeId) query = query.eq('unidade_id', filtros.unidadeId)

    const { data, error } = await query
    if (error) return { erro: `Erro ao buscar auditorias: ${error.message}` }
    if (!data || data.length === 0) break

    idsAlvo.push(...data.map(a => a.grade_id as string))
    if (data.length < TAMANHO_PAGINA) break
  }

  if (idsAlvo.length === 0) return { linhas: [] }

  // Buscar as sessões dessas auditorias, em blocos para não estourar a URL.
  const linhas: LinhaGrade[] = []
  const blocos = 200

  for (let i = 0; i < idsAlvo.length; i += blocos) {
    const chunk = idsAlvo.slice(i, i + blocos)
    let query = supabase
      .from('csv_grades_profissionais')
      .select(COLUNAS_GRADE)
      .in('id', chunk)
      .eq('ativo', true)

    if (filtros.profissionalId) query = query.eq('profissional_id', filtros.profissionalId)
    if (filtros.unidadeId) query = query.eq('unidade_id', filtros.unidadeId)

    const { data, error } = await query
    if (error) return { erro: `Erro ao buscar grade: ${error.message}` }
    if (data) linhas.push(...(data as unknown as LinhaGrade[]))
  }

  linhas.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0))
  return { linhas }
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
