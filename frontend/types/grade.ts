// Grade (Cronograma) — agenda própria do Pulsar. Ver docs/PLANO_GRADE_CRONOGRAMA.md
// e supabase/migrations/20261008100000_grade_agenda_tabelas.sql … 100400.
// Nada daqui é escrito no TiTa.

export type SituacaoAgendamento = "agendado" | "excluido"
export type OrigemGrade = "pulsar" | "tita_importacao"
export type EscopoExclusao = "somente_esta" | "desta_em_diante" | "inativacao_profissional" | "importacao_tita"

/** Uma sessão (linha de grade_agendamentos). Datas "AAAA-MM-DD", horas "HH:MM:SS". */
export type AgendamentoGrade = {
  id: string
  serie_id: string | null
  data: string
  dia_semana: number
  hora_inicio: string
  hora_fim: string
  duracao_min: number
  paciente_id: number
  paciente_nome: string
  profissional_id: number
  profissional_nome: string
  terapia_id: number
  terapia_nome: string
  terapia_exibicao_id: number | null
  terapia_exibicao_nome: string | null
  local_id: string | null
  sala_nome: string | null
  unidade_nome: string | null
  situacao: SituacaoAgendamento
  excluido_em: string | null
  excluido_por_nome: string | null
  motivo_exclusao: string | null
  escopo_exclusao: EscopoExclusao | null
  origem: OrigemGrade
  tita_agendamento_id: number | null
  criado_em: string
  criado_por_nome: string | null
}

export type SerieGrade = {
  id: string
  paciente_id: number
  profissional_id: number
  terapia_id: number
  terapia_nome: string
  terapia_exibicao_id: number | null
  terapia_exibicao_nome: string | null
  dia_semana: number
  hora_inicio: string
  hora_fim: string
  sala_nome: string | null
  unidade_nome: string | null
  frequencia: "unica" | "semanal"
  intervalo_semanas: number
  data_inicio: string
  data_fim: string | null
  total_sessoes: number | null
  situacao: "ativa" | "encerrada"
  encerrada_a_partir: string | null
  encerrada_por_nome: string | null
  motivo_encerramento: string | null
  origem: OrigemGrade
  observacao: string | null
  criado_em: string
  criado_por_nome: string | null
}

export type TipoBloqueio = "bloqueio" | "administrativo" | "ferias" | "outro"

export type BloqueioGrade = {
  id: string
  profissional_id: number
  data_inicio: string
  data_fim: string | null
  hora_inicio: string | null
  hora_fim: string | null
  dias_semana: number[] | null
  tipo: TipoBloqueio
  motivo: string
  situacao: "ativo" | "excluido"
  origem: OrigemGrade
  criado_por_nome: string | null
  criado_em: string
}

/** Linha de grade_faixas(): uma faixa de uma versão de disponibilidade. */
export type FaixaGrade = {
  profissional_id: number
  versao_id: string
  versao_numero: number
  vigente_de: string
  vigente_ate: string | null
  dias_ativos: number[]
  faixa_id: string
  /** 1 = segunda … 6 = sábado (isodow). */
  dia_semana: number
  hora_inicio: string
  hora_fim: string
  duracao_min: number
  capacidade: number
  intervalo_ativo: boolean
  intervalo_inicio: string | null
  intervalo_fim: string | null
  local_id: string
  local_nome: string
  unidade_nome: string | null
  terapias: { id: number; nome: string }[]
}

export type FeriadoGrade = {
  data: string
  nome: string
  tipo: "integral" | "parcial"
  horario_inicio: string
  horario_fim: string
}

/** Linha de grade_profissionais(): só o que a agenda precisa. */
export type ProfissionalGrade = {
  id: number
  nome: string
  ativo: boolean
  data_saida: string | null
  terapia_focal_id: number | null
  foto_path: string | null
  tita_profissional_id: number | null
  terapias: number[]
}

/** Janelas declaradas pela família (grade_disponibilidade_paciente). */
export type DisponibilidadePacienteGrade = {
  numero_versao: number
  criado_em: string
  frequenta_escola: boolean | null
  escola_inicio: string | null
  escola_fim: string | null
} & Record<`${"seg" | "ter" | "qua" | "qui" | "sex" | "sab"}_${"inicio" | "fim"}`, string | null>

export type AcaoEventoGrade =
  | "criado" | "excluido" | "serie_encerrada" | "estendido"
  | "importado" | "bloqueio_criado" | "bloqueio_excluido" | "inativacao_profissional"
  | "evoluido" | "evolucao_editada" | "falta_registrada" | "evolucao_removida"

export type EventoGrade = {
  id: number
  acao: AcaoEventoGrade
  agendamento_id: string | null
  serie_id: string | null
  bloqueio_id: string | null
  importacao_id: string | null
  lote_id: string | null
  profissional_id: number | null
  paciente_id: number | null
  quantidade: number
  motivo: string | null
  resumo: string
  feito_por_nome: string | null
  feito_em: string
  feito_em_brasilia: string | null
}

// ── Motor ───────────────────────────────────────────────────────────────────

/**
 * disponivel / parcial / lotado — horário da disponibilidade, pela ocupação;
 * bloqueado — feriado ou bloqueio cobre o horário;
 * fora_da_grade — há sessão sem faixa de disponibilidade correspondente;
 * inativo — depois da saída do profissional (sessões mantidas = reposição).
 */
export type EstadoHorario = "disponivel" | "parcial" | "lotado" | "bloqueado" | "fora_da_grade" | "inativo"

export type HorarioGrade = {
  data: string
  inicio: string // "HH:MM"
  fim: string
  capacidade: number
  ocupados: AgendamentoGrade[]
  estado: EstadoHorario
  terapias: { id: number; nome: string }[]
  local: { id: string; nome: string; unidade: string | null } | null
  /** Por que está fechado (feriado ou bloqueio). */
  fechado: { motivo: string; origem: "feriado" | "bloqueio"; bloqueioId?: string } | null
}

export type DiaGrade = {
  data: string
  feriado: FeriadoGrade | null
  inativo: boolean
  horarios: HorarioGrade[]
}

export type ResumoGrade = {
  /** Vagas livres (capacidade − ocupados) em horários abertos. */
  disponiveis: number
  /** Sessões agendadas no período. */
  agendados: number
  /** Horários fechados por feriado/bloqueio. */
  bloqueados: number
  /** Sessões que precisam de reposição (profissional inativo). */
  reposicao: number
  /** Agendados em horário da grade ÷ vagas da grade (0–1); null sem vagas. */
  ocupacao: number | null
}

export type ConflitoGrade =
  | "passado" | "profissional_inativo" | "paciente_inativo" | "paciente_alta" | "feriado" | "bloqueio"
  | "fora_da_disponibilidade" | "terapia_fora_da_faixa" | "lotado" | "paciente_ocupado"

export type SimulacaoData = { data: string; conflito: ConflitoGrade | null; ok: boolean }

export type PayloadAgendamento = {
  paciente_id: number
  profissional_id: number
  terapia_id: number
  terapia_exibicao_id?: number | null
  local_id?: string | null
  data_inicio: string
  hora_inicio: string
  hora_fim: string
  frequencia: "unica" | "semanal"
  intervalo_semanas: number
  data_fim?: string | null
  total_sessoes?: number | null
  permitir_paciente_simultaneo?: boolean
  observacao?: string | null
}

// ── Evoluções Terapêuticas e Faltas ─────────────────────────────────────────

export type StatusVisualEvolucao =
  | "evoluido"             // verde — possui tratativa (sem falta da recepção)
  | "sem_registro_passado" // amarelo — sem registro e horário já passou (ex.: 10:01 p/ sessão 10:00)
  | "cancelado"            // vermelho — falta do paciente ou falta do profissional
  | "futuro"               // azul — sem registro e horário ainda não passou (ex.: 09:59 p/ sessão 10:00)
  | "inconsistencia"       // roxo/violeta (SOMENTE ADMIN) — recepção marcou falta, mas profissional evoluiu

export type AcessoEvolucaoGrade = {
  eh_admin: boolean
  pode_evoluir: boolean
  usuario_id: string | null
  usuario_nome: string
  profissional_id: number | null
}

export type ResumoEvolucaoGrade = {
  agendamento_id: string
  status_execucao: "Realizado" | "Cancelado" | string | null
  justificativa: string | null
  tipo_falta: "paciente" | "terapeuta" | string | null
  possui_tratativa: boolean
  tratativa_profissional_id: number | null
  tratativa_profissional_nome: string | null
  tratativa_criada_em: string | null
  origem: OrigemGrade | null
  substituicao: boolean
  falta_recepcao: boolean
  tipo_falta_recepcao: string | null
  inconsistencia: boolean
}

export type CarimboProfissionalGrade = {
  profissional_id: number | null
  profissional_nome: string | null
  assinatura_path: string | null
  tipo_registro: string | null
  uf_registro: string | null
  codigo_registro: string | null
}

export type DetalheEvolucaoGrade = {
  agendamento_id: string
  registrado: boolean
  status_execucao: "Realizado" | "Cancelado" | string | null
  justificativa: string | null
  tipo_falta: "paciente" | "terapeuta" | string | null
  possui_tratativa: boolean
  descricao_evolucao: string | null
  tratativa_profissional_id: number | null
  tratativa_profissional_nome: string | null
  tratativa_criada_em: string | null
  tratativa_criada_em_brasilia: string | null
  tratativa_origem: string | null
  evolucao_vinculo: string | null
  origem: OrigemGrade | null
  substituicao: boolean
  registrado_por_nome: string | null
  atualizado_em_brasilia: string | null
  falta_recepcao: boolean
  tipo_falta_recepcao: string | null
  inconsistencia: boolean
  carimbo: CarimboProfissionalGrade
}

