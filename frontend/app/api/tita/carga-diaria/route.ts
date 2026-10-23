import { timingSafeEqual } from "crypto"
import { after, NextResponse } from "next/server"
import { supabaseService } from "@/lib/supabase/service"
import { encerrarCargasAbandonadas, executarCargaTita } from "@/services/tita/cargaTita.server"

// Rotina diária das 04:00 (Brasília): "Carregar o Pulsar segundo o TiTa" sem
// ninguém clicar. Chamada pelo pg_cron (docs/ATIVAR_CARGA_TITA_DIARIA_1_SEGREDO.sql e _2_LIGAR.sql) com
// o segredo CARGA_TITA_SEGREDO (Vault: carga_tita_segredo; Coolify: variável
// de mesmo nome). Responde na hora (202) e roda as 4 etapas depois, com
// after(): a rotina do banco não fica esperando. O resultado fica em
// tita_cargas e aparece em Administração → Carregar do TiTa.
//
// Só LÊ o TiTa. Sem o segredo certo: 401, sem dizer por quê.

export const dynamic = "force-dynamic"

function segredoConfere(recebido: string, esperado: string): boolean {
  const a = Buffer.from(recebido)
  const b = Buffer.from(esperado)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: Request) {
  const esperado = process.env.CARGA_TITA_SEGREDO
  if (!esperado || esperado.length < 32) {
    console.error("[carga-tita] CARGA_TITA_SEGREDO ausente ou curto no servidor")
    return NextResponse.json({ ok: false }, { status: 503 })
  }
  if (!segredoConfere(req.headers.get("x-carga-segredo") ?? "", esperado)) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  // Uma carga por vez: a que morreu no meio é encerrada; se outra está viva, não empilha.
  await encerrarCargasAbandonadas(supabaseService)
  const { data: rodando } = await supabaseService
    .from("tita_cargas")
    .select("id")
    .eq("situacao", "rodando")
    .limit(1)
  if (rodando?.length) return NextResponse.json({ ok: false, mensagem: "Já há uma carga rodando." }, { status: 409 })

  after(async () => {
    try {
      await executarCargaTita(supabaseService, "cron")
    } catch (e) {
      console.error("[carga-tita] falha inesperada:", e)
    }
  })
  return NextResponse.json({ ok: true }, { status: 202 })
}
