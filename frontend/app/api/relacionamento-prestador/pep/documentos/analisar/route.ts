import { NextResponse, type NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import { respostaDeErroAuth } from '@/lib/auditoria/auth'
import { exigirPermissaoPep } from '@/lib/pepDocumentos/auth'
import { analisarDocumentosPep } from '@/lib/pepDocumentos/analisar'

// Conferência do conteúdo dos documentos da PEP, sob demanda: a tela chama ao
// abrir um analista que tem documentos esperando análise (o tique do worker
// faz o mesmo em segundo plano). Só analisa o que está PENDENTE — chamar de
// novo não gasta IA de novo.
//
// { spIds }               → analisa os pendentes entre estes
// { reanalisar: spId }    → volta o documento para a fila e analisa (rp/admin)

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await exigirPermissaoPep()
  } catch (e) {
    const r = respostaDeErroAuth(e)
    if (r) return NextResponse.json({ error: r.error }, { status: r.status })
    throw e
  }

  const corpo = await req.json().catch(() => ({})) as { spIds?: unknown; reanalisar?: unknown }
  const spIds = Array.isArray(corpo.spIds) ? corpo.spIds.filter((x): x is string => typeof x === 'string').slice(0, 500) : []

  if (typeof corpo.reanalisar === 'string') {
    // Mesmo critério de escrita do PEP (rp/admin), conferido pelo banco.
    const { data: pode } = await ctx.supabase.rpc('sp_pep_pode_escrever')
    if (!pode) return NextResponse.json({ error: 'Sem permissão para reanalisar' }, { status: 403 })
    const { data: tem } = await supabaseService.from('sp_pep_documentos_texto').select('sp_id').eq('sp_id', corpo.reanalisar).maybeSingle()
    if (!tem) return NextResponse.json({ error: 'O texto deste documento já expirou (90 dias): não dá para reanalisar.' }, { status: 409 })
    await supabaseService.from('sp_pep_documentos')
      .update({ analise_status: 'pendente', ia_status: 'pendente', ia_tentativas: 0, analise_tentativas: 0 })
      .eq('sp_id', corpo.reanalisar)
    spIds.splice(0, spIds.length, corpo.reanalisar)
  }

  if (spIds.length === 0) return NextResponse.json({ analisados: 0, restantes: false })
  try {
    const r = await analisarDocumentosPep(supabaseService, { spIds, limite: 12, orcamentoMs: 40_000 })
    return NextResponse.json(r, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[pep documentos] análise falhou', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'A análise falhou. Tente de novo em instantes.' }, { status: 500 })
  }
}
