// Exportar Evoluções (Autorização). Plano: docs/PLANO_EXPORTAR_EVOLUCOES.md.

export type OrigemEvolucao = "tita" | "pulsar"

/** Um card da tela — SEM o texto (exportar_evolucoes_listar). */
export type EvolucaoItem = {
  /** `tita:<uuid>` ou `pulsar:<uuid>` — identifica a evolução nos pedidos de conteúdo. */
  chave: string
  origem: OrigemEvolucao
  /**
   * ID do agendamento (o do TiTa; sessão só do Pulsar mostra o id da Grade).
   * Vazio na evolução "Sem agendamento" — e ausente enquanto a migration
   * 20261019200200 não estiver aplicada (o localhost usa o banco de produção).
   */
  agendamento_id?: string | null
  /** AAAA-MM-DD */
  data: string
  /** HH:MM */
  hora_inicio: string | null
  hora_fim: string | null
  paciente_id: number | null
  paciente_nome: string
  convenio: string | null
  /** Terapia de exibição. */
  terapia: string
  profissional_id: number | null
  /** Quem executou (o substituto, quando houve troca). */
  profissional_nome: string
  tem_assinatura: boolean
  substituicao: boolean
}

/** A evolução completa, para painel, PDF e CSV (exportar_evolucoes_conteudo). */
export type EvolucaoConteudo = EvolucaoItem & {
  paciente_cpf: string | null
  /** AAAA-MM-DD */
  paciente_nascimento: string | null
  tipo_registro: string | null
  uf_registro: string | null
  codigo_registro: string | null
  /** Só Pulsar: usuário que digitou. Informação interna da tela, nunca vai para o arquivo. */
  registrado_por_nome: string | null
  descricao: string
}

export type FinalidadeConteudo = "visualizacao" | "pdf" | "csv"

/** Imagem da assinatura do profissional, pronta para o pdf-lib. */
export type AssinaturaProfissional = {
  profissional_id: number
  tipo: "png" | "jpg"
  /** base64 */
  dados: string
}
