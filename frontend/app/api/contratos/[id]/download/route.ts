import { NextResponse } from "next/server"
import { supabaseService } from "@/lib/supabase/service"
import { lerAcessoContratos, respostaDeAcesso, SEM_PERMISSAO } from "@/services/contratos/acesso"
import { BUCKET_CONTRATOS, VALIDADE_URL_S } from "@/services/contratos/arquivo"

// GET /api/contratos/[id]/download/?qual=original|assinado → { ok, url }
//
// URL assinada de 5 minutos para o PDF do contrato. O caminho sai da LINHA do
// contrato (gravada só pela RPC de service_role), nunca da requisição — senão
// bastaria trocar o caminho na URL para baixar o contrato de outro paciente.
//
// Exige `cadastros_pacientes`: quem só acompanha a Status Contratos vê o
// andamento, não o documento.

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  let acesso
  try {
    acesso = await lerAcessoContratos()
  } catch (e) {
    const r = respostaDeAcesso(e)
    if (r.status === 500) console.error("[api/contratos/download] falha ao verificar o acesso", e)
    return NextResponse.json(r.corpo, { status: r.status })
  }
  if (!acesso.editar) return NextResponse.json(SEM_PERMISSAO, { status: 403 })

  const { id: idTexto } = await ctx.params
  const id = Number(idTexto)
  const qual = new URL(req.url).searchParams.get("qual")
  if (!Number.isInteger(id) || id <= 0 || (qual !== "original" && qual !== "assinado")) {
    return NextResponse.json({ ok: false, error: "parametro_invalido", mensagem: "Pedido inválido." }, { status: 400 })
  }

  const { data: contrato, error } = await supabaseService
    .from("pacientes_contratos")
    .select("arquivo_original_path, arquivo_assinado_path")
    .eq("id", id)
    .eq("ativo", true)
    .maybeSingle()
  if (error) {
    console.error("[api/contratos/download] falha ao ler o contrato", error.code)
    return NextResponse.json({ ok: false, error: "falha_leitura", mensagem: "Não foi possível ler o contrato." }, { status: 500 })
  }
  const caminho = qual === "original" ? contrato?.arquivo_original_path : contrato?.arquivo_assinado_path
  if (!caminho) {
    return NextResponse.json({ ok: false, error: "sem_arquivo", mensagem: "Este contrato não tem esse PDF." }, { status: 404 })
  }

  const { data: assinada, error: erroUrl } = await supabaseService.storage
    .from(BUCKET_CONTRATOS)
    .createSignedUrl(caminho, VALIDADE_URL_S)
  if (erroUrl || !assinada?.signedUrl) {
    console.error("[api/contratos/download] falha ao assinar a URL", erroUrl?.message)
    return NextResponse.json({ ok: false, error: "falha_url", mensagem: "Não foi possível abrir o PDF." }, { status: 500 })
  }

  return NextResponse.json({ ok: true, url: assinada.signedUrl }, { headers: { "Cache-Control": "no-store" } })
}
