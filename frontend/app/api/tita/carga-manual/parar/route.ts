import { NextResponse } from "next/server"
import { exigirPermissao, respostaDeAcessoRecusado } from "@/lib/permissions/exigirPermissao"
import { supabaseService } from "@/lib/supabase/service"

// "Parar" da carga em curso. Só marca o pedido: a carga para no fim do passo
// em que está (uma gravação em andamento termina) e não começa a etapa
// seguinte. Na espera pela releitura do TiTa, para em até 15 s.

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    await exigirPermissao("carregar_tita")
  } catch (e) {
    const r = respostaDeAcessoRecusado(e)
    if (r) return r
    throw e
  }
  const { id } = (await req.json().catch(() => ({}))) as { id?: string }
  if (!id) return NextResponse.json({ ok: false, mensagem: "Carga não informada." }, { status: 400 })

  const { data, error } = await supabaseService
    .from("tita_cargas")
    .update({ parar_pedido_em: new Date().toISOString() })
    .eq("id", id)
    .eq("situacao", "rodando")
    .select("id")
  if (error) {
    console.error("[carga-manual/parar]", error.message)
    return NextResponse.json({ ok: false, mensagem: "Não foi possível pedir a parada." }, { status: 500 })
  }
  if (!data?.length) return NextResponse.json({ ok: false, mensagem: "Esta carga já terminou." }, { status: 409 })
  return NextResponse.json({ ok: true })
}
