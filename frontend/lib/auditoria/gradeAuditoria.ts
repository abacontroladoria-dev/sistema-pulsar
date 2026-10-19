import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { filtroExecutadoPor } from './executor'

// Leitura da grade com o TEXTO DA EVOLUÇÃO para a tela de Auditoria de
// Evoluções. Roda só no servidor, com o cliente de serviço, depois de
// exigirPermissaoAuditoria(): desde a migration 20261019150000 o login comum
// não lê `csv_grades_profissionais.descricao_evolucao` (era dado clínico
// legível por qualquer login). A tela não muda: mesmos filtros, mesma ordem,
// mesma paginação de antes — só saiu do navegador.

/**
 * O PostgREST corta QUALQUER resposta em `max_rows` (1000 nesta base), e sem
 * `Range` ele corta calado — ver services/auditoriaEvolucoes.service.ts.
 */
const TAMANHO_PAGINA = 1000

/** Consultas em voo ao mesmo tempo (pool de 10 do PostgREST — incidente de 24/08). */
const CONSULTAS_SIMULTANEAS = 4

export const COLUNAS_GRADE_TELA = `
  id,
  tita_agendamento_id,
  data,
  profissional_id,
  profissional_nome,
  tratativa_profissional_id,
  tratativa_profissional_nome,
  paciente_id,
  paciente_nome,
  terapia_nome,
  unidade_id,
  unidade_nome,
  descricao_evolucao,
  status_execucao
`

export type LinhaGradeAuditoria = {
  id: string
  tita_agendamento_id: number | null
  data: string
  profissional_id: number | null
  profissional_nome: string | null
  tratativa_profissional_id: number | null
  tratativa_profissional_nome: string | null
  paciente_id: number | null
  paciente_nome: string | null
  terapia_nome: string | null
  unidade_id: number | null
  unidade_nome: string | null
  descricao_evolucao: string | null
  status_execucao: string | null
}

export interface FiltrosGradeAuditoria {
  dataInicio: string
  dataFim?: string | null
  profissionalId?: number | null
  unidadeId?: number | null
}

type Resultado = { linhas: LinhaGradeAuditoria[] } | { erro: string }
type Pagina = { data: LinhaGradeAuditoria[] | null; error: { message: string } | null }

/** Roda as tarefas com no máximo `limite` em voo; devolve na ordem de entrada. */
async function emParalelo<T>(tarefas: (() => PromiseLike<T>)[], limite = CONSULTAS_SIMULTANEAS): Promise<T[]> {
  const resultados = new Array<T>(tarefas.length)
  let proxima = 0
  await Promise.all(
    Array.from({ length: Math.min(limite, tarefas.length) }, async () => {
      while (proxima < tarefas.length) {
        const i = proxima++
        resultados[i] = await tarefas[i]()
      }
    })
  )
  return resultados
}

/**
 * Período inteiro, em páginas de 1000 até a primeira incompleta (rodadas de
 * CONSULTAS_SIMULTANEAS páginas).
 */
export async function buscarGradeAuditoriaPaginada(
  supabase: SupabaseClient,
  filtros: FiltrosGradeAuditoria
): Promise<Resultado> {
  const buscarPagina = (pagina: number) => {
    let query = supabase
      .from('csv_grades_profissionais')
      .select(COLUNAS_GRADE_TELA)
      .gte('data', filtros.dataInicio)
      .eq('ativo', true)
      .not('descricao_evolucao', 'is', null)
      .neq('descricao_evolucao', '')
      .order('data', { ascending: false })
      .order('id', { ascending: false }) // desempate estável entre páginas
      .range(pagina * TAMANHO_PAGINA, (pagina + 1) * TAMANHO_PAGINA - 1)

    if (filtros.dataFim) query = query.lte('data', filtros.dataFim)
    if (filtros.profissionalId) query = query.or(filtroExecutadoPor(filtros.profissionalId))
    if (filtros.unidadeId) query = query.eq('unidade_id', filtros.unidadeId)
    return query as unknown as PromiseLike<Pagina>
  }

  const linhas: LinhaGradeAuditoria[] = []
  for (let inicio = 0; ; inicio += CONSULTAS_SIMULTANEAS) {
    const paginas = await Promise.all(
      Array.from({ length: CONSULTAS_SIMULTANEAS }, (_, k) => buscarPagina(inicio + k))
    )
    for (const { data, error } of paginas) {
      if (error) return { erro: `Erro ao buscar grade: ${error.message}` }
      const lote = data ?? []
      linhas.push(...lote)
      if (lote.length < TAMANHO_PAGINA) return { linhas }
    }
  }
}

/** As sessões de uma lista de ids (caminho com filtro de risco/cobrança), em blocos de 200. */
export async function buscarGradeAuditoriaPorIds(
  supabase: SupabaseClient,
  ids: string[],
  filtros: Pick<FiltrosGradeAuditoria, 'profissionalId' | 'unidadeId'>
): Promise<Resultado> {
  if (ids.length === 0) return { linhas: [] }

  const blocos: string[][] = []
  for (let i = 0; i < ids.length; i += 200) blocos.push(ids.slice(i, i + 200))

  const respostas = await emParalelo(
    blocos.map(chunk => () => {
      let query = supabase
        .from('csv_grades_profissionais')
        .select(COLUNAS_GRADE_TELA)
        .in('id', chunk)
        .eq('ativo', true)
      if (filtros.profissionalId) query = query.or(filtroExecutadoPor(filtros.profissionalId))
      if (filtros.unidadeId) query = query.eq('unidade_id', filtros.unidadeId)
      return query as unknown as PromiseLike<Pagina>
    })
  )

  const linhas: LinhaGradeAuditoria[] = []
  for (const { data, error } of respostas) {
    if (error) return { erro: `Erro ao buscar grade: ${error.message}` }
    if (data) linhas.push(...data)
  }

  linhas.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0))
  return { linhas }
}
