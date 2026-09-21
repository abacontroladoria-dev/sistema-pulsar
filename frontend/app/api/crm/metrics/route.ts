import type { NextRequest }  from 'next/server'
import { extractUser }       from '@/lib/central/auth'
import { mapComercialError } from '@/lib/comercial/errors'
import { ok, badRequest }    from '@/lib/central/response'
import { DealRepository }    from '@/modules/comercial/repositories/deal.repository'

// ============================================================================
// GET /api/crm/metrics?days=N
//
// Números do Dashboard comercial. Substitui api.fetchDashboardMetrics(), que
// devolvia "24 atendimentos / 8 leads / 3 conversões / 2m" fixos.
//
// Todos os valores são CONTAGENS REAIS. Quando não há dados, o retorno é zero
// — e zero é uma resposta legítima, não uma falha a disfarçar. O painel da
// diretoria segue essa mesma disciplina: escreve "presença s/ registro" onde
// não há registro, nunca 0%.
//
// `variacao` compara com o período imediatamente anterior de mesmo tamanho
// (os 7 dias antes dos últimos 7, por exemplo). Vem null quando não há base
// anterior para comparar — a UI então não desenha seta, em vez de mostrar
// "+100%" contra o nada.
// ============================================================================

function variacaoPercentual(atual: number, anterior: number): number | null {
  // Sem base anterior não existe variação. Retornar 100% aqui seria inventar
  // crescimento onde só houve início de medição.
  if (anterior === 0) return null
  return Math.round(((atual - anterior) / anterior) * 100)
}

// ----------------------------------------------------------------------------
// O CRM pode estar fora do ar por instalação, não por falha.
//
// PGRST106 = o schema `crm` não está em Settings → API → Exposed schemas. É o
// estado de uma instalação incompleta, e ele NÃO é um erro desta requisição:
// o pedido estava correto, a resposta é que o módulo comercial ainda não foi
// ligado neste projeto.
//
// Tratá-lo como falha fazia o dashboard inteiro virar uma tarja vermelha
// dizendo "Internal server error" — e o resto da página do Connect, que não
// depende de CRM nenhum, ficava com cara de quebrado junto. Um módulo não
// instalado não pode parecer um sistema com defeito.
//
// Por isso a rota responde 200 com `crmIndisponivel: true`: é um QUARTO
// estado, ao lado de erro / semDados / dados, e a UI o desenha como aviso
// informativo. Ver o comentário de estados em components/nina/Dashboard.tsx.
// ----------------------------------------------------------------------------
function ehSchemaNaoExposto(err: unknown): boolean {
  return (
    typeof err === 'object'
    && err !== null
    && !(err instanceof Error)
    && (err as { code?: unknown }).code === 'PGRST106'
  )
}

export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await extractUser()

    const days = Number(request.nextUrl.searchParams.get('days') ?? 1)
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      return badRequest('days deve estar entre 1 e 365', 'days')
    }

    const agora     = Date.now()
    const umDia     = 86_400_000
    const inicio    = new Date(agora - days * umDia).toISOString()
    // Janela anterior de mesmo tamanho, imediatamente colada à atual.
    const inicioAnt = new Date(agora - days * 2 * umDia).toISOString()

    const repo = new DealRepository(supabase)

    // Independentes entre si — paralelizadas para uma única espera de rede.
    const [
      novosAtual, novosAnterior,
      abertos, ganhos, perdidos,
      valorGanhoAtual, valorGanhoAnterior,
    ] = await Promise.all([
      repo.contarCriadosDesde(user.orgId, inicio),
      repo.contarCriadosDesde(user.orgId, inicioAnt),
      repo.contarPorStatus(user.orgId, 'open'),
      repo.contarPorStatus(user.orgId, 'won'),
      repo.contarPorStatus(user.orgId, 'lost'),
      repo.somarValorGanhoDesde(user.orgId, inicio),
      repo.somarValorGanhoDesde(user.orgId, inicioAnt),
    ])

    // A janela anterior vem acumulada desde inicioAnt (inclui a atual), então
    // subtraímos para isolar só o período de comparação.
    const novosSoAnterior = Math.max(novosAnterior - novosAtual, 0)
    const valorSoAnterior = Math.max(valorGanhoAnterior - valorGanhoAtual, 0)

    // Taxa de conversão sobre negócios FECHADOS (ganhos + perdidos).
    // Incluir os abertos no denominador faria a taxa cair sempre que
    // entrassem leads novos — mediria volume de entrada, não eficácia.
    const fechados = ganhos + perdidos
    const taxaConversao = fechados > 0 ? Math.round((ganhos / fechados) * 100) : null

    return ok({
      novosLeads: {
        valor:    novosAtual,
        variacao: variacaoPercentual(novosAtual, novosSoAnterior),
      },
      negociosAbertos: { valor: abertos,  variacao: null },
      negociosGanhos:  { valor: ganhos,   variacao: null },
      negociosPerdidos:{ valor: perdidos, variacao: null },
      taxaConversao:   { valor: taxaConversao, variacao: null },
      valorGanho: {
        valor:    valorGanhoAtual,
        variacao: variacaoPercentual(valorGanhoAtual, valorSoAnterior),
      },
      // Deixa explícito para a UI que a organização ainda não tem movimento —
      // é diferente de "falhou ao carregar", e a tela precisa dizer qual dos
      // dois aconteceu.
      semDados: abertos + ganhos + perdidos === 0,
      crmIndisponivel: false,
      periodo:  { dias: days, de: inicio, ate: new Date(agora).toISOString() },
    })
  } catch (err) {
    // Módulo não instalado ≠ requisição com defeito. Responde 200 com a mesma
    // FORMA do corpo de sucesso — todos os campos presentes, valores nulos —
    // para que a UI não precise de um caminho de leitura separado só para este
    // caso. Um corpo de formato diferente aqui seria a próxima fonte de
    // "cannot read property 'valor' of undefined".
    if (ehSchemaNaoExposto(err)) {
      console.warn('[CRM metrics] schema crm não exposto; devolvendo indisponível', {
        hint: 'Supabase → Settings → API → Exposed schemas',
      })
      const vazio = { valor: null, variacao: null }
      return ok({
        novosLeads:       vazio,
        negociosAbertos:  vazio,
        negociosGanhos:   vazio,
        negociosPerdidos: vazio,
        taxaConversao:    vazio,
        valorGanho:       vazio,
        semDados:         false,
        crmIndisponivel:  true,
        periodo: null,
      })
    }

    return mapComercialError(err)
  }
}
