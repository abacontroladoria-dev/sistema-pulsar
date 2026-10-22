// ============================================================================
// Plantão da Maia — a marca em `ai_context.plantao_maia` (22/10/2026)
//
// Fora do expediente (horario-comercial.ts), numa conversa que um atendente
// assumiu, a Maia responde quando a pessoa escreve. A marca de transferida
// (caixas.ts) NÃO muda: a conversa continua do atendente, e às 08h a Maia volta
// ao rascunho sem que ninguém precise mexer. Esta marca só guarda o que o
// plantão precisa lembrar entre um turno e outro, por janela fora do horário
// (`janela` = o instante em que o expediente reabre):
//
//   anunciadoEm — ela já disse que assumiu; nas próximas respostas não repete.
//   encerradoEm — ela passou o assunto para a equipe (escalar_para_humano ou
//                 falha do turno): cala nesta conversa até a reabertura.
//
// Atendente que escreve depois do fechamento não precisa de marca: o worker vê
// a mensagem dele no histórico (humanoDepoisDoFechamento) e não entra.
//
// Janela nova (a noite seguinte) começa do zero: avisa de novo, responde de novo.
// ============================================================================

export const CHAVE_PLANTAO = 'plantao_maia'

export interface MarcaPlantao {
  janela: string
  anunciadoEm?: string
  encerradoEm?: string
  motivo?: string
}

// `proximaAbertura` null (nada reabre nos próximos dias) vira uma janela só.
export function janelaDoPlantao(proximaAbertura: string | null): string {
  return proximaAbertura ?? 'sem_abertura'
}

export function plantaoDaJanela(aiContext: unknown, janela: string): MarcaPlantao | null {
  if (!aiContext || typeof aiContext !== 'object' || Array.isArray(aiContext)) return null
  const m = (aiContext as Record<string, unknown>)[CHAVE_PLANTAO]
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null
  const marca = m as MarcaPlantao
  return marca.janela === janela ? marca : null
}

export function plantaoEncerrado(aiContext: unknown, janela: string): boolean {
  return Boolean(plantaoDaJanela(aiContext, janela)?.encerradoEm)
}

export function plantaoAnunciado(aiContext: unknown, janela: string): boolean {
  return Boolean(plantaoDaJanela(aiContext, janela)?.anunciadoEm)
}

// Gente da clínica escreveu depois do fechamento (pela tela ou pelo celular do
// número; a ingestão grava o eco como outbound com sent_by_ai false): o
// atendente ficou além do horário e segue na conversa. Vale também para quem
// responde no meio do plantão — dali em diante a Maia não entra. Sem
// `fechadoDesde` (nada abriu nos últimos dias), não há como saber: entra.
export function humanoDepoisDoFechamento(
  historico: { direction: string; sent_by_ai: boolean | null; created_at: string }[],
  fechadoDesde: string | null,
): boolean {
  if (!fechadoDesde) return false
  const desde = Date.parse(fechadoDesde)
  return historico.some((m) => m.direction === 'outbound' && m.sent_by_ai !== true && Date.parse(m.created_at) >= desde)
}
