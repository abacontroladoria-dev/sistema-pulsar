import { NextResponse } from 'next/server'
import { exigirPermissaoAuditoria, respostaDeErroAuth } from '@/lib/auditoria/auth'
import { supabaseService } from '@/lib/supabase/service'
import { despacharFilaReauditoria } from '@/lib/auditoria/filaReauditoria'

// Fila da reauditoria em massa. A permissão é conferida aqui; a fila em si só
// aceita service_role (RLS sem policy e EXECUTE revogado), então é daqui que
// sai o acesso — nunca direto do navegador.

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_POR_PEDIDO = 5000

function erro(e: unknown) {
  const auth = respostaDeErroAuth(e)
  if (auth) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  const msg = e instanceof Error ? e.message : 'Erro interno no servidor'
  return NextResponse.json({ success: false, error: msg }, { status: 500 })
}

async function resumo() {
  const { data, error } = await supabaseService.rpc('resumo_fila_reauditoria')
  if (error) throw new Error(error.message)
  return data
}

/** Progresso: tudo o que está em andamento, ou o último lote. */
export async function GET() {
  try {
    await exigirPermissaoAuditoria()
    return NextResponse.json({ success: true, resumo: await resumo() })
  } catch (e) {
    return erro(e)
  }
}

/**
 * Enfileira `{ gradeIds }` ou repete as falhas de `{ repetirFalhasDosLotes }`.
 *
 * A lista vem da tela, e não é recalculada aqui, de propósito: o botão anuncia
 * "Reauditar N" sobre o recorte filtrado que a pessoa está vendo. Recalcular no
 * servidor ignoraria a busca e o período, e o número do botão mentiria.
 */
export async function POST(req: Request) {
  try {
    const { usuarioId, usuarioNome } = await exigirPermissaoAuditoria()
    const body = await req.json()

    if (Array.isArray(body.repetirFalhasDosLotes)) {
      const lotes = body.repetirFalhasDosLotes.filter((l: unknown) => typeof l === 'string' && UUID.test(l))
      const { data, error } = await supabaseService.rpc('repetir_falhas_reauditoria', { p_lotes: lotes })
      if (error) throw new Error(error.message)
      despacharFilaReauditoria()
      return NextResponse.json({ success: true, repetidas: data, resumo: await resumo() })
    }

    const ids: string[] = Array.isArray(body.gradeIds)
      ? body.gradeIds.filter((id: unknown) => typeof id === 'string' && UUID.test(id))
      : []
    if (ids.length === 0) {
      return NextResponse.json({ success: false, error: 'Nenhuma evolução informada.' }, { status: 400 })
    }
    if (ids.length > MAX_POR_PEDIDO) {
      return NextResponse.json(
        { success: false, error: `No máximo ${MAX_POR_PEDIDO} evoluções por vez.` },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseService.rpc('enfileirar_reauditoria', {
      p_grade_ids: ids,
      p_usuario_id: usuarioId,
      p_usuario_nome: usuarioNome
    })
    if (error) throw new Error(error.message)
    const linha = Array.isArray(data) ? data[0] : data

    despacharFilaReauditoria()
    return NextResponse.json({
      success: true,
      enfileirados: linha?.enfileirados ?? 0,
      jaNaFila: linha?.ja_na_fila ?? 0,
      resumo: await resumo()
    })
  } catch (e) {
    return erro(e)
  }
}

/** Cancela o que ainda não começou. O que já está com a IA termina. */
export async function DELETE() {
  try {
    await exigirPermissaoAuditoria()
    const { data, error } = await supabaseService.rpc('cancelar_reauditoria')
    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true, cancelados: data, resumo: await resumo() })
  } catch (e) {
    return erro(e)
  }
}
