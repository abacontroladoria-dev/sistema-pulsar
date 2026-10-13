import { NextResponse } from "next/server"
import { supabaseService } from "@/lib/supabase/service"
import { lerAcessoContratos, respostaDeAcesso, SEM_PERMISSAO } from "@/services/contratos/acesso"

// GET /api/contratos/valor-sugerido/ → { ok, valor, avulsa } — os valores que
// o "Novo contrato" de Avaliação Neuropsicológica usa sem a equipe digitar
// (decisão do usuário, 09/10/2026: o que é padrão vem sozinho; "Alterar" é
// para exceção):
//   • valor: o pacote PARTICULAR, à vista, de cronograma_convenio_pacote_avaliacao
//     (à vista porque o contrato diz "pago integralmente no ato da assinatura");
//   • avulsa: o valor por sessão PARTICULAR de cronograma_convenio_valores. Sem
//     a linha cadastrada, vem null e o documento acusa a pendência.
//
// Por rota e service_role: a tabela de valores só é legível por
// admin/diretoria/cronograma (20260724120000), e quem cria contrato é a
// recepção. Devolve só os dois números, nada mais da tabela.
export const dynamic = "force-dynamic"

const TERAPIA = "Avaliação Neuropsicológica"

export async function GET() {
  let acesso
  try {
    acesso = await lerAcessoContratos()
  } catch (e) {
    const r = respostaDeAcesso(e)
    return NextResponse.json(r.corpo, { status: r.status })
  }
  if (!acesso.editar) return NextResponse.json(SEM_PERMISSAO, { status: 403 })

  // Igualdade exata no nome: ILIKE '%neuropsic%' pegaria também a Avaliação
  // NeuropsicoPEDAGÓGICA, que é outro serviço.
  const [pacote, sessao] = await Promise.all([
    supabaseService.from("cronograma_convenio_pacote_avaliacao").select("convenio_nome, valor_a_vista").eq("terapia_nome", TERAPIA),
    supabaseService.from("cronograma_convenio_valores").select("convenio_nome, valor_sessao").eq("terapia_nome", TERAPIA),
  ])
  const erro = pacote.error ?? sessao.error
  if (erro) {
    console.error("[api/contratos/valor-sugerido]", erro.message)
    return NextResponse.json({ ok: false, mensagem: "Não foi possível ler a tabela de valores." }, { status: 500 })
  }
  const ehParticular = (l: { convenio_nome: string | null }) => (l.convenio_nome ?? "").trim().toLowerCase() === "particular"
  const numeroOuNull = (v: unknown) => (v == null || !(Number(v) > 0) ? null : Number(v))
  const valor = numeroOuNull((pacote.data ?? []).find(ehParticular)?.valor_a_vista)
  const avulsa = numeroOuNull((sessao.data ?? []).find(ehParticular)?.valor_sessao)
  return NextResponse.json({ ok: true, valor, avulsa }, { headers: { "Cache-Control": "no-store" } })
}
