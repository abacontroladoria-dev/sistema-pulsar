// ─── TIPOS COMPARTILHADOS — ABA ACOMPANHAMENTO ────────────────────────────────

export interface AceiteSessao {
  dia: string
  hora: string
  tP: string
  prof: string
  unidade: string
  /** UUID da linha em csv_grades_profissionais de origem — usado para resolver o agendamento no TiTa. */
  csvGradeId: string
  /**
   * terapia_exibicao_id resolvido no cliente para Aplicador ABA (AE)/(HS) — depende
   * de laudo (Arteterapia/Habilidades Sociais) + convênio do paciente, dados que só
   * existem no navegador (ver OcupPacMode.tsx). Quando presente, tem prioridade
   * sobre qualquer valor sincronizado ou regra fixa no servidor (ver
   * prepararAgendamento em services/tita/confirmar.ts) — só é preenchido pra AE/HS,
   * as demais terapias resolvem normalmente no servidor.
   */
  terapiaExibicaoOverride?: number
  /**
   * id_favorecido (paciente no TiTa) vindo do laudo — único caminho de resolução
   * pra paciente sem NENHUMA linha "Agendado" ainda em csv_grades_profissionais
   * (ver resolverIdFavorecido em services/tita/mappings.ts), caso da modalidade
   * "Criar Novo Cronograma". Ignorado quando o paciente já tem linha Agendado
   * (o servidor sempre prioriza essa, mais confiável que o laudo).
   */
  idFavorecidoFallback?: number
}

export type SlotStatus = "confirmado" | "recusado" | "inviavel"

export interface AceitePacBundle {
  id: string
  pac: string
  ts: number
  origem: "ocp-paciente"
  sessoes: AceiteSessao[]
  // "removido_tita": bundle antes implantado cuja série foi excluída diretamente na
  // TiTa (a API só grava, não exclui) e detectada pela reconciliação — some da grade
  // como "Implantado" e libera o slot. Ver reconciliação em OcupPacMode.tsx.
  status: "pendente" | "confirmado" | "recusado" | "inviavel" | "removido_tita"
  inviavelSlots: string[]
  motivo?: string
  slotStatus?: Record<string, SlotStatus>
  // Auditoria da implantação (imutável, gravado no momento da confirmação a partir
  // do usuário autenticado no servidor). Distinto de atualizado_por, que é um carimbo
  // coletivo do último a sincronizar a tabela. implantadoPorEmail é um snapshot do
  // email na hora da ação — sobrevive a troca/exclusão do usuário.
  implantadoPor?: string
  implantadoPorEmail?: string
}

export interface ConfItem {
  id: string        // gerado na criação — PK no Supabase
  pac: string
  prof: string
  esp: string
  unidade: string
  dia: string
  hora: string
  origem: string
  registradoEm: string
  obs?: string
}
