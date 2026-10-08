import type { StatusContrato, TipoContrato, Vigencia } from "@/lib/contratos/status"
import type { OrigemCadastroPaciente } from "@/types/paciente"

// Contratos do PACIENTE (aba Contratos + Status Contratos). Não confundir com
// types/contratos* de prestador (remuneracao_contratos).
//
// Espelha public.pacientes_contratos* (supabase/migrations/20261008160000).

export type ContratoPaciente = {
  id: number
  paciente_id: number
  tipo: TipoContrato
  /** "AAAA-MM-DD" */
  data_inicio: string
  /** "AAAA-MM-DD" */
  data_vencimento: string
  status: StatusContrato
  assinado_em: string | null
  origem_assinatura: "manual" | "d4sign" | null
  arquivo_original_path: string | null
  arquivo_original_nome: string | null
  arquivo_assinado_path: string | null
  d4sign_documento_uuid: string | null
  link_expira_em: string | null
  observacao: string | null
  criado_por_nome: string | null
  criado_em: string
  atualizado_em: string
}

export type TipoEventoContrato =
  | "criado"
  | "editado"
  | "arquivo_anexado"
  | "enviado_d4sign"
  | "link_enviado_whatsapp"
  | "link_reenviado"
  | "assinado"
  | "recusado"
  | "cancelado"
  | "expirado"
  | "assinado_manual"
  | "status_corrigido"

export type EventoContrato = {
  id: number
  contrato_id: number
  tipo: TipoEventoContrato
  status_antes: StatusContrato | null
  status_depois: StatusContrato | null
  detalhe: Record<string, unknown> | null
  origem: "usuario" | "d4sign" | "sistema"
  usuario_nome: string | null
  criado_em: string
  criado_em_brasilia: string | null
}

export type SignatarioContrato = {
  id: number
  contrato_id: number
  responsavel_id: number | null
  nome: string
  status: "pendente" | "assinado" | "recusado"
  assinado_em: string | null
  link_enviado_em: string | null
  envios: number
}

// ─── Status Contratos (/api/status-contratos) ────────────────────────────────

/** O contrato que vale para um tipo, já com o status efetivo e a vigência. */
export type ResumoContrato = {
  id: number
  tipo: TipoContrato
  dataInicio: string
  dataVencimento: string
  /** Status EFETIVO (link vencido já aparece como "expirado"). */
  status: StatusContrato
  vigencia: Vigencia
  assinadoEm: string | null
}

export type ItemStatusContratos = {
  pacienteId: number
  /**
   * Para `idExibicao()` (types/paciente.ts) mostrar o ID do TiTa, não o interno
   * do Pulsar, quando o paciente veio de lá — mesma regra de /cadastros/pacientes.
   */
  origemCadastro: OrigemCadastroPaciente
  titaPacienteId: number | null
  nome: string
  ativo: boolean
  /** Horário Administrativo, Notificação Prévia e afins — não é criança de verdade. */
  ficticio: boolean
  fotoPath: string | null
  /** Tem agendamento na grade do TiTa (unidade 280). */
  naGrade: boolean
  /**
   * Tem pelo menos uma sessão NÃO-Triagem na grade (unidade 280). Decide se
   * "Sem contrato" cobra: paciente só com Triagem ainda está em avaliação de
   * entrada, não em tratamento — não cobra. Sem leitura da grade, assume
   * `true` (mais seguro cobrar à toa do que deixar passar).
   */
  temTerapiaReal: boolean
  /** Convênio pela grade do TiTa; sem grade, o do cadastro. */
  convenio: string | null
  /** O contrato atual de cada tipo — só os tipos que o paciente tem. */
  contratos: ResumoContrato[]
  /** Contratos não cancelados, contando os antigos (renovações). */
  totalContratos: number
}

export type MetaStatusContratos = {
  /** "AAAA-MM-DD" em Brasília — o mesmo que decidiu a vigência de cada item. */
  hoje: string
  pacientes: number
  contratos: number
  /** A leitura da grade falhou: "possui agendamentos" e o convênio da grade ficaram de fora. */
  gradeErro: string | null
  /** A leitura de quem tem terapia real (não-Triagem) falhou: "Sem contrato" assumiu que todos precisam. */
  terapiaRealErro: string | null
  /** A migration ainda não foi aplicada no banco. */
  migracaoPendente: boolean
}
