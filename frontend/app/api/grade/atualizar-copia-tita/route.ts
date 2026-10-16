import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { carregarPermissoesEfetivas } from "@/lib/permissions/carregar"
import { temPermissao } from "@/lib/permissions/resolver"
import { checkRateLimit } from "@/lib/rate-limit"

// "Atualizar a cópia do TiTa agora" — pede ao sync (Edge Function
// sync-grade-csv, modo "grade") uma leitura nova da grade do TiTa para a janela.
// SÓ LEITURA do TiTa: o sync grava a cópia local (csv_grades_profissionais) e
// carimba cada dia em grade_sync_dia; nada vai para o TiTa.
//
// A Edge Function exige a chave de serviço, que só existe no servidor. Por isso
// a checagem de acesso é ESTA: login ativo + permissão da Grade ou da página
// "Carregar do TiTa". Um pedido a cada 10 minutos por pessoa: cada dia útil leva
// cerca de 1 minuto no TiTa, e o sync segue sozinho até o fim da janela.

const PERMISSOES = ["cronograma_grade", "carregar_tita"]
const DATA = /^\d{4}-\d{2}-\d{2}$/

function negar(status: number, mensagem: string) {
  return NextResponse.json({ ok: false, mensagem }, { status })
}

export async function POST(req: Request) {
  let usuarioId = "dev"
  if (process.env.DISABLE_AUTH !== "true") {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) return negar(401, "Sessão expirada. Entre de novo.")
    const { data: perfil } = await supabase.from("usuarios").select("role, ativo").eq("id", user.id).maybeSingle()
    if (!perfil?.ativo) return negar(401, "Usuário não encontrado ou inativo.")
    const codigos = await carregarPermissoesEfetivas(supabase)
    if (!PERMISSOES.some(c => temPermissao((perfil.role as string | null) ?? "", codigos, c))) {
      return negar(403, "Você não tem permissão para atualizar a cópia do TiTa.")
    }
    usuarioId = user.id
  }

  if (checkRateLimit(`atualizar-copia-tita:${usuarioId}`, 1, 10 * 60 * 1000)) {
    return negar(429, "A cópia já foi pedida há pouco. O sync segue sozinho; acompanhe o frescor na tela.")
  }

  const corpo = (await req.json().catch(() => ({}))) as { de?: string; ate?: string }
  if (!corpo.de || !corpo.ate || !DATA.test(corpo.de) || !DATA.test(corpo.ate) || corpo.ate < corpo.de) {
    return negar(400, "Período inválido.")
  }
  const dias = (Date.parse(corpo.ate) - Date.parse(corpo.de)) / 86_400_000
  if (dias > 120) return negar(400, "Período longo demais (máximo 120 dias).")

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !chave) return negar(500, "Servidor sem a configuração do Supabase.")

  try {
    // A primeira fatia responde em até ~30 s e encadeia as seguintes. Se a
    // resposta demorar mais, o pedido já foi feito: a tela acompanha pelo frescor.
    const r = await fetch(`${url}/functions/v1/sync-grade-csv`, {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({ modo: "grade", data_inicio: corpo.de, data_fim: corpo.ate }),
      signal: AbortSignal.timeout(90_000),
    })
    if (!r.ok) {
      console.error("[atualizar-copia-tita] sync respondeu", r.status, (await r.text()).slice(0, 300))
      return negar(502, "O sync do TiTa recusou o pedido. Tente de novo em alguns minutos.")
    }
  } catch (e) {
    if (!(e instanceof Error && e.name === "TimeoutError")) {
      console.error("[atualizar-copia-tita]", e)
      return negar(502, "Não foi possível falar com o sync do TiTa.")
    }
  }
  return NextResponse.json({ ok: true })
}
