import type { ContactType, ContactStatus, IdentifierType } from '../types/central.types'

type ParseResult<T> = { ok: true; data: T } | { ok: false; errors: string[] }

const E164_RE  = /^\+[1-9]\d{7,14}$/
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const VALID_CONTACT_TYPES: ContactType[] = [
  'guardian', 'patient', 'therapist', 'physician', 'employee', 'lead', 'supplier', 'other',
]
const VALID_CONTACT_STATUSES: ContactStatus[] = ['active', 'unidentified', 'blocked', 'merged']
const VALID_IDENTIFIER_TYPES: IdentifierType[] = [
  'phone', 'email', 'wa_id', 'instagram_id', 'facebook_id',
]

// ----------------------------------------------------------------------------
// List / search contacts
// ----------------------------------------------------------------------------

export interface ListContactsQuery {
  search?:      string
  phone?:       string
  contactType?: ContactType
  limit:        number
  offset:       number
}

export function parseListContactsQuery(p: URLSearchParams): ParseResult<ListContactsQuery> {
  const errors: string[] = []

  const search = p.get('search') ?? undefined
  if (search !== undefined && search.trim().length < 2) errors.push('search deve ter pelo menos 2 caracteres')
  if (search !== undefined && search.length > 200)      errors.push('search excede 200 caracteres')

  const phone = p.get('phone') ?? undefined

  const ctRaw = p.get('contactType') ?? undefined
  let contactType: ContactType | undefined
  if (ctRaw !== undefined) {
    if (!VALID_CONTACT_TYPES.includes(ctRaw as ContactType)) errors.push(`contactType inválido: ${ctRaw}`)
    else contactType = ctRaw as ContactType
  }

  const limit  = clampInt(p.get('limit'),  1, 50, 20)
  const offset = clampInt(p.get('offset'), 0, Infinity, 0)

  if (errors.length) return { ok: false, errors }
  return { ok: true, data: { search: search?.trim(), phone, contactType, limit, offset } }
}

// ----------------------------------------------------------------------------
// Create contact
// ----------------------------------------------------------------------------

export interface CreateContactBody {
  name?:        string
  displayPhone?: string
  displayEmail?: string
  contactType:  ContactType
  source?:      string
  identifiers?: { type: IdentifierType; value: string; isPrimary?: boolean }[]
}

export function parseCreateContactBody(body: unknown): ParseResult<CreateContactBody> {
  const errors: string[] = []
  if (!body || typeof body !== 'object') return { ok: false, errors: ['Body inválido'] }
  const b = body as Record<string, unknown>

  if (b.name !== undefined) {
    if (typeof b.name !== 'string')         errors.push('name deve ser string')
    else if (b.name.length > 255)           errors.push('name excede 255 caracteres')
  }

  if (b.displayPhone !== undefined && !E164_RE.test(b.displayPhone as string)) {
    errors.push('displayPhone deve estar no formato E.164 (ex: +5511999999999)')
  }

  if (b.displayEmail !== undefined && !EMAIL_RE.test(b.displayEmail as string)) {
    errors.push('displayEmail formato inválido')
  }

  const contactType = (b.contactType ?? 'other') as string
  if (!VALID_CONTACT_TYPES.includes(contactType as ContactType)) {
    errors.push(`contactType inválido. Valores: ${VALID_CONTACT_TYPES.join(', ')}`)
  }

  if (Array.isArray(b.identifiers)) {
    ;(b.identifiers as any[]).forEach((ident, i) => {
      if (!VALID_IDENTIFIER_TYPES.includes(ident?.type)) {
        errors.push(`identifiers[${i}].type inválido`)
      }
      if (typeof ident?.value !== 'string' || !ident.value.trim()) {
        errors.push(`identifiers[${i}].value obrigatório`)
      }
    })
  }

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    data: {
      name:         b.name         as string | undefined,
      displayPhone: b.displayPhone as string | undefined,
      displayEmail: b.displayEmail as string | undefined,
      contactType:  contactType    as ContactType,
      source:       b.source       as string | undefined,
      identifiers:  b.identifiers  as CreateContactBody['identifiers'],
    },
  }
}

// ----------------------------------------------------------------------------
// Update contact
// ----------------------------------------------------------------------------

export interface UpdateContactBody {
  name?:         string
  displayPhone?: string
  displayEmail?: string
  contactType?:  ContactType
  status?:       ContactStatus
  // `null` é significativo nestes dois, e por isso o tipo não é só `string`:
  // ausente = "não mexa neste campo"; null = "apague o que está lá". Sem essa
  // distinção não haveria como limpar a origem depois de preenchê-la errado.
  source?:       string | null
  // Substituição TOTAL do array. Não existe "adicionar uma tag": o cliente
  // manda a lista completa que deve valer. Um add incremental, com o polling de
  // 5s no meio, ressuscitaria a tag que o clique anterior tirou.
  tags?:         string[] | null
}

export function parseUpdateContactBody(body: unknown): ParseResult<UpdateContactBody> {
  const errors: string[] = []
  if (!body || typeof body !== 'object') return { ok: false, errors: ['Body inválido'] }
  const b = body as Record<string, unknown>

  if (b.name !== undefined) {
    if (typeof b.name !== 'string') errors.push('name deve ser string')
    else if (b.name.length > 255)   errors.push('name excede 255 caracteres')
  }

  if (b.displayPhone !== undefined && !E164_RE.test(b.displayPhone as string)) {
    errors.push('displayPhone deve estar no formato E.164')
  }

  if (b.displayEmail !== undefined && !EMAIL_RE.test(b.displayEmail as string)) {
    errors.push('displayEmail formato inválido')
  }

  if (b.contactType !== undefined && !VALID_CONTACT_TYPES.includes(b.contactType as ContactType)) {
    errors.push(`contactType inválido`)
  }

  if (b.status !== undefined && !VALID_CONTACT_STATUSES.includes(b.status as ContactStatus)) {
    errors.push(`status inválido`)
  }

  if (b.source !== undefined && b.source !== null) {
    if (typeof b.source !== 'string')  errors.push('source deve ser string ou null')
    else if (b.source.length > 120)    errors.push('source excede 120 caracteres')
  }

  // Só a FORMA é checada aqui. Se cada chave existe no catálogo da organização
  // é pergunta para o banco, e o DTO não tem — nem deve ter — conexão. Essa
  // validação é do TagDefinitionService.
  if (b.tags !== undefined && b.tags !== null) {
    if (!Array.isArray(b.tags)) {
      errors.push('tags deve ser um array de strings ou null')
    } else if (b.tags.some(t => typeof t !== 'string')) {
      errors.push('tags deve conter apenas strings')
    } else if (b.tags.length > 30) {
      // Teto de sanidade: 30 é o dobro do catálogo inteiro. Sem limite, um
      // cliente com defeito escreveria um array de milhares na linha do contato.
      errors.push('tags excede 30 itens')
    }
  }

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    data: {
      name:         b.name         as string | undefined,
      displayPhone: b.displayPhone as string | undefined,
      displayEmail: b.displayEmail as string | undefined,
      contactType:  b.contactType  as ContactType | undefined,
      status:       b.status       as ContactStatus | undefined,
      // `in` e não `?? undefined`: `null` precisa sobreviver até o service, e
      // um `??` o converteria de volta em "não enviado".
      ...('source' in b ? { source: b.source as string | null } : {}),
      ...('tags'   in b ? { tags:   b.tags   as string[] | null } : {}),
    },
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
