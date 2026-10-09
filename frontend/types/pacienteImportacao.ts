// Tipos para a importação de pacientes do TiTa e registro de histórico/diffs.

export type NovoPacienteImportado = {
  id: number
  tita_id: number | null
  nome: string
  cpf: string | null
}

export type MudancaCampo = {
  campo: string
  de?: string | null
  para?: string | null
}

export type PacienteAtualizadoImportado = {
  id: number
  tita_id: number | null
  nome: string
  campos: string[]
  mudancas?: MudancaCampo[]
}

export type DetalhesImportacaoPacientes = {
  novos?: NovoPacienteImportado[]
  atualizados?: PacienteAtualizadoImportado[]
}

export type ResultadoImportacaoPacientes = {
  sucesso: boolean
  log_id?: string
  vistos_na_tita: number
  novos: number
  vinculados_por_cpf: number
  atualizados: number
  detalhes: DetalhesImportacaoPacientes
  erro?: string
}

export type PacienteImportacaoLog = {
  id: string
  iniciado_em: string
  finalizado_em: string | null
  origem: "manual" | "cron"
  status: "sucesso" | "erro" | "em_andamento"
  vistos_na_tita: number
  novos: number
  vinculados_por_cpf: number
  atualizados: number
  detalhes: DetalhesImportacaoPacientes
  erro_mensagem: string | null
  usuario_id: string | null
  usuario_nome: string | null
}
