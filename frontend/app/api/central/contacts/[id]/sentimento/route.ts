import type { NextRequest }  from 'next/server'
import { extractUser }       from '@/lib/central/auth'
import { mapCentralError }   from '@/lib/central/errors'
import { ok, unprocessable } from '@/lib/central/response'
import { createSentimentoService } from '@/modules/atendimento/services'
import { ContactRepository } from '@/modules/atendimento/repositories/contact.repository'
import { ContactNotFoundError } from '@/modules/atendimento/types/errors.types'

type Ctx = { params: Promise<{ id: string }> }

// ============================================================================
// A leitura de sentimento de um contato.
//
// GET  — devolve o que já existe. NUNCA chama o modelo: esta rota é carregada
//        toda vez que alguém abre uma conversa no inbox, e analisar aqui faria
//        abrir a tela custar dinheiro.
// POST — força uma leitura nova (botão "Reanalisar").
//
// A separação é o contrato: uma rota que lê é grátis, uma rota que escreve
// custa, e quem chama sabe qual é qual pelo verbo.
// ============================================================================

export async function GET(_request: NextRequest, ctx: Ctx) {
  try {
    const { user, supabase } = await extractUser()
    const { id } = await ctx.params

    const service = createSentimentoService(supabase)
    const leitura = await service.buscar(user.orgId, id)

    // Sem 404 quando não há leitura: "esta pessoa nunca foi analisada" é uma
    // resposta legítima e o painel a desenha como estado vazio. 404 ali faria o
    // hook tratar ausência de leitura como falha de rota.
    return ok(leitura)
  } catch (err) {
    return mapCentralError(err)
  }
}

// POST /api/central/contacts/[id]/sentimento
//
// Sempre `triggered_by: 'manual'` — quem chega aqui clicou num botão. O caminho
// automático não passa por HTTP; ele roda dentro do tique do worker.
//
// Não há corpo: não há nada que o cliente possa parametrizar. Janela, mínimo de
// mensagens e prompt são decisões do servidor, e aceitá-las do corpo deixaria o
// custo de uma chamada ao modelo ser escolhido por quem chama.
export async function POST(_request: NextRequest, ctx: Ctx) {
  try {
    const { user, supabase } = await extractUser()
    const { id } = await ctx.params

    // O contato é lido antes por duas razões. O nome entra no prompt; e a
    // checagem converte "id de outra organização" em 404 ANTES de qualquer
    // chamada paga — sem ela, a RLS barraria só no INSERT, depois de o modelo
    // já ter respondido e a chamada já ter sido cobrada.
    const contato = await new ContactRepository(supabase).findById(id)
    if (!contato || contato.organization_id !== user.orgId) {
      throw new ContactNotFoundError(id)
    }

    const service  = createSentimentoService(supabase)
    const desfecho = await service.analisar(user.orgId, id, 'manual', contato.name, user.id)

    // 422: o pedido está correto, mas não há material para ler. Repetir agora
    // dá o mesmo resultado — só mais conversa resolve. Devolver 200 com corpo
    // vazio faria o painel mostrar "analisado" sobre uma análise que não houve.
    if (desfecho.tipo === 'material_insuficiente') {
      return unprocessable(
        'SENTIMENT_MATERIAL_INSUFICIENTE',
        `Ainda não há conversa suficiente para ler o sentimento (${desfecho.detalhe}).`,
      )
    }

    return ok(desfecho.leitura)
  } catch (err) {
    return mapCentralError(err)
  }
}
