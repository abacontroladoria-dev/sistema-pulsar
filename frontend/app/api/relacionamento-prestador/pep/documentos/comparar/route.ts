import { NextResponse, type NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import { respostaDeErroAuth } from '@/lib/auditoria/auth'
import { exigirPermissaoPep } from '@/lib/pepDocumentos/auth'
import { modeloDaSigla } from '@/lib/pepDocumentos/analisar'
import { compararParagrafos } from '@/lib/pepDocumentos/semelhanca'

// Comparador lado a lado de dois documentos parecidos (o "Evolução duplicada
// entre pacientes" da PEP). O texto só sai daqui para um PAR QUE O SISTEMA JÁ
// SINALIZOU (sp_pep_documentos_semelhancas): a rota não serve para ler o
// texto de dois documentos quaisquer. Sem cache.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    await exigirPermissaoPep()
  } catch (e) {
    const r = respostaDeErroAuth(e)
    if (r) return NextResponse.json({ error: r.error }, { status: r.status })
    throw e
  }

  const p = req.nextUrl.searchParams
  const x = p.get('a') ?? '', y = p.get('b') ?? ''
  if (!x || !y || x === y) return NextResponse.json({ error: 'Informe os dois documentos.' }, { status: 400 })
  const [a, b] = x < y ? [x, y] : [y, x]

  const { data: par } = await supabaseService.from('sp_pep_documentos_semelhancas')
    .select('a_sp_id, b_sp_id, similaridade, tipo, relacao, nivel').eq('a_sp_id', a).eq('b_sp_id', b).maybeSingle()
  if (!par) return NextResponse.json({ error: 'Estes documentos não estão marcados como parecidos.' }, { status: 404 })

  const [{ data: textos }, { data: itens }] = await Promise.all([
    supabaseService.from('sp_pep_documentos_texto').select('sp_id, texto').in('sp_id', [a, b]),
    supabaseService.from('sp_pep_itens').select('sp_id, nome, sigla, competencia, prestador_nome, paciente_nome, web_url').in('sp_id', [a, b]),
  ])
  const texto = new Map((textos ?? []).map(t => [t.sp_id as string, t.texto as string]))
  const item = new Map((itens ?? []).map(i => [i.sp_id as string, i]))
  const cabecalho = (id: string) => {
    const i = item.get(id)
    return { sp_id: id, nome: i?.nome ?? null, sigla: i?.sigla ?? null, competencia: i?.competencia ?? null,
      prestador: i?.prestador_nome ?? null, paciente: i?.paciente_nome ?? null, web_url: i?.web_url ?? null }
  }

  const ta = texto.get(a), tb = texto.get(b)
  if (!ta || !tb) {
    return NextResponse.json({ par, expirado: true, a: cabecalho(a), b: cabecalho(b) }, { headers: { 'Cache-Control': 'no-store' } })
  }
  const modelo = await modeloDaSigla(supabaseService, (item.get(a)?.sigla as string | null) ?? '')
  return NextResponse.json({
    par, expirado: false,
    a: { ...cabecalho(a), paragrafos: compararParagrafos(ta, tb, modelo) },
    b: { ...cabecalho(b), paragrafos: compararParagrafos(tb, ta, modelo) },
  }, { headers: { 'Cache-Control': 'no-store' } })
}
