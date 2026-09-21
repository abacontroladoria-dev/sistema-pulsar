import { NextResponse, type NextRequest } from 'next/server'

import { segredoConfere } from '@/lib/central/webhook-signature'
import { supabaseService } from '@/lib/supabase/service'
import { processarAgrupamento } from '@/modules/atendimento/workers/agrupamento.worker'
import { processarEnvios } from '@/modules/atendimento/workers/envio.worker'
import { processarSentimento } from '@/modules/atendimento/workers/sentimento.worker'

// ============================================================================
// Tique dos workers — chamado pelo pg_cron a cada ~10 segundos
//
// POR QUE UMA ROTA NEXT E NÃO UMA EDGE FUNCTION
//
// O padrão do projeto para jobs é pg_cron → Edge Function. Aqui a Edge Function
// seria um salto a mais e um segundo lugar para configurar segredo, sem nada em
// troca: no caso da glosa, a função É quem chama o ClickUp; aqui a rota Next já
// é o destino final, porque é onde vivem os services, o orquestrador e o
// provider — reescrevê-los em Deno seria duplicar o módulo inteiro.
//
// TRÊS RESTRIÇÕES QUE MOLDAM ESTE ARQUIVO
//
// 1. `net.http_post` é ASSÍNCRONO E FIRE-AND-FORGET. O pg_cron enfileira em
//    net.http_request_queue e segue; ninguém lê esta resposta. Por isso o corpo
//    devolvido é para gente depurando, não para o cron decidir nada.
//
// 2. A ROTA PRECISA DE ORÇAMENTO DE TEMPO PRÓPRIO. Os workers param de
//    reivindicar antes de estourar; o que ficar pela metade é recuperado pelo
//    lease de 2 minutos das funções de claim.
//
// 3. DOIS TIQUES PODEM SE CRUZAR. Já é seguro: `claim_*_batch` usa
//    FOR UPDATE SKIP LOCKED. Não inventar lock global — ele criaria um ponto de
//    serialização que a fila foi desenhada para não precisar.
// ============================================================================

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Teto do handler. Fica acima da soma dos orçamentos dos dois workers (25s +
// 20s) só como rede de segurança — na prática eles param antes.
export const maxDuration = 60

export async function POST(req: NextRequest) {
  if (!segredoConfere(req.headers.get('x-worker-secret'), process.env.CENTRAL_WORKER_SECRET)) {
    // Sem corpo e sem detalhe. Esta rota faz a atendente falar com pacientes;
    // quem não tem o segredo não recebe pista nenhuma sobre o que faltou.
    return new NextResponse(null, { status: 401 })
  }

  const orgId = process.env.CENTRAL_ORGANIZATION_ID
  if (!orgId) {
    console.error('[worker tick] CENTRAL_ORGANIZATION_ID não configurado')
    return NextResponse.json({ ok: false, erro: 'organização não configurada' }, { status: 500 })
  }

  const inicio = Date.now()

  // Os dois em sequência, não em paralelo: o agrupamento ALIMENTA a fila de
  // envio, então rodá-lo primeiro faz a resposta gerada neste tique sair no
  // mesmo tique — economiza 10 segundos na percepção de quem espera.
  //
  // Cada um é isolado do outro: uma falha do agrupamento não pode impedir que
  // respostas JÁ GERADAS e pagas sejam entregues.
  const agrupamento = await tentar('agrupamento', () => processarAgrupamento(supabaseService, orgId))
  const envio = await tentar('envio', () => processarEnvios(supabaseService, orgId))

  // Por último, e nunca antes: a leitura de sentimento é para quem ATENDE, não
  // para quem espera resposta. Se o tique estourar o tempo, é esta que deve
  // ficar para o próximo — ela recalcula a mesma pergunta sobre o mesmo
  // material daqui a 10 segundos, enquanto uma resposta não entregue é uma
  // pessoa esperando no WhatsApp.
  //
  // O `tentar` importa mais aqui do que nos outros dois: sem ele, uma conta da
  // OpenAI sem crédito pararia a ENTREGA DE MENSAGENS por causa de um painel
  // informativo. O worker tem orçamento próprio e nunca lança.
  const sentimento = await tentar('sentimento', () => processarSentimento(supabaseService, orgId))

  return NextResponse.json({
    ok: true,
    duracaoMs: Date.now() - inicio,
    agrupamento,
    envio,
    sentimento,
  })
}

async function tentar<T>(nome: string, fn: () => Promise<T>): Promise<T | { erro: string }> {
  try {
    return await fn()
  } catch (err) {
    const erro = err instanceof Error ? err.message : String(err)
    console.error(`[worker tick] worker '${nome}' falhou`, erro)
    return { erro }
  }
}

// GET para diagnóstico manual: diz se o segredo confere, sem processar nada.
// Existe porque "o cron está chamando e nada acontece" tem duas causas muito
// diferentes — segredo errado ou fila vazia — e distinguir sem isso exige ler
// log de servidor.
export async function GET(req: NextRequest) {
  const autorizado = segredoConfere(
    req.headers.get('x-worker-secret'),
    process.env.CENTRAL_WORKER_SECRET,
  )
  if (!autorizado) return new NextResponse(null, { status: 401 })

  return NextResponse.json({
    ok: true,
    segredoConfere: true,
    organizacaoConfigurada: Boolean(process.env.CENTRAL_ORGANIZATION_ID),
    openAiConfigurada: Boolean(process.env.OPENAI_API_KEY),
    metaTokenConfigurado: Boolean(process.env.META_WABA_TOKEN),
  })
}
