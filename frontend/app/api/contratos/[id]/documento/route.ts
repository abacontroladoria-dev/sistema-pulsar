import { NextResponse } from "next/server"
import { gerarDocumentoDoContrato } from "@/services/contratos/documento"
import { lerAcessoContratos, respostaDeAcesso, SEM_PERMISSAO } from "@/services/contratos/acesso"

// GET /api/contratos/{id}/documento/ → o .docx do contrato, preenchido com o
// cadastro de AGORA (nada é gravado; ver services/contratos/documento.ts).
//
// Só `cadastros_pacientes` (`editar`): o documento leva CPF, RG, endereço e
// celular do responsável — quem tem só `status_contratos` não lê nada disso.
//
// Cadastro incompleto → 422 com a lista `pendencias`, para a tela mostrar o que
// falta em vez de gerar um contrato com buracos.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  let acesso
  try {
    acesso = await lerAcessoContratos()
  } catch (e) {
    const r = respostaDeAcesso(e)
    if (r.status === 500) console.error("[api/contratos/documento] falha ao verificar o acesso", e)
    return NextResponse.json(r.corpo, { status: r.status })
  }
  if (!acesso.editar) return NextResponse.json(SEM_PERMISSAO, { status: 403 })

  const { id } = await ctx.params
  const contratoId = Number(id)
  if (!Number.isSafeInteger(contratoId) || contratoId <= 0) {
    return NextResponse.json({ ok: false, error: "id_invalido", mensagem: "Contrato inválido." }, { status: 400 })
  }

  try {
    const r = await gerarDocumentoDoContrato(contratoId)
    if (!r.ok) {
      return NextResponse.json(
        { ok: false, error: r.status === 404 ? "nao_encontrado" : "cadastro_incompleto", mensagem: r.mensagem, pendencias: r.pendencias },
        { status: r.status },
      )
    }
    return new NextResponse(new Uint8Array(r.arquivo), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="contrato.docx"; filename*=UTF-8''${encodeURIComponent(r.nomeArquivo)}`,
        "Cache-Control": "no-store",
      },
    })
  } catch (e) {
    // Sem dado do paciente no log: só o id do contrato e a mensagem técnica.
    console.error(`[api/contratos/documento] contrato ${contratoId}:`, e instanceof Error ? e.message : e)
    return NextResponse.json(
      { ok: false, error: "falha_ao_gerar", mensagem: "Não foi possível gerar o documento." },
      { status: 500 },
    )
  }
}
