import { getSupabaseClient } from '@/lib/supabase/client'
import type { AtendimentoTerapeutico } from './central-terapeutas.service'

const supabase = getSupabaseClient()

// O PostgREST trunca QUALQUER resposta em max_rows (1000). Um período de
// poucos dias já passa disso, então a leitura é paginada por range() até o
// bloco vir menor que a página.
const PAGINA = 1000

const COLUNAS = `
  tita_agendamento_id,
  data_atendimento,
  paciente_id,
  paciente_nome,
  profissional_id,
  profissional_nome,
  terapia_id,
  terapia_nome,
  hora_inicial,
  hora_final,
  sala_nome,
  sala_operacional,
  unidade,
  convenio_nome,
  status,
  profissional_substituto_id,
  profissional_substituto_nome,
  observacao,
  confirmado_em,
  confirmado_por_nome
`

/**
 * Lê a central terapêutica em um intervalo de datas (inclusivo nas duas pontas),
 * para o relatório. Diferente de listarCentralTerapeutica, que é de um dia só.
 */
export async function listarCentralTerapeuticaPeriodo(
  dataInicio: string,
  dataFim: string,
  onProgresso?: (carregadas: number) => void
): Promise<AtendimentoTerapeutico[]> {
  const todas: AtendimentoTerapeutico[] = []
  let offset = 0

  for (;;) {
    const { data, error } = await supabase
      .from('vw_central_terapeutica')
      .select(COLUNAS)
      .gte('data_atendimento', dataInicio)
      .lte('data_atendimento', dataFim)
      .order('data_atendimento', { ascending: true })
      .order('hora_inicial', { ascending: true })
      .order('tita_agendamento_id', { ascending: true })
      .range(offset, offset + PAGINA - 1)

    if (error) {
      console.error('listarCentralTerapeuticaPeriodo:', error.message, {
        code: error.code,
        details: error.details,
        hint: error.hint,
      })
      throw new Error(error.message || 'Falha ao carregar o período')
    }

    const bloco = (data || []) as AtendimentoTerapeutico[]
    todas.push(...bloco)
    onProgresso?.(todas.length)

    if (bloco.length < PAGINA) break
    offset += PAGINA
  }

  return todas
}
