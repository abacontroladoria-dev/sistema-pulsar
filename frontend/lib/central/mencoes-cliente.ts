import type { MencaoVista } from '@/modules/atendimento/services/mencao.service'
import { avisarMencoesAlteradas } from '@/lib/central/mencoes-evento'

// ============================================================================
// Chamadas do navegador às rotas de menções — usadas pelo painel do Chat da
// equipe, por /connect/mencoes e pela janela da página inicial do Pulsar.
//
// Toda URL termina em barra: `trailingSlash: true` responde 308 sem ela, e o
// corpo de um POST/PATCH não sobrevive ao redirecionamento.
//
// Toda escrita bem-sucedida avisa o contador do menu (avisarMencoesAlteradas),
// para o número se acertar sem esperar o tique de 30s.
// ============================================================================

export type { MencaoVista }
export type FiltroMencoes = 'nao_lidas' | 'lidas' | 'todas'

async function lerErro(res: Response, padrao: string): Promise<Error> {
  const json = await res.json().catch(() => null)
  return new Error(json?.error?.message ?? `${padrao} (${res.status}).`)
}

export async function listarMencoes(
  filtro: FiltroMencoes,
  opcoes: { limit?: number; antesDe?: string; signal?: AbortSignal } = {},
): Promise<{ mencoes: MencaoVista[]; temMais: boolean }> {
  const params = new URLSearchParams({ status: filtro, limit: String(opcoes.limit ?? 30) })
  if (opcoes.antesDe) params.set('before', opcoes.antesDe)

  const res = await fetch(`/api/central/mencoes/?${params}`, { signal: opcoes.signal, cache: 'no-store' })
  if (!res.ok) throw await lerErro(res, 'Não foi possível carregar as menções')
  const json = await res.json()
  return {
    mencoes: (json?.data ?? []) as MencaoVista[],
    temMais: json?.pagination?.hasMore === true,
  }
}

export async function marcarMencao(id: string, lida: boolean): Promise<void> {
  const res = await fetch(`/api/central/mencoes/${id}/`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ lida }),
  })
  if (!res.ok) throw await lerErro(res, 'A marcação falhou')
  avisarMencoesAlteradas()
}

export async function marcarTodasComoLidas(): Promise<void> {
  const res = await fetch('/api/central/mencoes/lidas/', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ todas: true }),
  })
  if (!res.ok) throw await lerErro(res, 'A marcação falhou')
  avisarMencoesAlteradas()
}

// "agora", "há 5 min", "há 2 h", "ontem", "há 3 dias", depois a data.
export function quandoRelativo(iso: string, agora = Date.now()): string {
  const min = Math.floor((agora - new Date(iso).getTime()) / 60_000)
  if (min < 1)  return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24)   return `há ${h} h`
  const d = Math.floor(h / 24)
  if (d === 1)  return 'ontem'
  if (d < 7)    return `há ${d} dias`
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// O link do inbox que abre a conversa (e, ao abrir, marca as menções dela).
export const linkDaConversa = (conversationId: string) => `/connect/inbox/?c=${conversationId}`
