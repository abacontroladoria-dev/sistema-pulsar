import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import { respostaDeErroAuth } from '@/lib/auditoria/auth'
import { exigirPermissaoPep } from '@/lib/pepDocumentos/auth'
import { despacharAuditoriaDocumentos } from '@/lib/pepDocumentos/despacho'
import { rotuloRegua } from '@/lib/pepDocumentos/ia'
import { reguasVigentes } from '@/lib/pepDocumentos/reguas'
import { precisaAuditar } from '@/lib/pepDocumentos/situacao'

// "Auditar" da tela Auditoria de Documentos PEP (15/10/2026).
//
//   POST { spIds }            põe na fila os que precisam (não auditados,
//                             falhos, ou auditados com regra/régua velha) e
//                             começa a processar. Qualquer um com acesso à tela.
//   POST { spIds, forcar }    audita de novo mesmo atualizado, inclusive a IA
//                             (até 50 documentos). Só RP e admin.
//   GET  ?lote=               progresso do lote (a tela pergunta a cada 5 s).
//   DELETE ?lote=             tira da fila o que ainda não começou.
//
// O proxy.ts não cobre /api: a permissão é conferida aqui.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ID_SP = /^[A-Za-z0-9!_.-]{1,200}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LOTE_IN = 150

async function autorizar() {
  try {
    return { ctx: await exigirPermissaoPep() }
  } catch (e) {
    const r = respostaDeErroAuth(e)
    if (r) return { erro: NextResponse.json({ error: r.error }, { status: r.status }) }
    throw e
  }
}

type DocFila = {
  sp_id: string
  extracao_status: string
  analise_status: string
  analise_versao: string | null
  ia_status: string | null
  ia_regua: string | null
  sp_pep_itens: { sigla: string | null } | null
}

export async function POST(req: NextRequest) {
  const a = await autorizar()
  if (a.erro) return a.erro
  const { ctx } = a

  const corpo = await req.json().catch(() => ({})) as { spIds?: unknown; forcar?: unknown }
  const forcar = corpo.forcar === true
  const spIds = (Array.isArray(corpo.spIds) ? corpo.spIds : [])
    .filter((x): x is string => typeof x === 'string' && ID_SP.test(x))
    .slice(0, forcar ? 50 : 2000)
  if (spIds.length === 0) return NextResponse.json({ error: 'Nenhum documento para auditar.' }, { status: 400 })

  if (forcar) {
    // Mesmo critério de escrita do PEP (rp/admin), conferido pelo banco.
    const { data: pode } = await ctx.supabase.rpc('sp_pep_pode_escrever')
    if (!pode) return NextResponse.json({ error: 'Só RP e administradores auditam de novo um documento já auditado.' }, { status: 403 })
  }

  const docs: DocFila[] = []
  for (let i = 0; i < spIds.length; i += LOTE_IN) {
    const { data, error } = await supabaseService.from('sp_pep_documentos')
      .select('sp_id, extracao_status, analise_status, analise_versao, ia_status, ia_regua, sp_pep_itens(sigla)')
      .in('sp_id', spIds.slice(i, i + LOTE_IN))
    if (error) return NextResponse.json({ error: 'Não foi possível ler os documentos.' }, { status: 500 })
    docs.push(...((data ?? []) as unknown as DocFila[]))
  }
  const reguas = await reguasVigentes(supabaseService)
  const reguaDe = (d: DocFila) => {
    const r = reguas.get((d.sp_pep_itens?.sigla ?? '').toUpperCase())
    return r ? rotuloRegua(r) : null
  }
  const elegiveis = docs
    .filter(d => forcar ? d.extracao_status === 'ok' && d.analise_status !== 'pendente' : precisaAuditar(d, reguaDe(d)))
    .map(d => d.sp_id)
  if (elegiveis.length === 0) return NextResponse.json({ lote: null, enfileirados: 0, ignorados: spIds.length })

  const lote = randomUUID()
  const agora = new Date().toISOString()
  let enfileirados = 0
  for (let i = 0; i < elegiveis.length; i += LOTE_IN) {
    const { data, error } = await supabaseService.from('sp_pep_documentos')
      .update({
        analise_status: 'pendente', analise_tentativas: 0, analise_erro: null,
        auditoria_lote: lote, auditoria_pedida_por_nome: ctx.usuarioNome, auditoria_pedida_em: agora,
        ...(forcar ? { ia_status: 'pendente', ia_tentativas: 0 } : {}),
      })
      .in('sp_id', elegiveis.slice(i, i + LOTE_IN))
      .neq('analise_status', 'pendente')
      .select('sp_id')
    if (error) return NextResponse.json({ error: 'Não foi possível pôr na fila.' }, { status: 500 })
    enfileirados += data?.length ?? 0
  }

  despacharAuditoriaDocumentos()
  return NextResponse.json({ lote, enfileirados, ignorados: spIds.length - enfileirados }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(req: NextRequest) {
  const a = await autorizar()
  if (a.erro) return a.erro
  const lote = req.nextUrl.searchParams.get('lote') ?? ''
  if (!UUID.test(lote)) return NextResponse.json({ error: 'Lote inválido.' }, { status: 400 })
  const { data, error } = await supabaseService.from('sp_pep_documentos')
    .select('analise_status').eq('auditoria_lote', lote)
  if (error) return NextResponse.json({ error: 'Não foi possível ler o progresso.' }, { status: 500 })
  const linhas = (data ?? []) as { analise_status: string }[]
  const conta = (s: string) => linhas.filter(l => l.analise_status === s).length
  return NextResponse.json({
    total: linhas.length,
    pendentes: conta('pendente'),
    feitos: conta('concluida'),
    falhas: conta('erro'),
    cancelados: conta('aguardando'),
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function DELETE(req: NextRequest) {
  const a = await autorizar()
  if (a.erro) return a.erro
  const lote = req.nextUrl.searchParams.get('lote') ?? ''
  if (!UUID.test(lote)) return NextResponse.json({ error: 'Lote inválido.' }, { status: 400 })
  // Só o que ainda não começou (sem reserva de quem está analisando).
  const { data, error } = await supabaseService.from('sp_pep_documentos')
    .update({ analise_status: 'aguardando' })
    .eq('auditoria_lote', lote).eq('analise_status', 'pendente').is('analise_reservada_em', null)
    .select('sp_id')
  if (error) return NextResponse.json({ error: 'Não foi possível cancelar.' }, { status: 500 })
  return NextResponse.json({ cancelados: data?.length ?? 0 })
}
