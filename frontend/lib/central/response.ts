import { NextResponse } from 'next/server'

// Central API — response helpers
// Use these instead of raw NextResponse.json() in every route handler.

export function ok<T>(
  data: T,
  pagination?: {
    total?: number
    limit: number
    hasMore: boolean
    nextCursor?: string
    offset?: number
  },
  // Campos soltos no corpo, ao lado de `data` e `pagination`. Existe para o
  // contexto que a resposta precisa carregar mas não é nem linha nem paginação
  // — hoje só o `modoPadrao` de /conversations, que o cliente precisa para
  // resolver a herança do ai_mode e não tem como saber sozinho.
  //
  // Fora de `pagination` de propósito: aquele objeto é compartilhado por todas
  // as rotas da Central, e enfiar nele um conceito de uma rota só o faria
  // prometer a todas um campo que quase nenhuma preenche.
  extra?: Record<string, unknown>
): NextResponse {
  const body: Record<string, unknown> = { data }
  if (pagination) body.pagination = pagination
  if (extra) Object.assign(body, extra)
  return NextResponse.json(body, { status: 200 })
}

export function created<T>(data: T): NextResponse {
  return NextResponse.json({ data }, { status: 201 })
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 })
}

export function badRequest(message: string, field?: string): NextResponse {
  const error: Record<string, unknown> = { code: 'VALIDATION_ERROR', message }
  if (field) error.field = field
  return NextResponse.json({ error }, { status: 400 })
}

export function unauthorized(message = 'Sessão inválida ou expirada'): NextResponse {
  return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message } }, { status: 401 })
}

export function forbidden(message = 'Acesso negado'): NextResponse {
  return NextResponse.json({ error: { code: 'FORBIDDEN', message } }, { status: 403 })
}

export function notFound(code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status: 404 })
}

export function conflict(code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status: 409 })
}

export function unprocessable(code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status: 422 })
}

export function badGateway(code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status: 502 })
}

export function serviceUnavailable(code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status: 503 })
}

export function internalError(): NextResponse {
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
    { status: 500 }
  )
}
