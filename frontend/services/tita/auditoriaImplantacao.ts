import "server-only"

import { supabaseService } from "@/lib/supabase/service"
import { dataHoraBrasilia } from "@/lib/dataHoraBrasilia"
import type { AceiteSessao } from "@/types/acompanhamento"
import type { GradeProfissionalRow } from "./types"
import type { ResumoCriacao } from "./confirmar"
import { resolverNome } from "./inclusaoTerapia"

// Log de toda tentativa de implantação na TiTa feita por /cronograma/ocupacao-paciente,
// em aumentar_ocupacao_paciente_auditoria (tipo=implantacao, origem=servidor).
// Ao contrário de acomp_pac_bundles, que é o estado da tela e perde linhas, este
// log só recebe inserts — ver migration 20260924190000.

const LOG_TAG = "[tita:auditoria]"
const TABLE = "aumentar_ocupacao_paciente_auditoria"

export type AcaoImplantacao =
  | "implantada"
  | "implantada_parcial"
  | "falha_conflito"
  | "falha_api"
  | "falha_preparacao"
  | "falha_disponibilidade"
  | "cancelada"

export interface LinhaAuditoriaImplantacao {
  sessao: AceiteSessao
  grade?: GradeProfissionalRow
  acao: AcaoImplantacao
  detalhe?: string | null
  resumo?: ResumoCriacao
}

/** `httpOk` falso vence o resumo: a chamada em si falhou, o que a TiTa criou antes é desconhecido. */
export function acaoDaCriacao(httpOk: boolean, resumo: ResumoCriacao): AcaoImplantacao {
  if (!httpOk) return "falha_api"
  switch (resumo.status) {
    case "success": return "implantada"
    case "partial_success": return "implantada_parcial"
    case "failed": return "falha_conflito"
    default: return "falha_api"
  }
}

/** Nunca lança: registrar não pode derrubar a implantação. */
export async function registrarAuditoriaImplantacao(params: {
  pac: string
  linhas: LinhaAuditoriaImplantacao[]
  /** null cobre DISABLE_AUTH em dev (sem sessão real) — usuario_id é FK anulável. */
  userId: string | null
  userEmail: string | null
  modalidade?: "aumentar" | "novo"
}): Promise<void> {
  const { pac, linhas, userId, userEmail, modalidade } = params
  if (linhas.length === 0) return

  try {
    const nome = userId ? await resolverNome(userId, userEmail) : userEmail
    const { data, hora } = dataHoraBrasilia()

    // terapia/profissional/dia/hora saem da sessão da tela (mesmo formato das
    // linhas históricas e de acomp_pac_bundles); a grade só cobre o que faltar.
    const rows = linhas.map(({ sessao, grade, acao, detalhe, resumo }) => ({
      data,
      hora,
      usuario: nome,
      email: userEmail,
      usuario_id: userId,
      paciente: pac,
      terapia: sessao.tP || grade?.terapia_nome || null,
      profissional: sessao.prof || grade?.profissional_nome || null,
      dia_sessao: sessao.dia || null,
      hora_sessao: sessao.hora || grade?.hora_inicial || null,
      acao,
      detalhe: detalhe ?? null,
      tipo: "implantacao",
      origem: "servidor",
      modalidade: modalidade ?? null,
      csv_grade_id: sessao.csvGradeId,
      id_agenda_fav: resumo?.idAgendaFav ?? null,
      criadas: resumo?.criadas ?? null,
      conflitos: resumo?.conflitos ?? null,
    }))

    const { error } = await supabaseService.from(TABLE).insert(rows)
    if (error) {
      console.error(`${LOG_TAG} falha ao registrar`, JSON.stringify({ pac, linhas: rows.length, erro: error.message }))
    }
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err)
    console.error(`${LOG_TAG} erro inesperado (implantação NÃO afetada)`, JSON.stringify({ pac, mensagem }))
  }
}
