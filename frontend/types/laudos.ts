// Tipos para laudos de pacientes e altas/individualidades/suspensões.
//
// Tabelas: cadastros_pacientes_laudos, cadastros_pacientes_laudo_especialidades,
// cadastros_pacientes_altas, cadastros_pacientes_altas_individualidades,
// cadastros_pacientes_suspensoes_temporarias.
// Ver supabase/migrations/20260826140000, 140100, 140200, o rename em 140400
// e a suspensão temporária em 20260902100000.
//
// Os nomes de coluna acompanham o banco de propósito: `id_laudo` em vez de
// `id`, `id_paciente_pulsar` em vez de `paciente_id`. `paciente_id` era ambíguo
// — public.pacientes tem id_paciente (PK do Pulsar) E tita_paciente_id (id do
// TiTa), as duas numéricas, e trocar uma pela outra não dá erro: aponta para
// outro paciente em silêncio.

export type NivelSuporte = "1" | "2" | "3" | "NA"
export type SituacaoLaudo = "Vigente" | "Vencido"

/**
 * Como o atendimento chegou por via judicial.
 *
 * Espelha `individualidades_origem_judicial_check` (20260831120000) — mudar um
 * lado sem o outro faz o salvamento morrer no banco com erro de CHECK, que a
 * tela mostra como "não foi possível salvar".
 *
 * "Não informado" NÃO é um valor da lista: é a ausência dela (NULL). Ter os dois
 * criaria dois jeitos de dizer a mesma coisa.
 */
export const ORIGENS_JUDICIAIS = ["Liminar", "Penhora", "Acordo"] as const
export type OrigemJudicial = (typeof ORIGENS_JUDICIAIS)[number]

// ─── LAUDO ────────────────────────────────────────────────────────────────────

export type LaudoEspecialidade = {
  id_laudo_especialidade: number
  id_laudo: number
  especialidade: string
  qt_laudo: number | null
  qt_autorizacao: number | null
  criado_em: string
}

/** Linha do banco — `situacao` é calculada no service, não é coluna. */
export type PacienteLaudo = {
  id_laudo: number
  id_paciente_pulsar: number
  data_laudo: string        // ISO date "YYYY-MM-DD"
  validade: string | null   // se null → data_laudo + 6 meses
  situacao: SituacaoLaudo
  autorizado_em: string | null
  comp_agressivo: boolean | null
  paciente_verbal: boolean | null
  ambiente_natural: boolean | null
  nivel_suporte: NivelSuporte | null
  alta: boolean
  data_alta: string | null
  especialidade_alta: string | null
  arquivo_path: string | null
  observacoes: string | null
  em_uso?: boolean
  // Sem `ativo`: laudo não tem mais estado "excluído" (20260831130000). A coluna
  // segue no banco, sempre true, porque a view a projeta e as ALTAS ainda usam a
  // mesma coluna com o significado antigo — mas a tela de laudo não a lê.
  criado_em: string
  atualizado_em: string
  /** Populado pelo service, vazio se não selecionado. */
  especialidades: LaudoEspecialidade[]
}

/** Formulário de criação/edição — sem campos gerados pelo banco. */
export type LaudoForm = {
  data_laudo: string
  validade: string          // string vazia = calcular automaticamente
  autorizado_em: string
  arquivo_path: string | null
  observacoes: string
  em_uso: boolean
  especialidades: LaudoEspecialidadeForm[]
}

export type LaudoEspecialidadeForm = {
  /** Presente apenas em edição. */
  id_laudo_especialidade?: number
  especialidade: string
  qt_laudo: string   // string para o input controlado
  qt_autorizacao: string
}

// ─── ALTAS E INDIVIDUALIDADES ──────────────────────────────────────────────────

/** 0 ou 1 por paciente: descreve o paciente, não um evento. */
export type AltaIndividualidade = {
  id_individualidade: number
  id_paciente_pulsar: number
  comp_agressivo: boolean | null
  paciente_verbal: boolean | null
  ambiente_natural: boolean | null
  nivel_suporte: NivelSuporte | null
  /** NULL = não informado. Ver ORIGENS_JUDICIAIS. */
  origem_judicial: OrigemJudicial | null
}

export type AltaIndividualidadeForm = Omit<
  AltaIndividualidade,
  "id_individualidade" | "id_paciente_pulsar"
>

/** 1:N — uma alta por especialidade. */
export type PacienteAlta = {
  id_alta: number
  id_paciente_pulsar: number
  data_alta: string
  especialidade_alta: string
  arquivo_alta_path: string | null
  /**
   * false = "excluída" pela tela. Alta nunca sai do banco — o DELETE é
   * revogado na RLS (20260827100000). A aba lista apenas as ativas.
   */
  ativo: boolean
}

export type PacienteAltaForm = Omit<PacienteAlta, "id_alta" | "id_paciente_pulsar" | "ativo">

// ─── SUSPENSÃO TEMPORÁRIA ───────────────────────────────────────────────────

/** 1:N — uma suspensão por especialidade. Reversível, ao contrário da alta. */
export type PacienteSuspensaoTemporaria = {
  id_suspensao: number
  id_paciente_pulsar: number
  data_suspensao: string
  especialidade_suspensao: string
  /** true = sem data de retorno prevista. Nesse caso `prazo_fim` é null. */
  prazo_indefinido: boolean
  prazo_fim: string | null
  arquivo_suspensao_path: string | null
  observacoes: string | null
  /**
   * false = "excluída" pela tela. Suspensão nunca sai do banco — o DELETE é
   * revogado na RLS (20260902100100). A aba lista apenas as ativas.
   */
  ativo: boolean
  /**
   * Quem criou, gravado na própria linha (20260902110000) — não depende da
   * trilha de auditoria, que é best-effort (fire-and-forget).
   */
  criado_por_usuario_id: string | null
  criado_por_usuario_nome: string | null
  criado_em: string
}

export type PacienteSuspensaoTemporariaForm = Omit<
  PacienteSuspensaoTemporaria,
  | "id_suspensao"
  | "id_paciente_pulsar"
  | "ativo"
  | "criado_por_usuario_id"
  | "criado_por_usuario_nome"
  | "criado_em"
>

// ─── ALTA CLÍNICA ────────────────────────────────────────────────────────────

/**
 * 1:N (histórico), mas representa um ESTADO geral do paciente — encerramento
 * de todas as terapias —, não um evento por especialidade como PacienteAlta.
 * "Vigente" = linha mais recente com ativo=true.
 */
export type PacienteAltaClinica = {
  id_alta_clinica: number
  id_paciente_pulsar: number
  data_alta_clinica: string
  /** Opcional. Mesmo bucket privado de alta/suspensão, prefixo altas-clinicas/. */
  arquivo_alta_clinica_path: string | null
  /**
   * false = "excluída" (revertida) pela tela. Nunca sai do banco — o DELETE
   * é revogado na RLS (20260921200100).
   */
  ativo: boolean
  criado_por_usuario_id: string | null
  criado_por_usuario_nome: string | null
  criado_em: string
}

export type PacienteAltaClinicaForm = Pick<
  PacienteAltaClinica,
  "data_alta_clinica" | "arquivo_alta_clinica_path"
>
