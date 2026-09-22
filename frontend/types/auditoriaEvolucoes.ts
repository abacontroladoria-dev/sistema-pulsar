export type StatusRiscoEvolucao = 'sem_risco' | 'risco_especifico' | 'risco_relevante'

export type StatusCobrancaEvolucao = 
  | 'pendente'
  | 'cobrado'
  | 'aguardando_correcao'
  | 'corrigido_tita'
  | 'ignorado'

export interface ChecklistPerguntas {
  chegou: boolean
  objetivo: boolean
  recursos: boolean
  reacao_saida: boolean
}

export interface ApontamentoAuditoria {
  tipo: 
    | 'estrutura_incompleta'
    | 'termo_vago'
    | 'negacao_sem_contexto'
    | 'termo_absoluto'
    | 'julgamento_subjetivo'
    | 'procedimento_aversivo'
    | 'foco_tempo'
    | 'sigla_sem_contexto'
    | 'sigilo_cfp'
    | 'inconsistencia_estrutural'
    | 'outro'
  titulo: string
  descricao: string
  trecho?: string
  gravidade: 'alta' | 'media' | 'baixa'
}

export interface EventoHistoricoCobranca {
  data: string
  usuario: string
  acao: string
  observacao?: string
}

export interface RegistroAuditoriaEvolucao {
  id: string
  grade_id: string
  tita_agendamento_id: number | null
  data_sessao: string
  profissional_id: number | null
  profissional_nome: string
  paciente_id: number | null
  paciente_nome: string
  terapia_nome: string | null
  unidade_id: number | null
  unidade_nome: string | null
  
  texto_original: string | null
  
  status_risco: StatusRiscoEvolucao
  resumo_justificativa: string | null
  apontamentos: ApontamentoAuditoria[]
  checklist_perguntas: ChecklistPerguntas
  inconsistencias_estruturais: string[]
  texto_revisado: string | null
  
  status_cobranca: StatusCobrancaEvolucao
  historico_cobranca: EventoHistoricoCobranca[]
  cobrado_em: string | null
  cobrado_por_nome: string | null
  
  modelo_ia: string | null
  /** Versão dos critérios que julgou esta evolução. Null = auditada antes do versionamento. */
  criterios_versao_id?: string | null
  criterios_versao_numero?: number | null
  /**
   * Motivo da última falha de auditoria. Quando preenchido, os campos de
   * veredito acima são da tentativa ANTERIOR, bem-sucedida.
   */
  erro_auditoria?: string | null
  auditado_em: string
  created_at: string
  updated_at: string
}

export interface EvolucaoPendenteAuditoria {
  grade_id: string
  tita_agendamento_id: number | null
  data_sessao: string
  profissional_id: number | null
  profissional_nome: string
  paciente_id: number | null
  paciente_nome: string
  terapia_nome: string | null
  unidade_id: number | null
  unidade_nome: string | null
  texto_original: string
  status_execucao?: string | null
  auditoria?: RegistroAuditoriaEvolucao | null
}

export interface ResumoProfissionalAuditoria {
  profissional_id: number | null
  profissional_nome: string
  terapia_nome: string | null
  unidade_nome: string | null
  total_evolucoes: number
  total_auditadas: number
  sem_risco: number
  risco_especifico: number
  risco_relevante: number
  pendentes_cobranca: number
  taxa_conformidade: number // % sem risco
  evolucoes_com_risco: RegistroAuditoriaEvolucao[]
}
