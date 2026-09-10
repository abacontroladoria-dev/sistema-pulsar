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
      periodo:  { dias: days, de: inicio, ate: new Date(agora).toISOString() },
    })
  } catch (err) {
    return mapComercialError(err)
  }
}
