import { NextResponse } from "next/server"
import { supabaseService } from "@/lib/supabase/service"
import { conferirAcesso, respostaDeErroDoBanco } from "@/lib/exportarEvolucoes/servidor"

// POST /api/exportar-evolucoes/conteudo
//   { chaves: string[] (até 500), finalidade: "visualizacao" | "pdf" | "csv" }
//   → { itens: EvolucaoConteudo[] }
//
// Devolve o texto clínico e grava, na mesma transação, quem leu, quando e para
// quê (exportar_evolucoes_registro). Quem pede é o usuário da sessão, nunca um
// nome vindo do navegador.
export const dynamic = "force-dynamic"

const FINALIDADES = new Set(["visualizacao", "pdf", "csv"])
const MAX_CHAVES = 500

export async function POST(request: Request) {
  const acesso = await conferirAcesso("conteudo")
  if (acesso instanceof NextResponse) return acesso

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const finalidade = body?.finalidade
  if (typeof finalidade !== "string" || !FINALIDADES.has(finalidade)) {
    return NextResponse.json({ error: "Finalidade inválida." }, { status: 400 })
  }
  const chaves = Array.isArray(body?.chaves)
    ? [...new Set(body.chaves.filter((v): v is string => typeof v === "string" && v.length <= 60))]
    : []
  if (chaves.length === 0) return NextResponse.json({ itens: [] })
  if (chaves.length > MAX_CHAVES) {
    return NextResponse.json({ error: `No máximo ${MAX_CHAVES} evoluções por pedido.` }, { status: 400 })
  }

  const { data, error } = await supabaseService.rpc("exportar_evolucoes_conteudo", {
    p_chaves: chaves,
    p_usuario_id: acesso.usuarioId,
    p_usuario_nome: acesso.usuarioNome,
    p_finalidade: finalidade,
  })
  if (error) return respostaDeErroDoBanco("conteudo", error)

  return NextResponse.json({ itens: Array.isArray(data) ? data : [] })
}
