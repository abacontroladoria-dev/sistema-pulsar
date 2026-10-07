import { createServerClient } from "@supabase/ssr"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { buscarSituacaoFavorecidos, type FavorecidoSituacao } from "@/services/tita/situacaoFavorecidos"

const LOG_TAG = "[tita:situacao-favorecidos]"

// Situação cadastral muda raramente (um paciente entra ou sai da clínica), mas a
// tela consulta a cada vez que a modalidade é aberta. Cache curto em memória
// evita repetir a chamada ao TiTa a cada alternância de aba, sem correr o risco de
// servir dado velho por muito tempo. Vive no escopo do módulo: some a cada
// redeploy/reinício, o que é o comportamento desejado.
const TTL_MS = 5 * 60 * 1000
let cache: { em: number; favorecidos: FavorecidoSituacao[] } | null = null

async function getCurrentUser(request: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll() {},
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function GET(request: NextRequest) {
  // DISABLE_AUTH cobre o desenvolvimento local, onde não há sessão (mesma
  // convenção já usada no restante do app).
  if (process.env.DISABLE_AUTH !== "true") {
    const user = await getCurrentUser(request)
    if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 })
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
