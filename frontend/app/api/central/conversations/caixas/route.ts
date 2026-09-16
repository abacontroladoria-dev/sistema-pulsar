import type { NextRequest }  from 'next/server'
import { extractUser }       from '@/lib/central/auth'
import { mapCentralError }   from '@/lib/central/errors'
import { ok }                from '@/lib/central/response'
import { lerAgentSettingsDaOrg } from '@/modules/atendimento/agente/agent-settings'
import { CAIXAS, filtroDaCaixa, type Caixa } from '@/modules/atendimento/agente/caixas'
import { createConversationService } from '@/modules/atendimento/services'

// GET /api/central/conversations/caixas?limit=50
//
// A triagem do atendimento: as QUATRO filas de uma vez — com a Maia, com um
// humano, largadas (a Maia passou e ninguém pegou) e encerradas. Cada uma vem
// com a contagem total e as primeiras `limit` conversas.
//
// As quatro juntas, e não uma por vez, porque a tela mostra as quatro colunas
// lado a lado: pedir uma caixa por requisição seriam quatro idas de rede a cada
// tique do polling, e as colunas apareceriam em instantes diferentes — a soma na
// tela poderia não fechar com nenhum estado que o banco teve de fato.
//
// POR QUE ESTA ROTA EXISTE, e não um filtro a mais em /conversations:
//
// A caixa de uma conversa NÃO está em coluna nenhuma. Ela depende do `ai_mode`
// EFETIVO, que é `conversations.ai_mode` quando alguém decidiu algo naquela
// conversa e `agent_settings.ai_mode` quando a coluna é NULL — o caso da grande
// maioria das linhas (ver 20260915220000). Resolver isso exige ler o padrão da
// clínica ANTES de montar a consulta, uma vez por requisição.
//
// Daí a regra que vale para qualquer cliente desta API: quem classificar pela
// coluna crua vai marcar como "Humano" justamente as conversas que a Maia está
// atendendo por herança. O lugar de fazer isso é aqui, no servidor, uma vez.
export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await extractUser()

    const limiteRaw = Number(request.nextUrl.searchParams.get('limit') ?? 50)
    const limit = Number.isFinite(limiteRaw) ? Math.min(Math.max(limiteRaw, 1), 100) : 50

    const service = createConversationService(supabase)

    // O padrão da clínica, lido UMA vez e usado pelas cinco consultas abaixo.
    // Falha fechada em 'off', igual ao worker e à rota de detalhe: sem settings
    // legível, ninguém é declarado "sendo atendido pela Maia".
    //
    // LIMITAÇÃO CONHECIDA: usa o padrão da ORGANIZAÇÃO. Uma inbox com ai_mode
    // próprio (agent_settings com inbox_id preenchido) não é respeitada aqui, e
    // as conversas herdadas dela podem cair na caixa errada. Hoje não há inbox
    // com configuração própria; quando houver, o recorte tem que passar a ser
    // por inbox — e aí esta rota precisa de um `inboxId` na query.
    const settings = await lerAgentSettingsDaOrg(supabase, user.orgId).catch(() => null)
    const modoPadrao = settings?.ai_mode ?? 'off'

    const paraFiltro = (c: Caixa) => {
      const f = filtroDaCaixa(c, modoPadrao)
      return {
        orgId:          user.orgId,
        status:         f.status,
        aiModeIn:       f.aiModeIn,
        assignedUserId: f.responsavel === 'nenhum' ? null : undefined,
        responsavel:    f.responsavel === 'qualquer' ? ('qualquer' as const) : undefined,
        // As três caixas vivas são FILA: no topo quem espera há mais tempo.
        // "Encerradas" não é fila, é histórico — e histórico se consulta do fim
        // para trás ("o que acabou de fechar"), então ela mantém a ordem do
        // inbox. A tela rotula as duas ordens, para a inversão não parecer
        // defeito de quem lê as colunas lado a lado.
        ordem: (c === 'encerradas' ? 'recente' : 'espera') as 'recente' | 'espera',
        limit,
      }
    }

    // As quatro filas em paralelo. Sem `contar()` à parte: `list` já devolve o
    // `count` exato do mesmo recorte, então o número do cabeçalho e as linhas da
    // coluna vêm da MESMA consulta e não têm como divergir — nem por diferença
    // de filtro, nem por escrita que caia entre duas consultas.
    const [maia, humano, ninguem, encerradas] = await Promise.all([
      service.list(paraFiltro('maia')),
      service.list(paraFiltro('humano')),
      service.list(paraFiltro('ninguem')),
      service.list(paraFiltro('encerradas')),
    ])

    const caixas = { maia, humano, ninguem, encerradas }

    // A metadata da triagem vai no corpo, não no slot de paginação do `ok()`:
    // aquele parâmetro é só paginação, e é usado por todas as rotas da Central.
    // Alargá-lo para caber as caixas faria o tipo compartilhado carregar um
    // conceito que só esta rota tem.
    return ok({
      // `total` é a contagem REAL da caixa; `conversas` traz no máximo `limit`.
      // Os dois separados de propósito: a coluna avisa quantas não coube exibir,
      // e o número do topo nunca mente por causa do teto da lista.
      caixas: Object.fromEntries(
        CAIXAS.map(c => [c, {
          conversas: caixas[c].data,
          total:     caixas[c].count,
        }]),
      ),
      // A origem do recorte vai junto: com o padrão da clínica em 'off', a caixa
      // "Maia" só tem as conversas ligadas na mão — e quem olha a tela merece
      // saber que o número pequeno é isso, não falta de movimento.
      modoPadrao,
      limit,
    })
  } catch (err) {
    return mapCentralError(err)
  }
}
