// Disponibilidade do profissional — versões imutáveis com vigência. Ver
// supabase/migrations/20261006140000_profissionais_disponibilidade.sql e
// 20261006170000_disponibilidade_substituir_e_valer_hoje.sql.

/** "substituida" = trocada por outra antes de valer (ou no dia em que começou). */
export type SituacaoVersao = "vigente" | "agendada" | "encerrada" | "substituida"
export type SituacaoGrade = "vigente" | "agendada" | "inativa" | "sem_grade"
export type OrigemVersao = "manual" | "preenchido_tita" | "restaurada"

export type FaixaGravada = {
  id: string
  dia_semana: number
  hora_inicio: string // "HH:MM:SS"
  hora_fim: string
  duracao_min: number
  /** Pacientes por horário (20261008100100). Ausente enquanto a migration não sai = 1. */
  capacidade?: number
  intervalo_ativo: boolean
  intervalo_inicio: string | null
  intervalo_fim: string | null
  local_id: string
  local_nome: string
  unidade_nome: string | null
  ordem: number
  terapias: { terapia_id: number; terapia_nome: string }[]
}

export type VersaoDisponibilidade = {
  id: string
  profissional_id: number
  numero: number
  vigente_de: string // "AAAA-MM-DD"
  vigente_ate: string | null
  dias_ativos: number[]
  origem: OrigemVersao
  restaurada_de: string | null
  motivo: string | null
  criado_por_nome: string | null
  criado_em: string
  /** Quando e por qual versão foi substituída (null = não foi). */
  substituida_em: string | null
  substituida_por: string | null
  situacao: SituacaoVersao
  faixas: FaixaGravada[]
}

export type EventoDisponibilidade = {
  id: number
  versao_id: string | null
  tipo: "criar" | "encerrar" | "alterar_vigencia" | "restaurar" | "substituir" | "antecipar" | "carga_capacidade"
  antes: { vigente_de?: string; vigente_ate?: string | null } | null
  depois: {
    vigente_de?: string; vigente_ate?: string | null; faixas?: number | { dia_semana: number; capacidade: number }[]
    substituida_por?: string
  } | null
  motivo: string | null
  usuario_nome: string | null
  criado_em: string
  criado_em_brasilia: string | null
}

export type SituacaoGradeProfissional = {
  profissional_id: number
  situacao: Exclude<SituacaoGrade, "sem_grade">
  versao_vigente_id: string | null
  vigente_desde: string | null
  vigente_ate: string | null
  proxima_de: string | null
  encerrada_em: string | null
  total_versoes: number
}

export type LocalDisponivel = {
  id: string
  nome_exibicao: string
  unidade_nome: string
  numero_sala: string
  capacidade: "unico" | "duplo" | "multiplo" | string
  status: string | null
  sala_nome_referencia: string | null
  exclusividades: { terapia_id: number; terapia_nome: string; modo: "obrigatoria" | "preferencial" | string }[]
}

/** Faixa de outro profissional, para avisar conflito de local. */
export type OcupacaoLocal = {
  local_id: string
  dia_semana: number
  hora_inicio: string
  hora_fim: string
  profissional_id: number
  vigente_de: string
  vigente_ate: string | null
}

/** Faixa em edição (horas "HH:MM"). `chave` só existe no navegador. */
export type FaixaRascunho = {
  chave: string
  dia: number
  inicio: string
  fim: string
  duracao: number
  /** Pacientes por horário (1 = individual). */
  capacidade: number
  intervaloAtivo: boolean
  intervaloInicio: string
  intervaloFim: string
  localId: string | null
  /** Nome gravado na versão (sobrevive à sala apagada em Ocupação de Salas). */
  localNome?: string
  terapias: number[]
}

export type RascunhoDisponibilidade = {
  diasAtivos: number[]
  faixas: FaixaRascunho[]
}
