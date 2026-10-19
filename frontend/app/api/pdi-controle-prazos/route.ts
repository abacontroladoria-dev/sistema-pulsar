import { NextResponse } from "next/server"
import { AcessoRecusado, exigirPermissao } from "@/lib/permissions/exigirPermissao"
import { buscarControlePrazosPdi } from "@/services/pdi/prazos"

// GET /api/pdi-controle-prazos → { ok, itens, meta }
//
// Mesmo esqueleto de /api/acompanhamento-laudos/route.ts: existe porque a
// elegibilidade do PDI depende de `orbita_laudos_relatorio`, que só
// service_role lê (ver o cabeçalho de services/pdi/prazos.ts) — o browser não
// alcança aquela tabela, e a chave nunca sai do servidor.
//
// O dado por baixo troca todo dia (o robô de laudos roda de manhã, e a grade
// sincroniza continuamente) e a resposta depende de `hoje` para todo o cálculo
// de status/prazo — nunca pode ser assada no build.
export const dynamic = "force-dynamic"

/** As duas telas que chamam esta rota: Prazos PDI e Painel do Analista. */
const PERMISSOES = ["terapeutico_pdi", "terapeutico_pdi_painel"] as const

export async function GET() {
  // Rota com service_role, devolve nome de paciente e dado clínico. Até
  // 19/10/2026 bastava estar logado; agora exige usuário ativo e a permissão de
  // uma das telas. DISABLE_AUTH (localhost sem login) é tratado em exigirPermissao.
  try {
    await exigirPermissao(PERMISSOES)
  } catch (e) {
    if (e instanceof AcessoRecusado) {
      return NextResponse.json(
        { ok: false, error: e.status === 401 ? "not_authenticated" : "sem_permissao" },
        { status: e.status },
      )
    }
    console.error("[api/pdi-controle-prazos] falha ao verificar o acesso", e)
    return NextResponse.json({ ok: false, error: "falha_ao_verificar_acesso" }, { status: 500 })
  }

  try {
    const { itens, meta } = await buscarControlePrazosPdi()
    return NextResponse.json({ ok: true, itens, meta })
  } catch (e) {
    console.error("[api/pdi-controle-prazos] falha ao montar a lista", e)
    return NextResponse.json(
      { ok: false, error: "falha_ao_ler_pdi_controle_prazos" },
      { status: 500 },
    )
  }
}
