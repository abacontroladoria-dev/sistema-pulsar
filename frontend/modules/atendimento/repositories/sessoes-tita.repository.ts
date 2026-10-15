import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================================
// SessoesTitaRepository
//
// As sessões MARCADAS de um paciente na agenda oficial (TiTa), para a Maia
// responder "tem terapia hoje?" a quem já é da clínica (15/10/2026).
//
// Lê `public.vw_grade_atendimentos` — a leitura única da grade (só linha ativa,
// sem profissional de teste, só 'Agendado', só unidade 280). Não confundir com
// `central.appointments`, que são as reservas feitas PELA Maia e nunca contêm a
// agenda de quem já é paciente: foi essa confusão que fez a Maia dizer à mãe
// da Pérola que não havia agendamento, com a sessão marcada para o mesmo dia.
//
// Quem decide QUAIS pacientes é o worker, pelo vínculo do telefone — nunca o
// modelo. Por isso a assinatura recebe ids, e a ferramenta não tem parâmetro
// de paciente.
// ============================================================================

export interface SessaoTita {
  paciente_id:           number
  paciente_nome:         string | null
  data:                  string
  dia_semana:            string | null
  hora_inicial:          string | null
  hora_final:            string | null
  terapia_nome:          string | null
  terapia_exibicao_nome: string | null
  profissional_nome:     string | null
  sala_nome:             string | null
  status_execucao:       string | null
  justificativa:         string | null
}

const COLUNAS = `
  paciente_id,
  paciente_nome,
  data,
  dia_semana,
  hora_inicial,
  hora_final,
  terapia_nome,
  terapia_exibicao_nome,
  profissional_nome,
  sala_nome,
  status_execucao,
  justificativa
`

export class SessoesTitaRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  // Ordenado por data e hora, com `id` de desempate (paginação estável). Quem
  // chama pede uma linha a mais que o que vai mostrar para saber se cortou.
  async listar(pacienteIds: number[], de: string, ate: string, limite: number): Promise<SessaoTita[]> {
    if (pacienteIds.length === 0) return []
    const { data, error } = await (this.supabase as any)
      .from('vw_grade_atendimentos')
      .select(COLUNAS)
      .in('paciente_id', pacienteIds)
      .gte('data', de)
      .lte('data', ate)
      .order('data', { ascending: true })
      .order('hora_inicial', { ascending: true })
      .order('id', { ascending: true })
      .limit(limite)

    if (error) throw error
    return (data ?? []) as SessaoTita[]
  }
}
