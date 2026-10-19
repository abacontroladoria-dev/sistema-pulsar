import { getSupabaseClient } from '@/lib/supabase/client'
import { getFunctionUrl, getFunctionHeaders } from '@/lib/supabase/functions'
import type { ControleTerapeuticoStatus } from './central-terapeutas.service'

const supabase = getSupabaseClient()

export type AtualizarStatusPayload = {
  tita_agendamento_id: string | number
  status: ControleTerapeuticoStatus
  profissional_substituto_id?: string | number | null
  profissional_substituto_nome?: string | null
  observacao?: string | null
}

export type AtualizarStatusEmLotePayload = Omit<
  AtualizarStatusPayload,
  'tita_agendamento_id'
> & {
  tita_agendamento_ids: Array<string | number>
}

async function chamarUpsertControleTerapeutico(items: AtualizarStatusPayload[]) {
  const response = await fetch(getFunctionUrl('controle-terapeutico-upsert'), {
    method: 'POST',
    headers: await getFunctionHeaders(),
    body: JSON.stringify({ items }),
  })

  const result = await response.json().catch(() => null)

if (!response.ok) {

  console.error(
    'Erro no upsert:',
    JSON.stringify(
      {
        status: response.status,
        result,
        items,
      },
      null,
      2
    )
  )

  return null
}

  return result?.data || []
}

/**
 * Atualiza o status de um atendimento terapêutico
 * Status: presente, faltou, disponivel, indisponivel,
 * cobertura_planejada, cobertura_confirmada, pendente
 */
export async function atualizarStatusAtendimento(payload: AtualizarStatusPayload) {
  try {
    const data = await chamarUpsertControleTerapeutico([payload])

    return data?.[0] || null
  } catch (err) {
    console.error('Erro ao atualizar status:', err)
    return null
  }
}

/**
 * Atualiza o status de vários atendimentos do mesmo profissional/dia.
 * Usado para disponibilidade/indisponibilidade por terapeuta.
 */
export async function atualizarStatusAtendimentosEmLote(
  payload: AtualizarStatusEmLotePayload
) {
  try {
    const ids = payload.tita_agendamento_ids.filter(Boolean)

    if (ids.length === 0) {
      return []
    }

    return await chamarUpsertControleTerapeutico(
      ids.map((tita_agendamento_id) => ({
        tita_agendamento_id,
        status: payload.status,
        profissional_substituto_id: payload.profissional_substituto_id,
        profissional_substituto_nome: payload.profissional_substituto_nome,
        observacao: payload.observacao,
      }))
    )
  } catch (err) {
    console.error('Erro ao atualizar status em lote:', err)
    return null
  }
}

// Listas explícitas (nunca `*`): nas cópias do TiTa o login não lê CPF, telefone,
// registro do profissional, raw_json nem observação da sala (migration
// 20261019140000), e `*` daria "permission denied". Telefone do profissional,
// quando a cobertura precisar, vem do cadastro `profissionais`.
const COLUNAS_PROFISSIONAIS_DISPONIVEIS =
  'id, grade_terapeuta_id, grade_clinica_id, profissional_id, nome_profissional, id_unidade, nome_unidade, ' +
  'dia_semana, data, hora_inicial, hora_final, status_agendamento, terapia_id, nome_terapia, ' +
  'terapia_exibicao_id, terapia_exibicao, id_sala, sala, created_at, updated_at'

const COLUNAS_GRADE_COBERTURA = `${COLUNAS_PROFISSIONAIS_DISPONIVEIS}, paciente_nome, convenio_nome`

const COLUNAS_AGENDA_COBERTURA =
  'id, tita_agendamento_id, data_atendimento, hora_inicial, hora_final, atividade, ativo, origem, ' +
  'motivo_inativacao, clinica_id, clinica_nome, convenio_id, convenio_nome, paciente_id, paciente_nome, ' +
  'profissional_id, profissional_nome, terapia_id, terapia_nome, terapia_exibicao_id, terapia_exibicao_nome, ' +
  'sala_id, sala_nome, created_at, updated_at'

/**
 * Busca profissionais disponíveis para cobertura
 */
export async function listarProfissionaisDisponiveis(
  dataAtendimento: string,

  terapiaNome: string,

  horaInicial?: string,

  horaFinal?: string,

  unidadeId?: number
): Promise<Record<string, any>[]> {
  try {
    let query = supabase
	  .from('vw_profissionais_disponiveis')
	  .select(COLUNAS_PROFISSIONAIS_DISPONIVEIS)

	  .eq('data', dataAtendimento)

		.or(
		  `terapia_exibicao.eq.${terapiaNome.replace(/[",]/g, '').trim()},nome_terapia.eq.${terapiaNome.replace(/[",]/g, '').trim()}`
		)

	if (
	  horaInicial &&
	  horaFinal
	) {

	  query = query
		.lte(
		  'hora_inicial',
		  horaInicial
		)

		.gte(
		  'hora_final',
		  horaFinal
		)
	}

    if (unidadeId) {
	  query = query.eq(
		'id_unidade',
		unidadeId
	  )
	}

	query = query.order(
	  'hora_inicial',
	  { ascending: true }
	)

	const { data, error } = await query

    if (error) {
      console.error(
		  'Erro ao listar profissionais:',
		  JSON.stringify(error, null, 2)
		)
      return []
    }

    return data || []
  } catch (err) {
    console.error('Erro ao listar profissionais:', err)
    return []
  }
}

/**
 * Sincroniza dados operacionais com o servidor
 * Atualiza controle_terapeutico, grade_profissionais_tita, etc
 */
export async function sincronizarDados() {
  try {
	  
    const response = await fetch(getFunctionUrl('sync'), {
      method: 'POST',
      headers: await getFunctionHeaders(),
      body: JSON.stringify({
        operacao: 'sincronizar_controle',
        timestamp: new Date().toISOString(),
      }),
    })

    if (!response.ok) {
      throw new Error(`Sync failed: ${response.statusText}`)
    }

    const resultado = await response.json()
    return resultado
  } catch (err) {
    console.error('Erro ao sincronizar:', err)
    throw err
  }
}

/**
 * Busca dados de cobertura (grade de profissionais)
 */
export async function buscarGradeCobertura(
  dataAtendimento: string,
  idUnidade: number = 280
): Promise<Record<string, any>[]> {
  try {
    const { data, error } = await supabase
      .from('grade_profissionais_tita')
      .select(COLUNAS_GRADE_COBERTURA)
      .eq('data', dataAtendimento)
      .eq('id_unidade', idUnidade)
      .order('nome_profissional', { ascending: true })

    if (error) {
      console.error('Erro ao buscar grade:', error)
      return []
    }

    return data || []
  } catch (err) {
    console.error('Erro ao buscar grade:', err)
    return []
  }
}

/**
 * Busca itens da agenda para cobertura.
 * agenda_tita não tem id_unidade: o sync (sync_tita_agenda) só traz a unidade 280.
 */
export async function buscarItensAgenda(
  dataAtendimento: string
): Promise<Record<string, any>[]> {
  try {
    const { data, error } = await supabase
      .from('agenda_tita')
      .select(COLUNAS_AGENDA_COBERTURA)
      .eq('data_atendimento', dataAtendimento)
      .order('hora_inicial', { ascending: true })

    if (error) {
      console.error('Erro ao buscar agenda:', error)
      return []
    }

    return data || []
  } catch (err) {
    console.error('Erro ao buscar agenda:', err)
    return []
  }
}

// Terapias do Grupo ABA — equivalentes para substituição (spec: central-terapeutas-substituicao.md)
export const ABA_GROUP = [
  'Aplicador ABA (AE)',
  'Aplicador ABA (EF)',
  'Aplicador ABA (HS)',
  'Aplicador ABA (PS)',
  'Aplicador ABA (SF)',
] as const

export const COORD_CASO = 'Coordenador de Caso'

export const SUPERVISAO_ABA = 'Supervisão ABA'

/**
 * Terapias Reais compatíveis para cobrir uma sessão da terapia informada.
 *
 * Matriz:
 * - Sessão ABA: coberta por qualquer ABA + CC + Supervisão ABA
 * - Sessão CC: coberta por CC + ABA(EF) + ABA(PS) + Supervisão ABA
 * - Sessão Supervisão ABA: coberta apenas por Supervisão ABA
 * - Demais terapias: exact-match apenas
 */
export function terapiasCompativeis(terapiaNome: string): string[] {
  if ((ABA_GROUP as readonly string[]).includes(terapiaNome)) {
    return [...ABA_GROUP, COORD_CASO, SUPERVISAO_ABA]
  }
  if (terapiaNome === COORD_CASO) {
    return [COORD_CASO, 'Aplicador ABA (EF)', 'Aplicador ABA (PS)', SUPERVISAO_ABA]
  }
  if (terapiaNome === SUPERVISAO_ABA) {
    return [SUPERVISAO_ABA]
  }
  return [terapiaNome]
}

export type SlotModalSubstituicao = {
  profissional_id: number
  profissional_nome: string
  terapia_nome: string           // Terapia Real — usado para compatibilidade
  terapia_exibicao_nome: string  // Terapia de Exibição — somente para display
  unidade: string
  hora: string
  status_slot: string
  paciente_nome: string | null
  sala_nome: string | null
  turno_semana?: string // 'manha' | 'tarde' | 'ambos' — presente apenas em sem_agenda_hoje
}

/**
 * Merge de slots do dia (vw_modal_substituicao_terapeutas) com a escala da semana
 * (vw_terapeutas_semana) para uma unidade/dia. Quando `terapiasFiltro` é informado,
 * restringe as duas queries a essas Terapias Reais; quando omitido, busca TODOS os
 * profissionais da unidade/dia, sem filtro de especialidade.
 */
async function buscarSlotsUnidadeDia(params: {
  unidade: string
  dataAtendimento: string
  terapiasFiltro?: string[]
}): Promise<SlotModalSubstituicao[]> {
  try {
    let queryHoje = supabase
      .from('vw_modal_substituicao_terapeutas')
      .select('profissional_id, profissional_nome, terapia_nome, terapia_exibicao_nome, unidade, hora, status_slot, paciente_nome, sala_nome')
      .eq('unidade', params.unidade)
      .eq('data_grade', params.dataAtendimento)

    let querySemana = supabase
      .from('vw_terapeutas_semana')
      .select('profissional_id, profissional_nome, terapia_nome, terapia_exibicao_nome, unidade, turno_semana')
      .eq('unidade', params.unidade)

    if (params.terapiasFiltro) {
      queryHoje = queryHoje.in('terapia_nome', params.terapiasFiltro)
      querySemana = querySemana.in('terapia_nome', params.terapiasFiltro)
    }

    const [{ data: slotsHoje, error: erroHoje }, { data: semana, error: erroSemana }] =
      await Promise.all([
        queryHoje.order('profissional_nome', { ascending: true }).order('hora', { ascending: true }),
        querySemana,
      ])

    if (erroHoje) console.error('Erro ao listar slots do dia:', erroHoje)
    if (erroSemana) console.error('Erro ao listar terapeutas da semana:', erroSemana)

    const slots = (slotsHoje as SlotModalSubstituicao[]) || []

    const idsHoje = new Set(slots.map((s) => s.profissional_id))

    const slotsAdicionais: SlotModalSubstituicao[] = []
    const idsAdicionados = new Set<number>()

    for (const t of semana ?? []) {
      if (idsHoje.has(t.profissional_id) || idsAdicionados.has(t.profissional_id)) continue
      idsAdicionados.add(t.profissional_id)
      slotsAdicionais.push({
        profissional_id: t.profissional_id,
        profissional_nome: t.profissional_nome,
        terapia_nome: (t as any).terapia_nome ?? '',
        terapia_exibicao_nome: (t as any).terapia_exibicao_nome ?? '',
        unidade: t.unidade,
        hora: '',
        status_slot: 'sem_agenda_hoje',
        paciente_nome: null,
        sala_nome: null,
        turno_semana: (t as any).turno_semana ?? undefined,
      })
    }

    return [...slots, ...slotsAdicionais].sort((a, b) =>
      a.profissional_nome.localeCompare(b.profissional_nome, 'pt-BR')
    )
  } catch (err) {
    console.error('Erro ao listar modal substituição:', err)
    return []
  }
}

/**
 * Busca profissionais para o modal de substituição usando Terapia Real (terapia_nome).
 * Compatibilidade por terapia_exibicao_nome é incorreta — este serviço usa terapia_nome.
 * Para o Grupo ABA, busca os três subtipos + Coordenador de Caso em uma única query.
 */
export async function listarModalSubstituicao(params: {
  terapiaNome: string   // Terapia Real
  unidade: string
  dataAtendimento: string
}): Promise<SlotModalSubstituicao[]> {
  const terapiasQuery = terapiasCompativeis(params.terapiaNome)
  const result = await buscarSlotsUnidadeDia({ ...params, terapiasFiltro: terapiasQuery })

  console.log(
    '[Cobertura] carregados →',
    'total:', result.length,
    '| terapias:', terapiasQuery,
  )

  return result
}

/**
 * Todos os profissionais ativos da unidade/dia, SEM filtro de especialidade.
 * Usado exclusivamente pelo seletor "Buscar em outra especialidade" — substituição
 * fora da matriz terapiasCompativeis, para casos de exceção sem padrão fixo.
 */
export async function listarTodosProfissionaisModal(params: {
  unidade: string
  dataAtendimento: string
}): Promise<SlotModalSubstituicao[]> {
  return buscarSlotsUnidadeDia({ ...params, terapiasFiltro: undefined })
}
