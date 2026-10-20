import { NextResponse } from "next/server"
import { supabaseService } from "@/lib/supabase/service"
import { conferirAcesso } from "@/lib/exportarEvolucoes/servidor"
import { tipoDaImagem } from "@/lib/exportarEvolucoes/imagem"
import type { AssinaturaProfissional } from "@/types/exportarEvolucoes"

// POST /api/exportar-evolucoes/assinaturas  { chaves: string[] }
//   → { assinaturas: AssinaturaProfissional[] }
//
// A imagem da assinatura vem do Cadastro de Profissionais (decisão D2), no
// bucket privado `pacientes-fotos`. A rota recebe as CHAVES das evoluções que
// vão para o PDF e descobre aqui quem as executou — nunca um id de profissional
// vindo do navegador (senão quem tem a permissão baixava a assinatura de
// qualquer um, iterando ids). Só caminhos `profissionais/{id}/assinatura-*`,
// baixados com a service_role, poucos por vez.
export const dynamic = "force-dynamic"

const BUCKET = "pacientes-fotos"
const MAX_CHAVES = 5000
const MAX_BYTES = 1_500_000
const LOTE_CONSULTA = 300
const DOWNLOADS_SIMULTANEOS = 4

const TITA = /^tita:(\d{1,18})$/
const PULSAR = /^pulsar:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

function emLotes<T>(lista: T[], n: number): T[][] {
  const lotes: T[][] = []
  for (let i = 0; i < lista.length; i += n) lotes.push(lista.slice(i, i + n))
  return lotes
}

/** Ids (do cadastro) de quem executou as evoluções pedidas — a mesma regra da exportação. */
async function profissionaisDasEvolucoes(chaves: string[]): Promise<number[]> {
  const tita = chaves.map(c => TITA.exec(c)?.[1]).filter((v): v is string => !!v).map(Number)
  const pulsar = chaves.map(c => PULSAR.exec(c)?.[1]).filter((v): v is string => !!v)
  const titaProf = new Set<number>()
  const ids = new Set<number>()

  for (const lote of emLotes(tita, LOTE_CONSULTA)) {
    const { data, error } = await supabaseService
      .from("grade_evolucoes")
      .select("tita_tratativa_profissional_id")
      .in("id", lote)
      .is("agendamento_id", null)
    if (error) throw error
    for (const r of data ?? []) if (r.tita_tratativa_profissional_id) titaProf.add(r.tita_tratativa_profissional_id)
  }
  for (const lote of emLotes([...titaProf], LOTE_CONSULTA)) {
    const { data, error } = await supabaseService.from("profissionais").select("id").in("tita_profissional_id", lote)
    if (error) throw error
    for (const r of data ?? []) ids.add(r.id)
  }
  for (const lote of emLotes(pulsar, LOTE_CONSULTA)) {
    const { data, error } = await supabaseService
      .from("grade_evolucoes")
      .select("tratativa_profissional_id, grade_agendamentos(profissional_id)")
      .in("agendamento_id", lote)
      .eq("origem", "pulsar")
    if (error) throw error
    for (const r of (data ?? []) as unknown as {
      tratativa_profissional_id: number | null
      grade_agendamentos: { profissional_id: number | null } | null
    }[]) {
      const id = r.tratativa_profissional_id ?? r.grade_agendamentos?.profissional_id
      if (id) ids.add(id)
    }
  }
  return [...ids]
}

async function baixar(p: { id: number; assinatura_path: string | null }): Promise<AssinaturaProfissional | null> {
  const path = p.assinatura_path ?? ""
  const prefixo = `profissionais/${p.id}/assinatura-`
  if (!path.startsWith(prefixo) || path.slice(prefixo.length).includes("/") || path.includes("..")) return null

  const { data: blob, error } = await supabaseService.storage.from(BUCKET).download(path)
  if (error || !blob || blob.size > MAX_BYTES) return null
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const tipo = tipoDaImagem(bytes)
  if (!tipo) return null // PDF só embute PNG/JPG íntegro; o resto sai como linha em branco
  return { profissional_id: p.id, tipo, dados: Buffer.from(bytes).toString("base64") }
}

export async function POST(request: Request) {
  const acesso = await conferirAcesso("assinaturas")
  if (acesso instanceof NextResponse) return acesso

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const chaves = Array.isArray(body?.chaves)
    ? [...new Set(body.chaves.filter((v): v is string => typeof v === "string" && v.length <= 60))]
    : []
  if (chaves.length === 0) return NextResponse.json({ assinaturas: [] })
  if (chaves.length > MAX_CHAVES) return NextResponse.json({ error: "Evoluções demais num pedido." }, { status: 400 })

  try {
    const ids = await profissionaisDasEvolucoes(chaves)
    if (ids.length === 0) return NextResponse.json({ assinaturas: [] })

    const profs: { id: number; assinatura_path: string | null }[] = []
    for (const lote of emLotes(ids, LOTE_CONSULTA)) {
      const { data, error } = await supabaseService
        .from("profissionais")
        .select("id, assinatura_path")
        .in("id", lote)
        .not("assinatura_path", "is", null)
      if (error) throw error
      profs.push(...(data ?? []))
    }

    const assinaturas: AssinaturaProfissional[] = []
    for (const lote of emLotes(profs, DOWNLOADS_SIMULTANEOS)) {
      for (const a of await Promise.all(lote.map(baixar))) if (a) assinaturas.push(a)
    }
    return NextResponse.json({ assinaturas })
  } catch (e) {
    console.error("[api/exportar-evolucoes/assinaturas]", e)
    return NextResponse.json({ error: "Não foi possível ler as assinaturas." }, { status: 500 })
  }
}
