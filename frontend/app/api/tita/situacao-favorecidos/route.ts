import { NextResponse } from "next/server"
import { AcessoRecusado, exigirPermissao } from "@/lib/permissions/exigirPermissao"
import { buscarSituacaoFavorecidos, type FavorecidoSituacao } from "@/services/tita/situacaoFavorecidos"

const LOG_TAG = "[tita:situacao-favorecidos]"

// Situação cadastral muda raramente (um paciente entra ou sai da clínica), mas a
// tela consulta a cada vez que a modalidade é aberta. Cache curto em memória
// evita repetir a chamada ao TiTa a cada alternância de aba, sem correr o risco de
// servir dado velho por muito tempo. Vive no escopo do módulo: some a cada
// redeploy/reinício, o que é o comportamento desejado.
const TTL_MS = 5 * 60 * 1000
let cache: { em: number; favorecidos: FavorecidoSituacao[] } | null = null

/**
 * Telas que chamam esta rota: Ocupação Paciente (Criar Novo Cronograma) e
 * Indicadores → Pacientes / Previsão de Receitas (useConvenioCadastroPacientes).
 * Devolve nome, situação e convênio de todos os pacientes do TiTa: até
 * 19/10/2026 bastava estar logado.
 */
const PERMISSOES = [
  "cronograma_ocupacao_paciente",
  "indicadores_pacientes",
  "indicadores_previsao_receitas",
] as const

export async function GET() {
  // DISABLE_AUTH (desenvolvimento local, sem sessão) é tratado em exigirPermissao.
  try {
    await exigirPermissao(PERMISSOES)
  } catch (e) {
    if (e instanceof AcessoRecusado) {
      return NextResponse.json(
        { ok: false, error: e.status === 401 ? "not_authenticated" : "sem_permissao" },
        { status: e.status },
      )
    }
    console.error(`${LOG_TAG} falha ao verificar o acesso`, e)
    return NextResponse.json({ ok: false, error: "falha_ao_verificar_acesso" }, { status: 500 })
  }

  const agora = Date.now()
  if (cache && agora - cache.em < TTL_MS) {
    return NextResponse.json({ ok: true, favorecidos: cache.favorecidos, doCache: true })
  }

  const resultado = await buscarSituacaoFavorecidos()
  if (!resultado.ok) {
    console.error(`${LOG_TAG} falha ao consultar o TiTa`, resultado.erro)
    // Cache expirado mas com dado anterior é melhor que nada: a alternativa é a
    // tela perder a distinção ativo/inativo por uma falha transitória do TiTa.
    if (cache) {
      return NextResponse.json({ ok: true, favorecidos: cache.favorecidos, doCache: true, obsoleto: true })
    }
    return NextResponse.json({ ok: false, error: resultado.erro ?? "erro_desconhecido" }, { status: 502 })
  }

  cache = { em: agora, favorecidos: resultado.favorecidos }
  return NextResponse.json({ ok: true, favorecidos: resultado.favorecidos })
}
