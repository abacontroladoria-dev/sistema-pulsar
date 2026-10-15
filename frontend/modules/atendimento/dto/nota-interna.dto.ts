import type { FiltroMencoes } from '../repositories/mencao.repository'

// ============================================================================
// DTOs das notas internas e menções
//
// Parsers manuais, como o resto do módulo (sem Zod). O que NUNCA aparece aqui:
// organização, autor, e de quem é a menção — vêm da sessão validada
// (extractUser). Aceitá-los do corpo deixaria escrever nota em nome de outra
// pessoa ou marcar como lida a menção de uma colega.
// ============================================================================

type ParseResult<T> = { ok: true; data: T } | { ok: false; errors: string[] }

const isUUID = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

// O banco recusa acima disto (ck_conversation_notes_body). Barrar aqui dá 400
// com mensagem legível em vez de 500.
export const MAX_CARACTERES_NOTA = 4000

// Uma nota avisa um punhado de colegas, não a equipe inteira.
const MAX_MENCOES = 10

// ----------------------------------------------------------------------------
// POST /api/central/conversations/[id]/notas
// ----------------------------------------------------------------------------

export interface CriarNotaBody {
  body:        string
  mencoes:     string[]
  delegarPara: string | null
}

export function parseCriarNotaBody(raw: unknown): ParseResult<CriarNotaBody> {
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['corpo JSON obrigatório'] }
  const b = raw as Record<string, unknown>
  const errors: string[] = []

  const body = typeof b.body === 'string' ? b.body.trim() : ''
  if (!body) errors.push('A nota está vazia.')
  if (body.length > MAX_CARACTERES_NOTA) {
    errors.push(`A nota tem ${body.length} caracteres; o limite é ${MAX_CARACTERES_NOTA}.`)
  }

  const mencoes = b.mencoes ?? []
  if (!Array.isArray(mencoes) || !mencoes.every(isUUID)) {
    errors.push('mencoes deve ser uma lista de ids de usuário')
  } else if (mencoes.length > MAX_MENCOES) {
    errors.push(`Uma nota menciona no máximo ${MAX_MENCOES} pessoas.`)
  }

  const delegarPara = b.delegarPara ?? null
  if (delegarPara !== null && !isUUID(delegarPara)) errors.push('delegarPara deve ser um id de usuário')

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    data: { body, mencoes: mencoes as string[], delegarPara: delegarPara as string | null },
  }
}

// ----------------------------------------------------------------------------
// GET /api/central/mencoes
// ----------------------------------------------------------------------------

export interface ListarMencoesQuery {
  filtro:   FiltroMencoes
  limit:    number
  antesDe?: string
}

const FILTROS: FiltroMencoes[] = ['nao_lidas', 'lidas', 'todas']

export function parseListarMencoesQuery(p: URLSearchParams): ParseResult<ListarMencoesQuery> {
  const errors: string[] = []

  const filtro = (p.get('status') ?? 'todas') as FiltroMencoes
  if (!FILTROS.includes(filtro)) errors.push(`status deve ser um de: ${FILTROS.join(', ')}`)

  const antesDe = p.get('before') ?? undefined
  if (antesDe !== undefined && Number.isNaN(new Date(antesDe).getTime())) {
    errors.push('before deve ser uma data ISO')
  }

  const n = Number.parseInt(p.get('limit') ?? '', 10)
  const limit = Number.isFinite(n) ? Math.min(Math.max(n, 1), 100) : 30

  if (errors.length) return { ok: false, errors }
  return { ok: true, data: { filtro, limit, antesDe } }
}

// ----------------------------------------------------------------------------
// PATCH /api/central/mencoes/[id]   { lida: boolean }
// POST  /api/central/mencoes/lidas  { conversationId } | { todas: true }
// ----------------------------------------------------------------------------

export function parseMarcarMencaoBody(raw: unknown): ParseResult<{ lida: boolean }> {
  const lida = (raw as Record<string, unknown> | null)?.lida
  if (typeof lida !== 'boolean') return { ok: false, errors: ['lida deve ser true ou false'] }
  return { ok: true, data: { lida } }
}

// `noteIds` (opcional, junto de conversationId): só as menções destas notas.
export function parseMarcarLidasBody(
  raw: unknown,
): ParseResult<{ conversationId?: string; noteIds?: string[] }> {
  const b = (raw ?? {}) as Record<string, unknown>
  if (b.todas === true) return { ok: true, data: {} }
  if (!isUUID(b.conversationId)) return { ok: false, errors: ['informe conversationId ou todas: true'] }
  if (b.noteIds === undefined) return { ok: true, data: { conversationId: b.conversationId } }
  if (!Array.isArray(b.noteIds) || !b.noteIds.every(isUUID) || b.noteIds.length > 100) {
    return { ok: false, errors: ['noteIds deve ser uma lista de ids de nota'] }
  }
  return { ok: true, data: { conversationId: b.conversationId, noteIds: b.noteIds as string[] } }
}
