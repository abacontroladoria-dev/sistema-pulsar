import { NextResponse } from "next/server"
import { AcessoNegado, lerAcessoLaudos } from "@/services/laudos/acesso"
import { buscarLaudosDoRelatorio } from "@/services/laudos/relatorio"

// GET /api/laudos → { ok, rows: LaudoRow[], meta }
//
// A origem dos laudos passou a ser o relatório do Órbita que o robô do Coolify
// grava diariamente no Supabase (orbita_laudos_importacoes +
// orbita_laudos_relatorio), lido por services/laudos/relatorio.ts. Antes daqui
// era a API do TI (services/laudos/client.ts), paciente a paciente — aquele
// caminho continua no repo, sem chamador, como segunda opção.
//
// `inicio`/`fim` continuam ACEITOS e são IGNORADOS, de propósito: a API do TI
// usava a janela para descobrir QUAIS pacientes consultar, e o relatório do
// Órbita é um snapshot completo — não existe recorte de data que faça sentido
// aplicar nele. Mantidos na assinatura para não quebrar chamador antigo nem
// exigir mudança em quem já monta a URL com eles.
//
// Roda com service_role (via supabaseService, dentro do serviço): `anon` e
// `authenticated` não têm GRANT nessas tabelas — quem escreve é o robô. A chave
// nunca sai do servidor, e esta mesma rota já era assim antes.
// Route handler não é cacheado por padrão no Next 16, mas esta rota deixou de
// receber `request` (antes `inicio`/`fim` a tornavam dinâmica por consequência),
// e o dado por baixo troca todo dia. Explícito para nunca ser assado no build.
export const dynamic = "force-dynamic"

export async function GET() {
  // ATENÇÃO: esta rota roda com service_role e devolve o relatório inteiro do
  // Órbita (nome, nascimento, plano, especialidade, alta…) — dado de saúde de
  // criança. A RLS não a protege e o proxy.ts exclui /api do matcher, então a
  // checagem TEM de estar aqui. Até 08/10/2026 ela respondia a qualquer pessoa
  // na internet, sem login.
  //
  // Exige sessão válida e usuário ativo (lerAcessoLaudos → 401 sem sessão ou
  // inativo). Não exige uma permissão específica de laudos de propósito: o
  // layout de TODO o Cronograma carrega esta rota ao abrir qualquer tela (ver
  // CronogramaDataLayout). Restringir por permissão exige antes separar quem
  // precisa dos laudos de quem só precisa da grade — fica como próximo passo.
  try {
    await lerAcessoLaudos()
  } catch (e) {
    if (e instanceof AcessoNegado) {
      return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: e.status })
    }
    console.error("[api/laudos] falha ao verificar o acesso", e)
    return NextResponse.json({ ok: false, error: "falha_ao_verificar_acesso" }, { status: 500 })
  }

  try {
    const { rows, meta } = await buscarLaudosDoRelatorio()
    // `meta` é aditivo: quem só lê `body.rows` continua válido.
    return NextResponse.json({ ok: true, rows, meta })
  } catch (e) {
    console.error("[api/laudos] falha ao ler relatório de laudos", e)
    return NextResponse.json({ ok: false, error: "falha_ao_ler_relatorio_laudos" }, { status: 500 })
  }
}
