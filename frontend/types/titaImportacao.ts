// Importações do TiTa disparadas sob demanda (cadastro de profissionais e
// disponibilidade). Ver supabase/migrations/20261015190000_tita_importacoes_disponibilidade.sql.

export type AlvoImportacaoTita = "profissionais" | "disponibilidade"
export type SituacaoImportacaoTita = "previa" | "aplicando" | "sucesso" | "parcial" | "erro" | "descartada"
export type TipoItemImportacaoTita = "novo" | "alterado" | "igual" | "pendencia" | "sem_grade"

export type MudancaImportacao = {
  campo: string
  de?: string | null
  para?: string | null
}

export type ImportacaoTita = {
  id: string
  alvo: AlvoImportacaoTita
  situacao: SituacaoImportacaoTita
  origem: "manual" | "cron"
  parametros: { vigente_de?: string; semana_de?: string; semana_ate?: string }
  vistos_na_tita: number
  novos: number
  alterados: number
  iguais: number
  pendencias: number
  sem_grade: number
  aplicados: number
  erros: number
  extras: { vinculados_por_cpf?: number; terapias_habilitadas?: number }
  erro_mensagem: string | null
  usuario_nome: string | null
  iniciado_em: string
  finalizado_em: string | null
}

export type ItemImportacaoTita = {
  id: number
  importacao_id: string
  tipo: TipoItemImportacaoTita
  entidade_id: number | null
  tita_id: number | null
  nome: string
  resumo: string | null
  mudancas: MudancaImportacao[]
  etiquetas: string[]
  aplicado_em: string | null
  erro: string | null
}

/** O que a tela manda para a RPC de prévia, um por profissional. */
export type ItemPreviaDisponibilidade = {
  tipo: TipoItemImportacaoTita
  profissional_id: number
  /** Só para a tela: a RPC usa o nome do cadastro. */
  nome: string
  resumo?: string
  mudancas?: MudancaImportacao[]
  etiquetas?: string[]
  payload?: { dias: number[]; faixas: unknown[]; habilitar: number[] }
}
