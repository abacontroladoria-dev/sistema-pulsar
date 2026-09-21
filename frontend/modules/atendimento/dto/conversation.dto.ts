import { isAIMode } from '../types/central.types'
import type { AIMode, ConversationStatus } from '../types/central.types'

type ParseResult<T> = { ok: true; data: T } | { ok: false; errors: string[] }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUUID    = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)
const isISODate = (v: unknown): v is string => typeof v === 'string' && !isNaN(new Date(v).getTime())

const VALID_STATUSES: ConversationStatus[] = ['open', 'assigned', 'waiting', 'resolved', 'archived']
const VALID_ACTIONS = [
  'assign', 'transfer', 'resolve', 'archive', 'reopen', 'set_ai_mode',
  // Marca d'água de leitura (20260921140000). Nenhuma das duas tem campo
  // próprio: 'mark_read' usa o relógio do servidor e 'mark_unread' deriva o
  // instante da penúltima mensagem do contato. O cliente não escolhe a data —
  // se escolhesse, um relógio adiantado apagaria mensagens que não chegaram.
  'mark_read', 'mark_unread',
] as const
export type PatchAction = typeof VALID_ACTIONS[number]

// ----------------------------------------------------------------------------
// List conversations
// ----------------------------------------------------------------------------

export interface ListConversationsQuery {
  inboxId?:        string
  status?:         ConversationStatus | ConversationStatus[]
  // null = buscar não atribuídas; string UUID = atribuídas ao operador
  assignedUserId?: string | null
  contactId?:      string
  limit:           number
  cursor?:         string
}

export function parseListConversationsQuery(p: URLSearchParams): ParseResult<ListConversationsQuery> {
  const errors: string[] = []

  const inboxId = p.get('inboxId') ?? undefined
  if (inboxId !== undefined && !isUUID(inboxId)) errors.push('inboxId deve ser um UUID válido')

  const statusRaw = p.get('status')
  let status: ConversationStatus | ConversationStatus[] | undefined
  if (statusRaw) {
    const parts = statusRaw.split(',').map(s => s.trim() as ConversationStatus)
    const invalid = parts.filter(s => !VALID_STATUSES.includes(s))
    if (invalid.length) errors.push(`status inválido: ${invalid.join(', ')}`)
    else status = parts.length === 1 ? parts[0] : parts
  }

  const assignedRaw = p.get('assignedUserId')
  let assignedUserId: string | null | undefined
  if (assignedRaw === 'unassigned') {
    assignedUserId = null
  } else if (assignedRaw !== null) {
    if (!isUUID(assignedRaw)) errors.push('assignedUserId deve ser UUID ou "unassigned"')
    else assignedUserId = assignedRaw
  }

  const contactId = p.get('contactId') ?? undefined
  if (contactId !== undefined && !isUUID(contactId)) errors.push('contactId deve ser um UUID válido')

  const limit = clampInt(p.get('limit'), 1, 100, 30)

  const cursor = p.get('cursor') ?? undefined
  if (cursor !== undefined && !isISODate(cursor)) errors.push('cursor deve ser uma data ISO válida')

  if (errors.length) return { ok: false, errors }
  return { ok: true, data: { inboxId, status, assignedUserId, contactId, limit, cursor } }
}

// ----------------------------------------------------------------------------
// Create conversation (manual)
// ----------------------------------------------------------------------------

export interface CreateConversationBody {
  contactId: string
  channelId: string
  inboxId:   string
}

export function parseCreateConversationBody(body: unknown): ParseResult<CreateConversationBody> {
  const errors: string[] = []
  if (!body || typeof body !== 'object') return { ok: false, errors: ['Body inválido'] }
  const b = body as Record<string, unknown>

  if (!isUUID(b.contactId)) errors.push('contactId é obrigatório (UUID)')
  if (!isUUID(b.channelId)) errors.push('channelId é obrigatório (UUID)')
  if (!isUUID(b.inboxId))   errors.push('inboxId é obrigatório (UUID)')

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    data: {
      contactId: b.contactId as string,
      channelId: b.channelId as string,
      inboxId:   b.inboxId   as string,
    },
  }
}

// ----------------------------------------------------------------------------
// Patch conversation (discriminated union por action)
// ----------------------------------------------------------------------------

export type PatchConversationBody =
  // `toUserId: null` devolve a conversa à fila (o "Não atribuído" do painel).
  // Só em `assign`: transferir PARA NINGUÉM não é transferência, é devolução, e
  // as duas ações têm trilhas de auditoria diferentes.
  | { action: 'assign';   toUserId: string | null }
  | { action: 'transfer'; toUserId: string; reason?: string }
  | { action: 'resolve' }
  | { action: 'archive' }
  | { action: 'reopen' }
  // null é um valor LEGÍTIMO, não "não informado": devolve a conversa ao padrão
  // da inbox/organização, em vez de desligar a IA nela. Ver 20260915220000.
  | { action: 'set_ai_mode'; aiMode: AIMode | null }
  | { action: 'mark_read' }
  | { action: 'mark_unread' }

export function parsePatchConversationBody(body: unknown): ParseResult<PatchConversationBody> {
  if (!body || typeof body !== 'object') return { ok: false, errors: ['Body inválido'] }
  const b = body as Record<string, unknown>

  const action = b.action as string
  if (!VALID_ACTIONS.includes(action as PatchAction)) {
    return { ok: false, errors: [`action deve ser um de: ${VALID_ACTIONS.join(', ')}`] }
  }

  if (action === 'assign') {
    // `null` explícito é legítimo (devolver à fila); AUSENTE não é. Sem essa
    // distinção, um corpo malformado desatribuiria a conversa em silêncio.
    if (!('toUserId' in b)) {
      return { ok: false, errors: ['toUserId é obrigatório para assign (use null para devolver à fila)'] }
    }
    if (b.toUserId !== null && !isUUID(b.toUserId)) {
      return { ok: false, errors: ['toUserId deve ser um UUID ou null'] }
    }
  }

  if (action === 'transfer') {
    if (!isUUID(b.toUserId)) {
      return { ok: false, errors: ['toUserId é obrigatório (UUID) para transfer'] }
    }
  }

  if (action === 'set_ai_mode') {
    // `null` explícito no corpo = herdar o padrão. Campo AUSENTE é erro: sem
    // essa distinção, um corpo malformado desligaria a herança em silêncio,
    // que é a diferença entre "esta conversa segue o padrão" e "esta conversa
    // foi decidida" — e essa segunda não pode acontecer por acidente.
    if (!('aiMode' in b)) {
      return { ok: false, errors: ['aiMode é obrigatório para set_ai_mode (use null para herdar o padrão)'] }
    }
    if (b.aiMode !== null && !isAIMode(b.aiMode)) {
      return { ok: false, errors: ['aiMode deve ser off, assisted, autonomous ou null'] }
    }
    return { ok: true, data: { action, aiMode: b.aiMode as AIMode | null } }
  }

  if (action === 'assign') {
    return { ok: true, data: { action, toUserId: b.toUserId as string | null } }
  }
  if (action === 'transfer') {
    return {
      ok: true,
      data: { action, toUserId: b.toUserId as string, reason: b.reason as string | undefined },
    }
  }
  // As ações sem campo próprio. O cast é seguro porque o VALID_ACTIONS já
  // barrou tudo o mais, e as ações com campo saíram acima com `return`.
  return {
    ok: true,
    data: { action: action as 'resolve' | 'archive' | 'reopen' | 'mark_read' | 'mark_unread' },
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  if (raw === null) return fallback
  const n = parseInt(raw, 10)
  return isNaN(n) ? fallback : Math.min(max, Math.max(min, n))
}
