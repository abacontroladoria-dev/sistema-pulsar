import { NextResponse } from "next/server"
import { supabaseService } from "@/lib/supabase/service"
import { lerAcessoContratos, respostaDeAcesso, SEM_PERMISSAO } from "@/services/contratos/acesso"
import { BUCKET_CONTRATOS, TAMANHO_MAXIMO, montarCaminho, pareceUmPdf } from "@/services/contratos/arquivo"

// POST /api/contratos/[id]/arquivo/  (multipart, campo "arquivo") → { ok, contrato }
//
// Anexa o PDF ORIGINAL do contrato (o que vai para assinatura). Roda com
// service_role porque o bucket não tem policy para o navegador; a checagem de
// permissão é a de services/contratos/acesso.ts (cadastros_pacientes).
//
// Ordem: confere permissão → confere o contrato → grava o objeto → registra
// pela RPC (que reconfere o prefixo do caminho). Se a RPC recusar, o objeto
// recém-gravado é apagado para não sobrar PDF órfão no bucket.

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

function recusa(status: number, error: string, mensagem: string) {
  return NextResponse.json({ ok: false, error, mensagem }, { status })
}

export async function POST(req: Request, ctx: Ctx) {
  let acesso
  try {
    acesso = await lerAcessoContratos()
  } catch (e) {
    const r = respostaDeAcesso(e)
    if (r.status === 500) console.error("[api/contratos/arquivo] falha ao verificar o acesso", e)
    return NextResponse.json(r.corpo, { status: r.status })
  }
  if (!acesso.editar) return NextResponse.json(SEM_PERMISSAO, { status: 403 })

  const { id: idTexto } = await ctx.params
  const id = Number(idTexto)
  if (!Number.isInteger(id) || id <= 0) return recusa(400, "id_invalido", "Contrato inválido.")

  // Recusa antes de ler o corpo: `formData()` carrega tudo na memória. A folga
  // de 64 KB cobre o envelope multipart.
  const tamanhoDeclarado = Number(req.headers.get("content-length") ?? 0)
  if (tamanhoDeclarado > TAMANHO_MAXIMO + 64 * 1024) return recusa(413, "arquivo_grande", "O PDF passa de 10 MB.")

  let arquivo: File | null = null
  try {
    const form = await req.formData()
    const campo = form.get("arquivo")
    arquivo = campo instanceof File ? campo : null
  } catch {
    return recusa(400, "corpo_invalido", "Envio inválido.")
  }
  if (!arquivo) return recusa(400, "sem_arquivo", "Escolha o PDF do contrato.")
  if (arquivo.size > TAMANHO_MAXIMO) return recusa(413, "arquivo_grande", "O PDF passa de 10 MB.")

  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  if (!pareceUmPdf(bytes)) return recusa(415, "nao_e_pdf", "O arquivo não é um PDF.")

  const { data: contrato, error: erroLeitura } = await supabaseService
    .from("pacientes_contratos")
    .select("id, paciente_id, status")
    .eq("id", id)
    .eq("ativo", true)
    .maybeSingle()
  if (erroLeitura) {
    console.error("[api/contratos/arquivo] falha ao ler o contrato", erroLeitura.code)
    return recusa(500, "falha_leitura", "Não foi possível ler o contrato.")
  }
  if (!contrato) return recusa(404, "nao_encontrado", "Contrato não encontrado.")
  if (contrato.status === "cancelado") return recusa(409, "cancelado", "Contrato cancelado não recebe arquivo.")

  const caminho = montarCaminho(Number(contrato.paciente_id), id, "original")
  const { error: erroUpload } = await supabaseService.storage
    .from(BUCKET_CONTRATOS)
    .upload(caminho, bytes, { contentType: "application/pdf", upsert: false })
  if (erroUpload) {
    // Sem o caminho no log: ele identifica paciente e contrato.
    console.error("[api/contratos/arquivo] falha no upload", erroUpload.message)
    return recusa(500, "falha_upload", "Não foi possível gravar o PDF.")
  }

  const { data: linha, error: erroRpc } = await supabaseService.rpc("contratos_registrar_arquivo", {
    p_id: id,
    p_qual: "original",
    p_path: caminho,
    p_nome: arquivo.name.slice(0, 255),
    p_usuario_id: acesso.id,
    p_usuario_nome: acesso.nome,
  })
  if (erroRpc || !linha) {
    await supabaseService.storage.from(BUCKET_CONTRATOS).remove([caminho])
    console.error("[api/contratos/arquivo] RPC recusou o registro", erroRpc?.code)
    return recusa(
      erroRpc?.code === "22023" ? 409 : 500,
      "falha_registro",
      erroRpc?.code === "22023" && erroRpc.message ? erroRpc.message : "Não foi possível registrar o PDF.",
    )
  }

  return NextResponse.json({ ok: true, contrato: linha })
}
