import { NextResponse, type NextRequest } from 'next/server'
import { segredoConfere } from '@/lib/central/webhook-signature'
import { supabaseService } from '@/lib/supabase/service'
import { processarFilaReauditoria } from '@/lib/auditoria/filaReauditoria'

// Tique da fila de reauditoria — chamado pelo pg_cron a cada minuto
// (fn_auditoria_worker_tick), com o segredo do Vault. Molde:
// app/api/central/workers/tick/route.ts. A resposta é para quem depura; o
// net.http_post é fire-and-forget e ninguém a lê.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  if (!segredoConfere(req.headers.get('x-worker-secret'), process.env.AUDITORIA_WORKER_SECRET)) {
    return new NextResponse(null, { status: 401 })
  }
  try {
    const resultado = await processarFilaReauditoria(supabaseService)
    return NextResponse.json({ ok: true, ...resultado })
  } catch (err) {
    const erro = err instanceof Error ? err.message : String(err)
    console.error('[tique reauditoria] falhou', erro)
    return NextResponse.json({ ok: false, erro }, { status: 500 })
  }
}

// Diagnóstico: "o cron chama e nada acontece" é segredo errado ou fila vazia.
export async function GET(req: NextRequest) {
  if (!segredoConfere(req.headers.get('x-worker-secret'), process.env.AUDITORIA_WORKER_SECRET)) {
    return new NextResponse(null, { status: 401 })
  }
  const { data, error } = await supabaseService.rpc('resumo_fila_reauditoria')
  return NextResponse.json({
    ok: !error,
    segredoConfere: true,
    openAiConfigurada: Boolean(process.env.OPENAI_API_KEY),
    fila: data ?? null,
    erro: error?.message ?? null
  })
}
