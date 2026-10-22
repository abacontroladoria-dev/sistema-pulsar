import type { NextRequest }  from 'next/server'
import { extractUser }       from '@/lib/central/auth'
import { mapCentralError }   from '@/lib/central/errors'
import { ok }                from '@/lib/central/response'
import {
  lerAgentSettingsDaOrg,
  lerInboxesMaiaResponde,
} from '@/modules/atendimento/agente/agent-settings'
import { createConversationService, createCentralUserService } from '@/modules/atendimento/services'
import type { ConversationStatus } from '@/modules/atendimento/types/central.types'

// GET /api/central/conversations/caixas?limit=50
//
// A triagem do atendimento: uma coluna por STATUS do atendimento, de uma vez —
// Autoatendimento, Aberto, Em atendimento, Aguardando, Resolvido, Fechado. Cada
// uma com a contagem total e as primeiras `limit` conversas.
//
// Todas juntas, e não uma por requisição, porque a tela mostra as colunas lado
// a lado: pedir uma por vez seriam seis idas de rede a cada tique do polling, e
// as colunas apareceriam em instantes diferentes — a soma na tela poderia não
// fechar com nenhum estado que o banco teve de fato.
//
// ATÉ 22/10/2026 as colunas eram "caixas" deduzidas do ai_mode efetivo
// (Maia/Humano/Ninguém/Encerradas — agente/caixas.ts), porque o status não
// dizia quem conduzia: a conversa da Maia e a largada eram ambas 'open'. Com o
// Autoatendimento (20261022100000) e o status movido pelos fatos do ciclo e
// pela leitura da Maia (ConversationService, workers/status.worker.ts), o
// status passou a ser a resposta, e a tela o mostra direto.
// A ordem é a de STATUS_ATENDIMENTO (components/nina/StatusAtendimento.tsx),
// que é como a tela as desenha.
const STATUS_DA_TRIAGEM: readonly ConversationStatus[] = [
  'self_service', 'open', 'assigned', 'waiting', 'resolved', 'archived',
]

const ENCERRADOS: readonly ConversationStatus[] = ['resolved', 'archived']

// Meia-noite de hoje em São Paulo (sem horário de verão desde 2019).
function inicioDoDiaSP(): string {
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  return new Date(`${dia}T00:00:00-03:00`).toISOString()
}

export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await extractUser()

    const limiteRaw = Number(request.nextUrl.searchParams.get('limit') ?? 50)
    const limit = Number.isFinite(limiteRaw) ? Math.min(Math.max(limiteRaw, 1), 100) : 50

    const service = createConversationService(supabase)

    // Não decidem coluna nenhuma: vão para o adapter montar o card igual ao do
    // inbox, e o padrão 'off' acende o aviso que explica um Autoatendimento
    // vazio. Falha fechada, como antes.
    const [settings, inboxesMaiaResponde] = await Promise.all([
      lerAgentSettingsDaOrg(supabase, user.orgId).catch(() => null),
      lerInboxesMaiaResponde(supabase, user.orgId).catch(() => [] as string[]),
    ])
    const modoPadrao = settings?.ai_mode ?? 'off'

    // As vivas são FILA: no topo quem espera há mais tempo. As encerradas são
    // histórico de HOJE e se leem do fim para trás — o total de todos os tempos
    // era o maior número da tela e não respondia nada. `list` devolve o `count`
    // exato do mesmo recorte, então número e linhas não divergem.
    const hoje = inicioDoDiaSP()
    const listas = await Promise.all(STATUS_DA_TRIAGEM.map(status => service.list({
      orgId:  user.orgId,
      status,
      ordem:  ENCERRADOS.includes(status) ? 'recente' : 'espera',
      encerradaDesde: status === 'resolved' ? { coluna: 'resolved_at', desde: hoje }
                    : status === 'archived' ? { coluna: 'archived_at', desde: hoje }
                    : undefined,
      limit,
    })))

    // Quem está com cada conversa — a pergunta da triagem. Service role, como
    // nas notas internas: a RLS de public.usuarios só mostra o próprio perfil.
    // Falha vira lista vazia: o card fica sem o nome, não a tela sem dados.
    const idsResponsaveis = [...new Set(listas.flatMap(l => l.data)
      .map(c => c.assigned_user_id).filter((id): id is string => !!id))]
    const nomes = await createCentralUserService().nomesDe(user.orgId, idsResponsaveis)
      .catch(() => new Map<string, string>())

    return ok({
      // `total` é a contagem REAL; `conversas` traz no máximo `limit`.
      colunas: Object.fromEntries(STATUS_DA_TRIAGEM.map((status, i) => [status, {
        conversas: listas[i]!.data,
        total:     listas[i]!.count,
      }])),
      responsaveis: Object.fromEntries(nomes),
      modoPadrao,
      inboxesMaiaResponde,
      limit,
    })
  } catch (err) {
    return mapCentralError(err)
  }
}
