import { getSupabaseClient } from '@/lib/supabase/client'
import type { FeriadoRow } from '@/types/feriados'

export async function getFeriados(): Promise<{ data: FeriadoRow[]; error: string | null }> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.from('feriados').select('*').order('data')

  if (error) {
    console.error('Erro ao buscar feriados:', error)
    return { data: [], error: error.message }
  }

  return { data: data ?? [], error: null }
}

/**
 * Feriados de um período curto (até 31 dias) para a Ocupação Clínica, via
 * RPC ocupacao_clinica_feriados — devolve o mesmo resultado a todo mundo que
 * tem a aba, mesmo quem não lê a tabela pela RLS. Enquanto a migration
 * 20261015170000 não estiver aplicada (ou se a RPC falhar), cai na leitura
 * direta da tabela: quem tem papel com leitura continua vendo igual.
 */
export async function listarFeriadosDoPeriodo(de: string, ate: string): Promise<Pick<FeriadoRow, 'data' | 'nome' | 'tipo' | 'horario_inicio' | 'horario_fim'>[]> {
  const supabase = getSupabaseClient()
  const rpc = await supabase.rpc('ocupacao_clinica_feriados', { p_de: de, p_ate: ate })
  if (!rpc.error) return rpc.data ?? []

  const { data, error } = await supabase
    .from('feriados')
    .select('data, nome, tipo, horario_inicio, horario_fim')
    .gte('data', de)
    .lte('data', ate)
    .order('data')
  if (error) {
    console.error('Erro ao buscar feriados do período:', error)
    return []
  }
  return data ?? []
}

export async function upsertFeriado(
  row: { data: string; nome: string; tipo: 'integral' | 'parcial'; horario_inicio: string; horario_fim: string },
  updatedBy?: string
): Promise<boolean> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('feriados')
    .upsert({ ...row, updated_at: new Date().toISOString(), updated_by: updatedBy ?? null }, { onConflict: 'data' })

  if (error) {
    console.error('Erro ao salvar feriado:', error)
    return false
  }

  return true
}

export async function deleteFeriadoPorData(data: string): Promise<boolean> {
  const supabase = getSupabaseClient()
  const { error } = await supabase.from('feriados').delete().eq('data', data)

  if (error) {
    console.error('Erro ao remover feriado:', error)
    return false
  }

  return true
}
