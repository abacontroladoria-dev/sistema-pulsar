// ─── Tipos — services/tita ──────────────────────────────────────────────────
// Contratos da integração com a API TiTa para implantar, na agenda oficial,
// sessões aceitas no fluxo de Ocupação de Paciente.
// Schema de request e resposta confirmado com chamadas reais à API (Sprint 2.1
// de homologação) — o PDF "Integração - Documentação API TITA.pdf" (seções 10 e
// 11) documenta id_favorecido (singular), mas a API real exige ids_favorecidos
// (array), tanto em get_disponibilidade quanto em agendamento/create.

/** Registro da tabela csv_grades_profissionais (grade sincronizada da API TiTa). */
export interface GradeProfissionalRow {
  id: string
  tita_agendamento_id: number | null
  paciente_id: number | null
  paciente_nome: string | null
  data: string
  dia_semana: string | null
  hora_inicial: string | null
  hora_final: string | null
  profissional_id: number | null
  profissional_nome: string | null
  profissional_cpf: string | null
  terapia_id: number | null
  terapia_nome: string | null
  terapia_exibicao_id: number | null
  terapia_exibicao_nome: string | null
  sala_id: number | null
  sala_nome: string | null
  sala_observacoes: string | null
  unidade_id: number | null
  unidade_nome: string | null
  convenio_nome: string | null
  status_agendamento: string | null
  updated_at: string
}

/** Body de POST /integracao/get_disponibilidade. */
export interface DisponibilidadeRequest {
  data_inicial: string
  data_final: string
  id_grade_terapeuta: number
  ids_favorecidos: number[]
}

/**
 * Corpo de resposta real de POST /integracao/get_disponibilidade — confirmado por
 * chamada real (Sprint 2.1), não documentado no PDF (que só dizia "Resposta: JSON").
 * Reflete a ocupação de TODAS as ocorrências semanais entre data_inicial e
 * data_final para a grade_terapeuta informada, não um booleano simples.
 */
export interface DisponibilidadeResponse {
  total_horarios: number
  horarios_ocupados: number
  horarios_livres: number
  percentual: number
}

/** Body de POST /integracao/agendamento/create. */
export interface AgendamentoTitaPayload {
  data_inicial: string
  data_final: string
  id_grade_terapeuta: number
  ids_favorecidos: number[]
  id_sala: number
  /** 1 = Mensal, 2 = Quinzenal, 4 = Semanal (valor usado por este fluxo). */
  frequencia: number
  id_tipo_agenda: number
  id_terapia_clinica: number
  id_terapia_exibicao: number
}

/**
 * Uma ocorrência individual dentro da série semanal criada por agendamento/create.
 * status_str confirmado por chamada real (Sprint 2.1): "Planejado" (criada sem
 * conflito) ou "Conflito" (horário já ocupado por outro agendamento) — o TiTa cria
 * a série inteira e marca cada ocorrência individualmente, em vez de rejeitar tudo.
 */
export interface ItemAgendamentoTita {
  id: number
  data: string
  status: string
  status_str: string
}

/** Resposta real de POST /integracao/agendamento/create — array com 1 elemento (1 favorecido por chamada). */
export interface AgendaFavorecidoTita {
  id: number
  status: string
  status_str: string
  itens: ItemAgendamentoTita[]
}

/** Resultado de uma chamada HTTP à API TiTa — resposta não tem schema fixo documentado. */
export interface TitaApiResult<T = unknown> {
  ok: boolean
  status: number
  data?: T
  error?: string
}
