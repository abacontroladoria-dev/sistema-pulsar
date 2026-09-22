// Trilha de auditoria dos cadastros.
// Ver supabase/migrations/20260826120000_create_cadastros_auditoria.sql.

// `alta` e `alta_individualidade` são entidades distintas porque são TABELAS
// distintas — cadastros_pacientes_altas (1:N, uma alta por especialidade) e
// cadastros_pacientes_altas_individualidades (0-ou-1 por paciente) —, cada uma
// com sua própria sequência de id. Até 20260826140300 as duas gravavam sob
// `alta_individualidade`, e o filtro por (tabela, registro_id) misturava a
// trilha de uma com a da outra.
export type EntidadeAuditada =
  | "paciente"
  | "responsavel"
  | "ficha_medica"
  | "convenio"
  | "plano_saude"
  | "laudo"
  | "alta"
  | "alta_individualidade"
  | "suspensao_temporaria"
  // Alta clínica geral (encerra todas as terapias do paciente), distinta da
  // alta por especialidade (`alta`). Ver 20260921200000/200200.
  | "alta_clinica"
  // Acompanhamento de laudo do Órbita (tela /acompanhamento/laudos). O
  // `registro_id` é o `ID Laudo` do Órbita — texto, não id numérico do Pulsar —,
  // que é a única chave daquele relatório que sobrevive à troca de importação do
  // robô. Ver 20260828150000/150100.
  | "laudo_acompanhamento"
  // Controle de Prazos do PDI (tela /terapeutico/prazos-pdi, plano em
  // serene-seeking-toast.md). `registro_id` é o `paciente_id` — a PK de
  // public.pdi_controle_prazos. Ver 20260904120000/120100.
  | "pdi_controle_prazos"

export type AcaoAuditada = "criar" | "editar" | "excluir" | "inativar" | "reativar"

export type RegistroAuditoria = {
  id: string
  tabela: EntidadeAuditada
  registro_id: string
  acao: AcaoAuditada

  paciente_id: number | null
  paciente_nome: string | null
  convenio_nome: string | null
  alvo_nome: string | null

  antes: Record<string, unknown> | null
  depois: Record<string, unknown> | null
  resumo: string | null
  motivo: string | null

  usuario_id: string | null
  usuario_nome: string | null

  criado_em: string
  criado_em_brasilia: string | null
}

/** O que os services de escrita informam. `resumo` é calculado, não passado. */
export type EntradaAuditoria = {
  tabela: EntidadeAuditada
  registroId: string | number
  acao: AcaoAuditada
  pacienteId?: number | null
  pacienteNome?: string | null
  convenioNome?: string | null
  alvoNome?: string | null
  antes?: Record<string, unknown> | null
  depois?: Record<string, unknown> | null
  motivo?: string | null
}

export const ENTIDADE_LABEL: Record<EntidadeAuditada, string> = {
  paciente: "Paciente",
  responsavel: "Responsável",
  ficha_medica: "Ficha médica",
  convenio: "Convênio",
  plano_saude: "Plano de saúde",
  laudo: "Laudo",
  alta: "Alta",
  alta_individualidade: "Individualidades",
  suspensao_temporaria: "Suspensão temporária",
  alta_clinica: "Alta clínica",
  laudo_acompanhamento: "Acompanhamento de laudo",
  pdi_controle_prazos: "Controle de Prazos PDI",
}

export const ACAO_LABEL: Record<AcaoAuditada, string> = {
  criar: "Criou",
  editar: "Editou",
  excluir: "Excluiu",
  inativar: "Inativou",
  reativar: "Reativou",
}
