import { NextResponse } from "next/server"
import { supabaseService } from "@/lib/supabase/service"
import { conferirAcesso, dataValida, respostaDeErroDoBanco } from "@/lib/exportarEvolucoes/servidor"

// POST /api/exportar-evolucoes/listar
//   { de: "AAAA-MM-DD", ate: "AAAA-MM-DD", pacienteIds?: number[], terapias?: string[] }
//   → { itens: EvolucaoItem[] }
//
// Os cards SEM o texto clínico (o texto só trafega pela rota /conteudo, que
// registra quem leu). Período de até 12 meses — a função do banco recusa acima.
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const acesso = await conferirAcesso("listar")
  if (acesso instanceof NextResponse) return acesso

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const de = body?.de
  const ate = body?.ate
  if (!dataValida(de) || !dataValida(ate)) {
    return NextResponse.json({ error: "Informe o período." }, { status: 400 })
  }
  const pacienteIds = Array.isArray(body?.pacienteIds)
    ? body.pacienteIds.filter((v): v is number => Number.isSafeInteger(v))
    : []
  const terapias = Array.isArray(body?.terapias)
    ? body.terapias.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 200)
    : []

  const { data, error } = await supabaseService.rpc("exportar_evolucoes_listar", {
    p_de: de,
    p_ate: ate,
    p_paciente_ids: pacienteIds.length ? pacienteIds : null,
    p_terapias: terapias.length ? terapias : null,
  })
  if (error) return respostaDeErroDoBanco("listar", error)

  return NextResponse.json({ itens: Array.isArray(data) ? data : [] })
}
