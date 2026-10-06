/**
 * Quem EXECUTOU a sessão, não quem estava agendado.
 *
 * Na substituição a grade continua com o agendado em `profissional_id`; quem
 * atendeu e evoluiu vem na tratativa (`tratativa_profissional_id`). A evolução
 * é de quem a escreveu — é esse que a auditoria cobra.
 */
export interface LinhaComTratativa {
  profissional_id: number | null
  profissional_nome: string | null
  tratativa_profissional_id: number | null
  tratativa_profissional_nome: string | null
}

export function executorDaSessao(r: LinhaComTratativa) {
  const substituicao =
    r.tratativa_profissional_id != null &&
    r.profissional_id != null &&
    r.tratativa_profissional_id !== r.profissional_id

  if (!substituicao) {
    return {
      profissional_id: r.tratativa_profissional_id ?? r.profissional_id,
      profissional_nome: r.profissional_nome || r.tratativa_profissional_nome,
      substituicao: false,
      profissional_agendado_id: null,
      profissional_agendado_nome: null
    }
  }
  return {
    profissional_id: r.tratativa_profissional_id,
    profissional_nome: r.tratativa_profissional_nome || r.profissional_nome,
    substituicao: true,
    profissional_agendado_id: r.profissional_id,
    profissional_agendado_nome: r.profissional_nome
  }
}

/** Filtro PostgREST (`.or`) de "sessões executadas pelo profissional X". */
export function filtroExecutadoPor(profissionalId: number): string {
  return `tratativa_profissional_id.eq.${profissionalId},and(tratativa_profissional_id.is.null,profissional_id.eq.${profissionalId})`
}
