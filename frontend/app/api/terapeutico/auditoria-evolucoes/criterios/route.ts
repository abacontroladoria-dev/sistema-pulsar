import { NextResponse } from 'next/server'
import { exigirPermissaoAuditoria, respostaDeErroAuth } from '@/lib/auditoria/auth'
import { parseCriterios, CriteriosInvalidosError } from '@/lib/auditoria/criterios'

export const dynamic = 'force-dynamic'

/** Vigente + histórico, para o painel abrir já com tudo. */
export async function GET() {
  try {
    const { supabase } = await exigirPermissaoAuditoria()

    const { data, error } = await supabase
      .from('auditoria_criterios_versoes')
      .select('id, versao, conteudo, publicado_por, publicado_por_nome, publicado_em, nota_publicacao')
      .order('versao', { ascending: false })
      .limit(20)

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      vigente: data?.[0] ?? null,
      versoes: data ?? []
    })
  } catch (err: unknown) {
    const authErr = respostaDeErroAuth(err)
    if (authErr) {
      return NextResponse.json({ success: false, error: authErr.error }, { status: authErr.status })
    }
    const msg = err instanceof Error ? err.message : 'Erro interno'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

/**
 * Publica uma nova versão dos critérios.
 *
 * Não há UPDATE nem DELETE — a tabela é append-only (trigger no banco).
 * "Corrigir" um erro é publicar outra versão; "voltar atrás" é publicar o
 * conteúdo de uma versão antiga. O histórico nunca perde um degrau, que é o
 * que permite explicar, meses depois, sob qual régua uma evolução foi julgada.
 */
export async function POST(req: Request) {
  try {
    const { supabase, usuarioId, usuarioNome } = await exigirPermissaoAuditoria()

    const body = await req.json()

    // Valida ANTES de gravar: chave de pilar inventada, 5ª pergunta, status
    // fora do trio ou campo vazio são recusados aqui. O que passa daqui é
    // garantidamente montável em prompt e compatível com o parser.
    let conteudo
    try {
      conteudo = parseCriterios(body?.conteudo)
    } catch (e) {
      if (e instanceof CriteriosInvalidosError) {
        return NextResponse.json({ success: false, error: e.message }, { status: 400 })
      }
      throw e
    }

    const nota = typeof body?.nota_publicacao === 'string' ? body.nota_publicacao.trim() : ''
    if (!nota) {
      return NextResponse.json(
        { success: false, error: 'Descreva o que mudou — essa nota fica no histórico.' },
        { status: 400 }
      )
    }

    // Duas pessoas publicando ao mesmo tempo colidem no unique(versao). Uma
    // tentativa extra resolve o caso comum (a segunda pega o número seguinte);
    // persistindo, é melhor mandar recarregar do que sobrescrever decisão alheia.
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const { data: ultima } = await supabase
        .from('auditoria_criterios_versoes')
        .select('versao')
        .order('versao', { ascending: false })
        .limit(1)
        .maybeSingle()

      const proximaVersao = (ultima?.versao ?? 0) + 1

      const { data: criada, error: erroInsert } = await supabase
        .from('auditoria_criterios_versoes')
        .insert({
          versao: proximaVersao,
          conteudo,
          publicado_por: usuarioId,
          publicado_por_nome: usuarioNome,
          nota_publicacao: nota
        })
        .select('id, versao, publicado_por_nome, publicado_em, nota_publicacao')
        .single()

      if (!erroInsert) {
        return NextResponse.json({ success: true, versao: criada })
      }

      if (erroInsert.code !== '23505') {
        return NextResponse.json({ success: false, error: erroInsert.message }, { status: 500 })
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Alguém publicou uma versão enquanto você editava. Recarregue e refaça a alteração.'
      },
      { status: 409 }
    )
  } catch (err: unknown) {
    const authErr = respostaDeErroAuth(err)
    if (authErr) {
      return NextResponse.json({ success: false, error: authErr.error }, { status: authErr.status })
    }
    const msg = err instanceof Error ? err.message : 'Erro interno'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
