// ============================================================================
// Aviso "as menções mudaram" — quem marca lida/não lida ou abre a conversa
// dispara; o contador do Chat da equipe recontra na hora, sem esperar o tique.
//
// Módulo sem dependências de propósito: o contexto do Chat da equipe, o cliente
// das rotas e o inbox importam daqui sem formar ciclo entre si.
// ============================================================================

export const EVENTO_MENCOES_ALTERADAS = 'mencoes:alteradas'

export function avisarMencoesAlteradas(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_MENCOES_ALTERADAS))
}
