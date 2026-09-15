import type { NextRequest } from 'next/server'

import { checkRateLimit } from '@/lib/rate-limit'
import { supabaseService } from '@/lib/supabase/service'

// Leitura de faltas por sistema parceiro.
//
// Esta rota é deliberadamente fina: ela não decide nada sobre autorização nem
// sobre quais colunas saem. Quem faz as duas coisas é a RPC `integracao_faltas`
// (SECURITY DEFINER) sobre a view `vw_integracao_faltas`, pelo mesmo motivo do
// robô — a regra fica no banco, onde não há como um bug de rota vazar coluna a
// mais de `fila_autorizacoes`, que guarda CPF, carteirinha e guia.
//
// O token viaja no header `Authorization: Bearer` e nunca na URL, portanto nunca
// em log de acesso.
//
// É server-to-server: nenhuma rota deste projeto seta CORS, então o browser
// bloqueia a leitura. Isso é desejado — um Bearer estático que viajasse no
// browser estaria no bundle do parceiro, ou seja, público.

export const dynamic = 'force-dynamic'

// 60/min é folgado para o volume real (as faltas mudam ~67 vezes por dia) e
// ainda assim limita a drenagem se o token vazar.
const LIMITE_REQ = 60
const JANELA_MS = 60_000

type LinhaFalta = {
  tita_agendamento_id: number
  paciente_id: number | null
  profissional_id: number | null
  data_atendimento: string
  horario: string
  terapia_nome: string | null
  tipo_falta: string | null
  codigo_justificativa: number | null
  justificativa: string | null
  ativa: boolean
  status: string
  atualizado_em: string
}

function extrairToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null

  const [esquema, valor] = header.split(' ')
  if (!valor || esquema.toLowerCase() !== 'bearer') return null

  return valor.trim() || null
}

export async function GET(request: NextRequest) {
  const token = extrairToken(request)
  if (!token) {
    return Response.json(
      { erro: 'informe o token em Authorization: Bearer <token>' },
      { status: 401 }
    )
  }

  const params = request.nextUrl.searchParams

  // Cursor composto. `desde` sozinho não basta: milhares de faltas compartilham
  // o mesmo `atualizado_em` (um backfill carimbou 3.858 no mesmo instante), e
  // paginar só pelo tempo perderia todas as que não coubessem na primeira
  // página daquele instante. `desde_id` continua a varredura dentro do empate.
  const desde = params.get('desde')
  if (desde && Number.isNaN(Date.parse(desde))) {
    return Response.json(
      { erro: '`desde` deve ser uma data ISO 8601 (ex.: 2026-09-14T00:00:00Z)' },
      { status: 400 }
    )
  }

  const desdeIdBruto = params.get('desde_id')
  const desdeId = desdeIdBruto ? Number(desdeIdBruto) : null
  if (desdeIdBruto && !Number.isSafeInteger(desdeId)) {
    return Response.json(
      { erro: '`desde_id` deve ser um inteiro (o `proximo_desde_id` da resposta anterior)' },
      { status: 400 }
    )
  }

  const limiteBruto = params.get('limite')
  const limite = limiteBruto ? Number(limiteBruto) : 500
  if (!Number.isInteger(limite) || limite < 1 || limite > 1000) {
    return Response.json(
      { erro: '`limite` deve ser um inteiro entre 1 e 1000' },
      { status: 400 }
    )
  }

  // ── 1. Autenticar ANTES do rate limit ────────────────────────────────────
  //
  // O rate limit é chaveado pelo ID DO PARCEIRO, e é por isso que a
  // autenticação vem primeiro. A versão anterior chaveava pelo token do
  // request, antes de autenticar — e como `lib/rate-limit.ts` é um Map de
  // processo cujo `cleanupRateLimitStore()` nunca é chamado, um atacante SEM
  // TOKEN VÁLIDO variava o token a cada request e crescia o heap para sempre:
  // medido em 292 bytes por request, ~31 min de flood a 1k req/s para 512 MB.
  //
  // Chaveando pelo id, a cardinalidade do Map é o número de parceiros
  // cadastrados — não o que o atacante digita. O vetor fecha por construção.
  //
  // Autenticar numa chamada separada (e não reaproveitar a consulta) é o que
  // faz o limite valer também quando a consulta devolveria ZERO linhas: um
  // cursor no futuro retorna vazio sempre, e seria um caminho livre de limite.
  const auth = await supabaseService.rpc('integracao_identificar', { p_token: token })

  if (auth.error) {
    if (auth.error.code === '28000') {
      return Response.json({ erro: 'token invalido' }, { status: 401 })
    }
    console.error('[integracao/faltas] falha ao identificar', { code: auth.error.code })
    return Response.json({ erro: 'servico indisponivel' }, { status: 500 })
  }

  const parceiroId = (auth.data as { parceiro_id: number }[] | null)?.[0]?.parceiro_id
  if (parceiroId === undefined) {
    return Response.json({ erro: 'token invalido' }, { status: 401 })
  }

  // ── 2. Rate limit por parceiro ───────────────────────────────────────────
  if (checkRateLimit(`integracao:faltas:${parceiroId}`, LIMITE_REQ, JANELA_MS)) {
    return Response.json(
      { erro: 'limite de requisicoes excedido' },
      { status: 429, headers: { 'Retry-After': String(JANELA_MS / 1000) } }
    )
  }

  // ── 3. A consulta ────────────────────────────────────────────────────────
  const { data, error } = await supabaseService.rpc('integracao_faltas', {
    p_token: token,
    p_desde: desde,
    p_desde_id: desdeId,
    p_limite: limite,
  })

  if (error) {
    // '28000' é o código que `integracao_autenticar` levanta para token
    // inexistente, revogado ou de outro escopo — sempre a mesma mensagem, para
    // não entregar ao chamador a informação de "quase acertou".
    if (error.code === '28000') {
      return Response.json({ erro: 'token invalido' }, { status: 401 })
    }

    // Só o código do erro vai ao log. A mensagem/detalhe do PostgREST pode
    // carregar conteúdo influenciado pelo chamador (um token com byte inválido,
    // por exemplo, volta como erro de driver), e isso é poluição de log que o
    // atacante escolhe. O diagnóstico real fica no log do Postgres.
    console.error('[integracao/faltas] falha na consulta', { code: error.code })
    return Response.json({ erro: 'servico indisponivel' }, { status: 500 })
  }

  const faltas = (data ?? []) as LinhaFalta[]

  // Cursor pronto para a próxima chamada: o parceiro só devolve os dois valores,
  // sem precisar calcular nada. A RPC ordena por (atualizado_em, id), então é a
  // última linha da lista.
  const ultima = faltas.at(-1)

  return Response.json(
    {
      faltas,
      // `true` significa que a página encheu: chame de novo com o cursor abaixo
      // antes de considerar a sincronização em dia.
      tem_mais: faltas.length === limite,
      proximo_desde: ultima?.atualizado_em ?? desde,
      proximo_desde_id: ultima?.tita_agendamento_id ?? desdeId,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
