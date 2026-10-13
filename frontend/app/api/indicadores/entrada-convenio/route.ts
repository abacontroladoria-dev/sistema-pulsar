import { NextResponse } from "next/server"
import {
  buscarPainelEntrada,
  lerAcessoPainelEntrada,
  respostaDeAcesso,
  SEM_PERMISSAO,
} from "@/services/indicadores/entradaConvenio"

// GET /api/indicadores/entrada-convenio → { ok, instalado, podeAtualizar, painel }
//
// Painel de Entrada de Pacientes de Convênio: última rodada copiada do Doc do
// ClickUp + frescor + selo de disponibilidade por paciente. Lê com service_role,
// então a checagem de `indicadores_entrada_convenio` é aqui.
//
// Devolve nome do paciente, convênio, datas e pendências administrativas; nada
// clínico (a tarefa da Carol não grava dado clínico) nem os horários da
// disponibilidade (só o estado).
export const dynamic = "force-dynamic"

export async function GET() {
  let acesso
  try {
    acesso = await lerAcessoPainelEntrada()
  } catch (e) {
    const r = respostaDeAcesso(e)
    if (r.status === 500) console.error("[api/indicadores/entrada-convenio] falha ao verificar o acesso", e)
    return NextResponse.json(r.corpo, { status: r.status })
  }
  if (!acesso.ler) return NextResponse.json(SEM_PERMISSAO, { status: 403 })

  try {
    const painel = await buscarPainelEntrada()
    return NextResponse.json(
      { ok: true, instalado: painel !== null, podeAtualizar: acesso.atualizar, painel },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (e) {
    console.error("[api/indicadores/entrada-convenio] falha ao ler o painel", e instanceof Error ? e.message : e)
    return NextResponse.json(
      { ok: false, error: "falha_ao_ler_painel", mensagem: "Não foi possível ler o painel de entrada." },
      { status: 500 },
    )
  }
}
