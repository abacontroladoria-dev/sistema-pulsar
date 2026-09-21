import type { NextRequest }        from 'next/server'
import { extractUser }             from '@/lib/central/auth'
import { mapCentralError }         from '@/lib/central/errors'
import { ok, badRequest }          from '@/lib/central/response'
import { parseUpdateContactBody }  from '@/modules/atendimento/dto/contact.dto'
import {
  createContactService,
} from '@/modules/atendimento/services'
import { ContactRepository } from '@/modules/atendimento/repositories/contact.repository'

type Ctx = { params: Promise<{ id: string }> }

// GET /api/central/contacts/[id]
// Retorna contato enriquecido com identificadores e vínculos com pacientes TITA.
export async function GET(_request: NextRequest, ctx: Ctx) {
  try {
    const { user, supabase } = await extractUser()
    const { id } = await ctx.params

    const service    = createContactService(supabase)
    const contactRepo = new ContactRepository(supabase)

    const [contact, identifiers, patientLinks] = await Promise.all([
      service.getById(user.orgId, id),
      contactRepo.listIdentifiers(id),
      contactRepo.findPatientLinks(id),
    ])

    return ok({ contact, identifiers, patientLinks })
  } catch (err) {
    return mapCentralError(err)
  }
}

// PATCH /api/central/contacts/[id]
// Atualiza campos do contato. Todos os campos são opcionais (patch parcial).
export async function PATCH(request: NextRequest, ctx: Ctx) {
  try {
    const { user, supabase } = await extractUser()
    const { id } = await ctx.params

    const body   = await request.json().catch(() => null)
    const parsed = parseUpdateContactBody(body)
    if (!parsed.ok) return badRequest(parsed.errors.join('; '))

    const service = createContactService(supabase)
    const contact = await service.update(user.orgId, id, {
      name:         parsed.data.name,
      displayPhone: parsed.data.displayPhone,
      displayEmail: parsed.data.displayEmail,
      contactType:  parsed.data.contactType,
      status:       parsed.data.status,
      // Espalhados condicionalmente porque `null` significa "limpar" nestes
      // dois campos: passá-los sempre transformaria uma edição só de nome num
      // apagamento silencioso da origem e das tags.
      ...('source' in parsed.data ? { source: parsed.data.source } : {}),
      ...('tags'   in parsed.data ? { tags:   parsed.data.tags   } : {}),
    }, user.id)

    return ok(contact)
  } catch (err) {
    return mapCentralError(err)
  }
}
