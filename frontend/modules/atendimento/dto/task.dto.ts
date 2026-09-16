import type { TaskStatus } from '../types/central.types'

// ============================================================================
// DTOs de central.tasks
//
// Parsers manuais, como o resto do módulo (sem Zod). O que NUNCA aparece aqui:
// `organizationId`, `createdBy` e `status` na criação. Os dois primeiros vêm da
// sessão validada; o terceiro é sempre 'pending' num INSERT. Aceitá-los do
// corpo deixaria o cliente escrever tarefa em nome de outra organização — a
// policy barraria, mas o erro chegaria como 500 em vez de 400, e a intenção do
// contrato ficaria dependendo do banco para valer.
// ============================================================================

type ParseResult<T> = { ok: true; data: T } | { ok: false; errors: string[] }

const isUUID = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

const isISO = (v: unknown): v is string =>
  typeof v === 'string' && !Number.isNaN(new Date(v).getTime())

const VALID_STATUSES: TaskStatus[] = ['pending', 'done', 'cancelled']

// ----------------------------------------------------------------------------
// GET /api/central/tasks
// ----------------------------------------------------------------------------

export interface ListTasksQuery {
  contactId?:      string
  conversationId?: string
  status?:         TaskStatus
  limit:           number
  offset:          number
}

export function parseListTasksQuery(p: URLSearchParams): ParseResult<ListTasksQuery> {
  const errors: string[] = []

  const contactId = p.get('contactId') ?? undefined
  if (contactId !== undefined && !isUUID(contactId)) errors.push('contactId deve ser um UUID válido')

  const conversationId = p.get('conversationId') ?? undefined
  if (conversationId !== undefined && !isUUID(conversationId)) {
    errors.push('conversationId deve ser um UUID válido')
  }

  const statusRaw = p.get('status')
  let status: TaskStatus | undefined
  if (statusRaw !== null) {
    if (!VALID_STATUSES.includes(statusRaw as TaskStatus)) {
      errors.push(`status deve ser um de: ${VALID_STATUSES.join(', ')}`)
    } else {
      status = statusRaw as TaskStatus
    }
  }

  const limit  = clampInt(p.get('limit'), 1, 100, 50)
  const offset = clampInt(p.get('offset'), 0, 10_000, 0)

  if (errors.length) return { ok: false, errors }
  return { ok: true, data: { contactId, conversationId, status, limit, offset } }
}

// ----------------------------------------------------------------------------
// POST /api/central/tasks
// ----------------------------------------------------------------------------

export interface CreateTaskBody {
  title:           string
  description?:    string | null
  contactId?:      string
  conversationId?: string
  assignedUserId?: string | null
  dueAt?:          string | null
}

export function parseCreateTaskBody(body: unknown): ParseResult<CreateTaskBody> {
  const errors: string[] = []
  if (!body || typeof body !== 'object') return { ok: false, errors: ['Body inválido'] }
  const b = body as Record<string, unknown>

  if (typeof b.title !== 'string' || b.title.trim() === '') {
    errors.push('title é obrigatório')
  } else if (b.title.length > 255) {
    errors.push('title excede 255 caracteres')
  }

  if (b.description !== undefined && b.description !== null && typeof b.description !== 'string') {
    errors.push('description deve ser string ou null')
  }

  if (b.contactId !== undefined && !isUUID(b.contactId)) {
    errors.push('contactId deve ser um UUID válido')
  }
  if (b.conversationId !== undefined && !isUUID(b.conversationId)) {
    errors.push('conversationId deve ser um UUID válido')
  }
  // Espelha ck_tasks_vinculo. Barrar aqui devolve 400 com a explicação em vez
  // de deixar o banco responder 500 por violação de CHECK.
  if (b.contactId === undefined && b.conversationId === undefined) {
    errors.push('informe contactId ou conversationId — a tarefa precisa de um vínculo')
  }

  if (b.assignedUserId !== undefined && b.assignedUserId !== null && !isUUID(b.assignedUserId)) {
    errors.push('assignedUserId deve ser um UUID ou null')
  }

  if (b.dueAt !== undefined && b.dueAt !== null && !isISO(b.dueAt)) {
    errors.push('dueAt deve ser uma data ISO válida ou null')
  }

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    data: {
      title:          (b.title as string).trim(),
      description:    b.description    as string | null | undefined,
      contactId:      b.contactId      as string | undefined,
      conversationId: b.conversationId as string | undefined,
      assignedUserId: b.assignedUserId as string | null | undefined,
      dueAt:          b.dueAt          as string | null | undefined,
    },
  }
}

// ----------------------------------------------------------------------------
// PATCH /api/central/tasks/[id]
// ----------------------------------------------------------------------------

export type PatchTaskBody =
  | { action: 'complete' }
  | { action: 'reopen' }
  | { action: 'cancel' }
  | {
      action: 'update'
      title?:          string
      description?:    string | null
      assignedUserId?: string | null
      dueAt?:          string | null
    }

const VALID_ACTIONS = ['complete', 'reopen', 'cancel', 'update'] as const

export function parsePatchTaskBody(body: unknown): ParseResult<PatchTaskBody> {
  if (!body || typeof body !== 'object') return { ok: false, errors: ['Body inválido'] }
  const b = body as Record<string, unknown>

  const action = b.action
  if (typeof action !== 'string' || !VALID_ACTIONS.includes(action as any)) {
    return { ok: false, errors: [`action deve ser um de: ${VALID_ACTIONS.join(', ')}`] }
  }

  if (action !== 'update') {
    return { ok: true, data: { action: action as 'complete' | 'reopen' | 'cancel' } }
  }

  const errors: string[] = []

  if (b.title !== undefined) {
    if (typeof b.title !== 'string' || b.title.trim() === '') errors.push('title não pode ser vazio')
    else if (b.title.length > 255)                            errors.push('title excede 255 caracteres')
  }
  if (b.description !== undefined && b.description !== null && typeof b.description !== 'string') {
    errors.push('description deve ser string ou null')
  }
  if (b.assignedUserId !== undefined && b.assignedUserId !== null && !isUUID(b.assignedUserId)) {
    errors.push('assignedUserId deve ser um UUID ou null')
  }
  if (b.dueAt !== undefined && b.dueAt !== null && !isISO(b.dueAt)) {
    errors.push('dueAt deve ser uma data ISO válida ou null')
  }

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    data: {
      action: 'update',
      // `in` e não `??`: null é "limpar" nestes campos, e um `??` o devolveria
      // a undefined ("não mexer") — tirando a única forma de remover um prazo.
      ...(b.title          !== undefined ? { title: (b.title as string).trim() } : {}),
      ...('description'    in b ? { description:    b.description    as string | null } : {}),
      ...('assignedUserId' in b ? { assignedUserId: b.assignedUserId as string | null } : {}),
      ...('dueAt'          in b ? { dueAt:          b.dueAt          as string | null } : {}),
    },
  }
}

// ----------------------------------------------------------------------------

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  if (raw === null) return fallback
  const n = Number.parseInt(raw, 10)
  if (Number.isNaN(n)) return fallback
  return Math.min(Math.max(n, min), max)
}
