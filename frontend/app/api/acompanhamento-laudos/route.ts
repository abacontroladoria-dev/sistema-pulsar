import { NextResponse } from "next/server"
import { buscarAcompanhamentoLaudos } from "@/services/laudos/acompanhamento"
import { AcessoNegado, lerAcessoLaudos, type AcessoLaudos } from "@/services/laudos/acesso"

// GET /api/acompanhamento-laudos → { ok, itens, meta }
//
// Existe porque `orbita_laudos_relatorio` só é legível por service_role (medido:
// 401/42501 com anon e com publishable key — falta de GRANT, não RLS negando
// linha). O browser não alcança aquela tabela de jeito nenhum, então a tela lê
// por aqui e a chave nunca sai do servidor.
//
// Rota PRÓPRIA e não um parâmetro de /api/laudos: aquela devolve as 1.849 linhas
// cruas com as 26 colunas do Excel, para o motor do cronograma. Esta devolve 343
// itens já agrupados por laudo e já cruzados com o cadastro. Projeções
// diferentes, consumidores diferentes; enfiar as duas numa rota faria cada
// chamador carregar o payload do outro.
//
// O dado por baixo troca todo dia (o robô roda de manhã) e a resposta depende de
// `hoje` para vigente/vencido — nunca pode ser assada no build.
export const dynamic = "force-dynamic"

export async function GET() {
  // Esta rota roda com service_role e devolve nome de paciente, dado de laudo e
  // o relatório de senhas — a RLS não a protege, a checagem é aqui
  // (services/laudos/acesso.ts). Até 29/09/2026 bastava estar logado.
  //
  //   • tela de laudos (ou admin/diretoria/recepção): tudo;
  //   • só Ocupação Paciente: os laudos SEM as senhas — ela mostra a situação do
  //     laudo e nunca a senha;
  //   • nenhuma das duas: 403.
  let acesso: AcessoLaudos
  try {
    acesso = await lerAcessoLaudos()
  } catch (e) {
    if (e instanceof AcessoNegado) {
      return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: e.status })
    }
    console.error("[api/acompanhamento-laudos] falha ao verificar o acesso", e)
    return NextResponse.json({ ok: false, error: "falha_ao_verificar_acesso" }, { status: 500 })
  }
  if (!acesso.laudos) {
    return NextResponse.json({ ok: false, error: "sem_permissao" }, { status: 403 })
  }

  try {
    const { itens, meta } = await buscarAcompanhamentoLaudos()
    if (!acesso.senhas) {
      return NextResponse.json({
        ok: true,
        itens: itens.map((i) => ({ ...i, senhas: null })),
        meta: { ...meta, senhas: null, senhasErro: null },
      })
    }
    return NextResponse.json({ ok: true, itens, meta })
  } catch (e) {
    console.error("[api/acompanhamento-laudos] falha ao montar a lista", e)
    return NextResponse.json(
      { ok: false, error: "falha_ao_ler_acompanhamento_laudos" },
      { status: 500 },
    )
  }
}
