import { NextResponse } from "next/server"
import { supabaseService } from "@/lib/supabase/service"
import { conferirAcesso } from "@/lib/exportarEvolucoes/servidor"
import { tipoDaImagem } from "@/lib/exportarEvolucoes/imagem"
import type { AssinaturaProfissional } from "@/types/exportarEvolucoes"

// POST /api/exportar-evolucoes/assinaturas  { profissional_ids: number[] }
//   → { assinaturas: AssinaturaProfissional[] }
//
// A imagem da assinatura vem do Cadastro de Profissionais (decisão D2), no
// bucket privado `pacientes-fotos`. A política do bucket não muda: a rota baixa
// com a service_role e devolve os bytes, e SÓ de caminhos
// `profissionais/{id}/assinatura-*` dos ids pedidos — nunca um caminho vindo do
// navegador. Cada imagem vai uma vez por exportação; o PDF a reaproveita.
export const dynamic = "force-dynamic"

const BUCKET = "pacientes-fotos"
const MAX_IDS = 300
const MAX_BYTES = 1_500_000

export async function POST(request: Request) {
  const acesso = await conferirAcesso("assinaturas")
  if (acesso instanceof NextResponse) return acesso

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const ids = Array.isArray(body?.profissional_ids)
    ? [...new Set(body.profissional_ids.filter((v): v is number => Number.isSafeInteger(v) && v > 0))]
    : []
  if (ids.length === 0) return NextResponse.json({ assinaturas: [] })
  if (ids.length > MAX_IDS) return NextResponse.json({ error: "Profissionais demais num pedido." }, { status: 400 })

  const { data: profs, error } = await supabaseService
    .from("profissionais")
    .select("id, assinatura_path")
    .in("id", ids)
    .not("assinatura_path", "is", null)
  if (error) {
    console.error("[api/exportar-evolucoes/assinaturas]", error)
    return NextResponse.json({ error: "Não foi possível ler as assinaturas." }, { status: 500 })
  }

  const assinaturas: AssinaturaProfissional[] = []
  await Promise.all(
    (profs ?? []).map(async (p: { id: number; assinatura_path: string | null }) => {
      const path = p.assinatura_path ?? ""
      const prefixo = `profissionais/${p.id}/assinatura-`
      if (!path.startsWith(prefixo) || path.slice(prefixo.length).includes("/") || path.includes("..")) return

      const { data: blob, error: e } = await supabaseService.storage.from(BUCKET).download(path)
      if (e || !blob || blob.size > MAX_BYTES) return
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const tipo = tipoDaImagem(bytes)
      if (!tipo) return // PDF só embute PNG/JPG íntegro; o resto sai como linha em branco
      assinaturas.push({ profissional_id: p.id, tipo, dados: Buffer.from(bytes).toString("base64") })
    }),
  )

  return NextResponse.json({ assinaturas })
}
