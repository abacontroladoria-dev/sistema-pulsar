import { NextResponse } from "next/server"
import {
  alterarPrazo,
  buscarPainelEntrada,
  buscarPrazos,
  lerAcessoPainelEntrada,
  PrazoRecusado,
  respostaDeAcesso,
  SEM_PERMISSAO,
} from "@/services/indicadores/entradaConvenio"
import {
  MOTIVO_MINIMO,
  PRAZO_MAXIMO,
  impactoDaAlteracao,
  mapaDePrazos,
  type PrazosResposta,
} from "@/lib/indicadores/entradaConvenio"

// /api/indicadores/entrada-convenio/prazos
//
// GET  → prazos vigentes + histórico completo + se quem pede pode alterar.
//        Quem vê o painel vê os prazos (decisão do usuário: transparência para
//        quem é cobrado).
// POST { etapa, prazo, motivo } → altera o prazo de uma etapa. Só admin e
//        diretoria, com usuário identificado. O impacto (quantos mudam de
//        situação, % no prazo antes/depois) é calculado AQUI sobre a última
//        rodada, não aceito do cliente, e vai para o histórico junto.
export const dynamic = "force-dynamic"

async function acessoOuResposta() {
  try {
    return { acesso: await lerAcessoPainelEntrada() }
  } catch (e) {
    const r = respostaDeAcesso(e)
    if (r.status === 500) console.error("[api/indicadores/entrada-convenio/prazos] falha ao verificar o acesso", e)
    return { resposta: NextResponse.json(r.corpo, { status: r.status }) }
  }
}

export async function GET() {
  const { acesso, resposta } = await acessoOuResposta()
  if (!acesso) return resposta
  if (!acesso.ler) return NextResponse.json(SEM_PERMISSAO, { status: 403 })

  try {
    const prazos = await buscarPrazos()
    const corpo: PrazosResposta = {
      instalado: prazos !== null,
      vigentes: prazos?.vigentes ?? [],
      historico: prazos?.historico ?? [],
      podeAlterar: acesso.alterarPrazos && prazos !== null,
      motivoBloqueio: prazos === null
        ? "A tabela de prazos ainda não foi instalada (migration 20261015160000 pendente)."
        : acesso.motivoBloqueio,
      semLogin: acesso.usuarioId === null,
    }
    return NextResponse.json({ ok: true, ...corpo }, { headers: { "Cache-Control": "no-store" } })
  } catch (e) {
    console.error("[api/indicadores/entrada-convenio/prazos] falha ao ler", e instanceof Error ? e.message : e)
    return NextResponse.json(
      { ok: false, error: "falha_ao_ler_prazos", mensagem: "Não foi possível ler os prazos." },
      { status: 500 },
    )
  }
}

export async function POST(req: Request) {
  const { acesso, resposta } = await acessoOuResposta()
  if (!acesso) return resposta
  if (!acesso.ler || !acesso.alterarPrazos || !acesso.usuarioId) {
    return NextResponse.json(
      { ...SEM_PERMISSAO, mensagem: acesso.motivoBloqueio ?? SEM_PERMISSAO.mensagem },
      { status: 403 },
    )
  }

  let corpo: { etapa?: unknown; prazo?: unknown; motivo?: unknown }
  try {
    corpo = (await req.json()) as typeof corpo
  } catch {
    return NextResponse.json({ ok: false, error: "corpo_invalido", mensagem: "Pedido inválido." }, { status: 400 })
  }
  const etapa = typeof corpo.etapa === "string" ? corpo.etapa : ""
  const prazo = typeof corpo.prazo === "number" ? corpo.prazo : NaN
  const motivo = typeof corpo.motivo === "string" ? corpo.motivo.trim() : ""
  const invalido = !/^E[0-7]$/.test(etapa)
    ? "Etapa inválida."
    : !Number.isInteger(prazo) || prazo < 0 || prazo > PRAZO_MAXIMO
      ? `O prazo precisa ser um número inteiro de 0 a ${PRAZO_MAXIMO} dias úteis.`
      : motivo.length < MOTIVO_MINIMO
        ? `Escreva o motivo da alteração (mínimo de ${MOTIVO_MINIMO} caracteres).`
        : motivo.length > 1000
          ? "O motivo passou de 1000 caracteres."
          : null
  if (invalido) return NextResponse.json({ ok: false, error: "dados_invalidos", mensagem: invalido }, { status: 400 })

  try {
    const [painel, prazos] = await Promise.all([buscarPainelEntrada(), buscarPrazos()])
    if (!prazos) {
      return NextResponse.json(
        { ok: false, error: "nao_instalado", mensagem: "A tabela de prazos ainda não foi instalada (migration 20261015160000 pendente)." },
        { status: 400 },
      )
    }
    const impacto = painel?.snapshot
      ? impactoDaAlteracao(painel.snapshot.dados, mapaDePrazos(prazos.vigentes), etapa, prazo)
      : null
    const resultado = await alterarPrazo({ etapa, prazo, motivo, usuarioId: acesso.usuarioId, impacto })
    return NextResponse.json({ ok: true, resultado }, { headers: { "Cache-Control": "no-store" } })
  } catch (e) {
    if (e instanceof PrazoRecusado) {
      return NextResponse.json({ ok: false, error: "recusado", mensagem: e.message }, { status: e.status })
    }
    console.error("[api/indicadores/entrada-convenio/prazos] falha ao alterar", e instanceof Error ? e.message : e)
    return NextResponse.json(
      { ok: false, error: "falha_ao_alterar", mensagem: "Não foi possível alterar o prazo." },
      { status: 500 },
    )
  }
}
