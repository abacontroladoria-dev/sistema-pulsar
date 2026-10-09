import { NextResponse } from "next/server"
import { buscarStatusContratos } from "@/services/contratos/status"
import { lerAcessoContratos, respostaDeAcesso, SEM_PERMISSAO } from "@/services/contratos/acesso"

// GET /api/status-contratos/ → { ok, itens, meta }
//
// Roda com service_role (a grade do TiTa só a service_role lê, e quem tem só
// `status_contratos` não lê `pacientes` pela RLS), então a checagem de acesso é
// AQUI: `status_contratos` ou `cadastros_pacientes`; sem nenhum, 403.
//
// Devolve nome do paciente, convênio e o andamento dos contratos — nada de CPF,
// telefone ou responsável. O PDF não sai por aqui.
//
// A vigência depende de `hoje`: nunca pode ser assada no build.
export const dynamic = "force-dynamic"

export async function GET() {
  let acesso
  try {
    acesso = await lerAcessoContratos()
  } catch (e) {
    const r = respostaDeAcesso(e)
    if (r.status === 500) console.error("[api/status-contratos] falha ao verificar o acesso", e)
    return NextResponse.json(r.corpo, { status: r.status })
  }
  if (!acesso.ler) return NextResponse.json(SEM_PERMISSAO, { status: 403 })

  try {
    const { itens, meta } = await buscarStatusContratos()
    return NextResponse.json({ ok: true, itens, meta }, { headers: { "Cache-Control": "no-store" } })
  } catch (e) {
    console.error("[api/status-contratos] falha ao montar a lista", e instanceof Error ? e.message : e)
    return NextResponse.json(
      { ok: false, error: "falha_ao_ler_status_contratos", mensagem: "Não foi possível montar a lista de contratos." },
      { status: 500 },
    )
  }
}
