import { NextResponse, type NextRequest } from 'next/server'

import { segredoConfere } from '@/lib/central/webhook-signature'
import { supabaseService } from '@/lib/supabase/service'
import { normalizarWebhookEvolution } from '@/modules/atendimento/providers/evolution.normalizar'
import { processarEventoEvolution, type CanalEvolution } from '@/modules/atendimento/evolution/ingestao'

// ============================================================================
// Webhook da Evolution API (números de atendimento humano)
//
// AUTENTICAÇÃO
//
// A Evolution não assina o corpo como a Meta. A prova de origem é um segredo
// aleatório POR INSTÂNCIA, gerado quando o número é criado e posto na URL que a
// própria Pulsar configura na Evolution. A rota só aceita quando o par
// (instância do corpo, segredo da URL) confere com o que está em
// `channel_connections.provider_metadata.webhook_secret`, comparado em tempo
// constante. Instância desconhecida e segredo errado respondem o MESMO 401 —
// quem erra não precisa saber o que errou.
//
// Sem isso, qualquer um que descobrisse a URL injetaria mensagens falsas numa
// conversa real. Era exatamente o defeito do app de referência (evo-talk-store).
//
// A Maia não entra aqui: não há fila de debounce nem turno de IA. A mensagem vai
// direto para a conversa (modules/atendimento/evolution/ingestao.ts).
// ============================================================================

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ secret: string }> }

interface ConexaoEncontrada {
  organization_id: string
  channel_id: string
  provider_metadata: { webhook_secret?: unknown } | null
  channels: { id: string; inbox_id: string; provider: string } | null
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { secret } = await ctx.params

  let payload: { event?: string; instance?: string }
  try {
    payload = (await req.json()) as { event?: string; instance?: string }
  } catch {
    return new NextResponse(null, { status: 400 })
  }

  const instance = typeof payload.instance === 'string' ? payload.instance : ''
  if (!instance) return new NextResponse(null, { status: 401 })

  const { data, error } = await supabaseService
    .schema('central')
    .from('channel_connections')
    .select('organization_id, channel_id, provider_metadata, channels!inner(id, inbox_id, provider)')
    .eq('provider_instance_id', instance)
    .maybeSingle()

  if (error) {
    console.error('[webhook evolution] falha ao buscar a instância', error)
    return NextResponse.json({ ok: false }, { status: 503 })
  }

  const conexao = data as ConexaoEncontrada | null
  const esperado = conexao?.provider_metadata?.webhook_secret
  if (
    !conexao
    || conexao.channels?.provider !== 'evolution'
    || typeof esperado !== 'string'
    || !segredoConfere(secret, esperado)
  ) {
    console.warn('[webhook evolution] instância ou segredo não conferem', { instance })
    return new NextResponse(null, { status: 401 })
  }

  const canal: CanalEvolution = {
    organization_id: conexao.organization_id,
    channel_id: conexao.channel_id,
    inbox_id: conexao.channels.inbox_id,
  }

  const { data: log } = await supabaseService
    .schema('central')
    .from('provider_webhook_logs')
    .insert({
      organization_id: canal.organization_id,
      provider: 'evolution',
      instance,
      event_type: payload.event ?? null,
      payload,
    })
    .select('id')
    .maybeSingle()
  const logId = (log as { id?: number } | null)?.id

  const eventos = normalizarWebhookEvolution(payload)
  const ignorados = eventos.flatMap(e => (e.tipo === 'ignorado' ? [e.motivo] : []))

  try {
    for (const evento of eventos) {
      await processarEventoEvolution(supabaseService, canal, evento)
    }
  } catch (err) {
    const motivo = err instanceof Error ? err.message : JSON.stringify(err)
    console.error('[webhook evolution] falha ao processar', { instance, event: payload.event, motivo })
    if (logId) {
      await supabaseService.schema('central').from('provider_webhook_logs')
        .update({ error_message: motivo.slice(0, 1000) }).eq('id', logId)
    }
    // 5xx: a mensagem ainda não está guardada, e a reentrega é a segunda chance.
    return NextResponse.json({ ok: false }, { status: 503 })
  }

  if (logId) {
    await supabaseService.schema('central').from('provider_webhook_logs')
      .update({
        processed: true,
        ...(ignorados.length ? { error_message: `ignorado: ${ignorados.join('; ')}`.slice(0, 1000) } : {}),
      })
      .eq('id', logId)
  }

  return NextResponse.json({ ok: true, eventos: eventos.length, ignorados: ignorados.length })
}
