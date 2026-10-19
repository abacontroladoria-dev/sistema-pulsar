import { NextResponse } from 'next/server'
import { exigirPermissaoAuditoria, respostaDeErroAuth } from '@/lib/auditoria/auth'
import { supabaseService } from '@/lib/supabase/service'
import { buscarGradeAuditoriaPaginada, buscarGradeAuditoriaPorIds } from '@/lib/auditoria/gradeAuditoria'

// POST /api/terapeutico/auditoria-evolucoes/grade → { linhas } | { erro }
//
// Sessões com o texto da evolução para a tela de Auditoria de Evoluções. Antes
// o navegador lia csv_grades_profissionais.descricao_evolucao direto — e com
// ele qualquer login. Agora só esta rota lê, com o cliente de serviço, depois
// de conferir a permissão da tela.
//
// Corpo:
//   { dataInicio, dataFim?, profissionalId?, unidadeId? }        → período inteiro
//   { ids: string[], profissionalId?, unidadeId? }               → só essas sessões
export const dynamic = 'force-dynamic'

/** Teto de ids por chamada (o filtro de risco parte de centenas de auditorias). */
const MAX_IDS = 20_000

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f-]{36}$/i

function numeroOuNulo(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN
  return Number.isInteger(n) ? n : null
}

export async function POST(req: Request) {
  try {
    await exigirPermissaoAuditoria()
  } catch (e) {
    const authErr = respostaDeErroAuth(e)
    if (authErr) return NextResponse.json({ erro: authErr.error }, { status: authErr.status })
    console.error('[auditoria-evolucoes/grade] falha ao verificar o acesso', e)
    return NextResponse.json({ erro: 'Falha ao verificar o acesso' }, { status: 500 })
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ erro: 'Corpo inválido' }, { status: 400 })

  const profissionalId = numeroOuNulo(body.profissionalId)
  const unidadeId = numeroOuNulo(body.unidadeId)

  try {
    if (Array.isArray(body.ids)) {
      const ids = body.ids.filter((id): id is string => typeof id === 'string' && UUID.test(id))
      if (ids.length > MAX_IDS) return NextResponse.json({ erro: 'Ids demais' }, { status: 400 })
      const r = await buscarGradeAuditoriaPorIds(supabaseService, ids, { profissionalId, unidadeId })
      return NextResponse.json(r, { status: 'erro' in r ? 500 : 200 })
    }

    const dataInicio = typeof body.dataInicio === 'string' && DATA_ISO.test(body.dataInicio) ? body.dataInicio : null
    const dataFim = typeof body.dataFim === 'string' && DATA_ISO.test(body.dataFim) ? body.dataFim : null
    if (!dataInicio) return NextResponse.json({ erro: 'dataInicio obrigatória (AAAA-MM-DD)' }, { status: 400 })

    const r = await buscarGradeAuditoriaPaginada(supabaseService, { dataInicio, dataFim, profissionalId, unidadeId })
    return NextResponse.json(r, { status: 'erro' in r ? 500 : 200 })
  } catch (e) {
    console.error('[auditoria-evolucoes/grade] falha ao ler a grade', e)
    return NextResponse.json({ erro: 'Erro ao buscar grade' }, { status: 500 })
  }
}
