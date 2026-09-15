import type { NextRequest }  from 'next/server'
import { extractUser }       from '@/lib/central/auth'
import { mapCentralError }   from '@/lib/central/errors'
import { ok, badRequest }    from '@/lib/central/response'
import { lerAgentSettingsDaOrg } from '@/modules/atendimento/agente/agent-settings'
import { CAIXAS, isCaixa, filtroDaCaixa, type Caixa } from '@/modules/atendimento/agente/caixas'
import { createConversationService } from '@/modules/atendimento/services'

// GET /api/central/conversations/caixas?caixa=ninguem&limit=50
//
// A triagem do atendimento: quantas conversas estão com a Maia, com um humano,
// largadas (a Maia passou e ninguém pegou) e encerradas — mais a lista da caixa
// pedida.
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

    const caixaRaw = request.nextUrl.searchParams.get('caixa') ?? 'ninguem'
    if (!isCaixa(caixaRaw)) {
      return badRequest(`caixa inválida: ${caixaRaw} (use ${CAIXAS.join(', ')})`)
    }
    const caixa: Caixa = caixaRaw

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
      }
    }

    // As quatro contagens e a lista da caixa aberta, em paralelo. As contagens
    // usam head:true — não trazem linha nenhuma.
    const [maia, humano, ninguem, encerradas, lista] = await Promise.all([
      service.contar(paraFiltro('maia')),
      service.contar(paraFiltro('humano')),
      service.contar(paraFiltro('ninguem')),
      service.contar(paraFiltro('encerradas')),
      service.list({ ...paraFiltro(caixa), limit }),
    ])

    // A metadata da triagem vai no corpo, não no slot de paginação do `ok()`:
    // aquele parâmetro é só paginação, e é usado por todas as rotas da Central.
    // Alargá-lo para caber contagens de caixa faria o tipo compartilhado carregar
    // um conceito que só esta rota tem.
    return ok({
      conversas: lista.data,
      caixa,
      // A origem do recorte vai junto: com o padrão da clínica em 'off', a caixa
      // "Maia" só tem as conversas ligadas na mão — e quem olha a tela merece
      // saber que o número pequeno é isso, não falta de movimento.
      modoPadrao,
      contagens: { maia, humano, ninguem, encerradas },
      total:     lista.count,
    })
  } catch (err) {
    return mapCentralError(err)
  }
}
