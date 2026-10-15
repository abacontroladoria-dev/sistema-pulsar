import { NextResponse } from "next/server"
import {
  buscarPainelEntrada,
  buscarPrazos,
  lerAcessoPainelEntrada,
  respostaDeAcesso,
  SEM_PERMISSAO,
} from "@/services/indicadores/entradaConvenio"
import { aplicarPrazos, mapaDePrazos } from "@/lib/indicadores/entradaConvenio"

// GET /api/indicadores/entrada-convenio → { ok, instalado, podeAtualizar, painel }
//
// Painel de Entrada de Pacientes de Convênio: última rodada copiada do Doc do
// ClickUp + frescor + selo de disponibilidade por paciente. Lê com service_role,
// então a checagem de `indicadores_entrada_convenio` é aqui.
//
// Os prazos vigentes do Pulsar (tabela painel_entrada_convenio_prazos, editável
// por Direção e Admin) são aplicados sobre a rodada antes de responder: régua,
// meta e quem está dentro ou fora do prazo já saem daqui com eles. Sem a
// migration dos prazos, vale o que o calc gravou.
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
    // Falha ao ler os prazos não derruba o painel: cai nos prazos do calc.
    const [painel, prazos] = await Promise.all([
      buscarPainelEntrada(),
      buscarPrazos().catch(e => {
        console.error("[api/indicadores/entrada-convenio] falha ao ler os prazos", e instanceof Error ? e.message : e)
        return null
      }),
    ])
    if (painel) {
      painel.prazos = { instalado: prazos !== null, vigentes: prazos?.vigentes ?? [] }
      if (painel.snapshot && prazos && prazos.vigentes.length > 0) {
        painel.snapshot.dados = aplicarPrazos(painel.snapshot.dados, mapaDePrazos(prazos.vigentes))
      }
    }
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
