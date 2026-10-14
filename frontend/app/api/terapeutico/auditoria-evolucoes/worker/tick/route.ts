import { NextResponse, type NextRequest } from 'next/server'
import { segredoConfere } from '@/lib/central/webhook-signature'
import { supabaseService } from '@/lib/supabase/service'
import { processarFilaReauditoria } from '@/lib/auditoria/filaReauditoria'
import { analisarDocumentosPep } from '@/lib/pepDocumentos/analisar'

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
    const inicio = Date.now()
    const resultado = await processarFilaReauditoria(supabaseService)
    // Auditoria de Documentos PEP (20261015100000): rede de segurança do
    // despacho da tela. Só pega o que alguém mandou auditar ('pendente');
    // documento recém-lido fica 'aguardando' e não entra. Falha aqui não
    // derruba a fila da auditoria de evoluções.
    let documentosPep: unknown = null
    const sobra = 50_000 - (Date.now() - inicio)
    if (sobra > 8_000) {
      try {
        documentosPep = await analisarDocumentosPep(supabaseService, { limite: 9, orcamentoMs: Math.min(sobra - 5_000, 25_000) })
      } catch (e) {
        documentosPep = { erro: e instanceof Error ? e.message.slice(0, 200) : 'falhou' }
        console.error('[tique] auditoria de documentos PEP falhou', documentosPep)
      }
    }
    return NextResponse.json({ ok: true, ...resultado, documentosPep })
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
