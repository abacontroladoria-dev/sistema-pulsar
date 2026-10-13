import { NextResponse } from "next/server"
import {
  atualizarPainelEntrada,
  lerAcessoPainelEntrada,
  respostaDeAcesso,
  SEM_PERMISSAO,
} from "@/services/indicadores/entradaConvenio"

// POST /api/indicadores/entrada-convenio/atualizar → { ok, resultado }
//
// Copia o Doc do ClickUp agora, sem esperar a rotina das 7h55/12h55. Só admin e
// diretoria. O resultado é o resumo da Edge Function (novo, sem_mudanca,
// ignorado ou erro com o motivo).
export const dynamic = "force-dynamic"

export async function POST() {
  let acesso
  try {
    acesso = await lerAcessoPainelEntrada()
  } catch (e) {
    const r = respostaDeAcesso(e)
    if (r.status === 500) console.error("[api/indicadores/entrada-convenio/atualizar] falha ao verificar o acesso", e)
    return NextResponse.json(r.corpo, { status: r.status })
  }
  if (!acesso.ler || !acesso.atualizar) return NextResponse.json(SEM_PERMISSAO, { status: 403 })

  try {
    const resultado = await atualizarPainelEntrada()
    return NextResponse.json({ ok: true, resultado }, { headers: { "Cache-Control": "no-store" } })
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e)
    console.error("[api/indicadores/entrada-convenio/atualizar]", mensagem)
    return NextResponse.json({ ok: false, error: "falha_ao_atualizar", mensagem }, { status: 502 })
  }
}
