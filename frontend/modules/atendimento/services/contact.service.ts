import type {
  Contact,
  ContactType,
  ContactStatus,
  IdentifierType,
  PaginatedResult,
} from '../types/central.types'
import type { ContactRepository, SearchContactsInput } from '../repositories/contact.repository'
import type { AuditRepository } from '../repositories/audit.repository'
// `import type` para não criar dependência de runtime entre dois services.
import type { TagDefinitionService } from './tag-definition.service'
import { ContactNotFoundError, TagDesconhecidaError } from '../types/errors.types'

// ============================================================================
// ContactService
//
// Orquestra CRUD de contatos.
// Regras:
//   1. org mismatch retorna ContactNotFoundError (nunca vaza existência cross-org).
//   2. audit.insert() é fire-and-forget (void) — falha não bloqueia o fluxo.
//   3. Identificadores são upsertados em série após criação do contato.
// ============================================================================

export interface CreateContactInput {
  name?:         string
  displayPhone?: string
  displayEmail?: string
  contactType?:  ContactType
  source?:       string
  identifiers?:  { type: IdentifierType; value: string; isPrimary?: boolean }[]
}

export interface UpdateContactInput {
  name?:         string
  displayPhone?: string
  displayEmail?: string
  contactType?:  ContactType
  status?:       ContactStatus
  // Ausente = não mexer; null = limpar. Ver UpdateContactInput do repositório.
  source?:       string | null
  tags?:         string[] | null
}

export type SearchContactsParams = SearchContactsInput

export class ContactService {
  constructor(
    private readonly contact: ContactRepository,
    private readonly audit:   AuditRepository,
    // Opcional para não quebrar os callers que não gravam tags (o webhook cria
    // contato sem nenhuma). Quando ausente, `update` recusa tags em vez de
    // gravá-las sem conferir — ver o `else` em update().
    private readonly tagDefs?: TagDefinitionService,
  ) {}

  async search(params: SearchContactsParams): Promise<PaginatedResult<Contact>> {
    return this.contact.search(params)
  }

  async create(orgId: string, input: CreateContactInput, actorId: string): Promise<Contact> {
    const contact = await this.contact.create({
      organization_id: orgId,
      name:            input.name,
      display_phone:   input.displayPhone,
      display_email:   input.displayEmail,
      contact_type:    input.contactType ?? 'other',
      source:          input.source,
      is_provisional:  false,
    })

    if (input.identifiers?.length) {
      for (const ident of input.identifiers) {
        await this.contact.upsertIdentifier({
          organization_id:  orgId,
          contact_id:       contact.id,
          identifier_type:  ident.type,
          identifier_value: ident.value,
          is_primary:       ident.isPrimary ?? false,
        })
      }
    }

    void this.audit.insert({
      organization_id: orgId,
      event_type:      'contact.created',
      performed_by:    actorId,
      payload:         { contactId: contact.id, source: input.source ?? null },
    })

    return contact
  }

  async getById(orgId: string, id: string): Promise<Contact> {
    const contact = await this.contact.findById(id)
    if (!contact || contact.organization_id !== orgId) {
      throw new ContactNotFoundError(id)
    }
    return contact
  }

  async update(orgId: string, id: string, input: UpdateContactInput, actorId: string): Promise<Contact> {
    const existing = await this.contact.findById(id)
    if (!existing || existing.organization_id !== orgId) {
      throw new ContactNotFoundError(id)
    }

    // As chaves são conferidas contra o catálogo ATIVO da organização antes de
    // qualquer escrita. A coluna é TEXT[] e o banco aceita qualquer string
    // (decisão da migration 20260701010000, que deixou a validação para esta
    // camada); sem esta linha, um erro de digitação vira uma tag fantasma que
    // não aparece em filtro nenhum e que a tela não consegue remover, porque a
    // tela só oferece o que está no catálogo.
    // Falha FECHADA: sem o catálogo injetado, gravar sem conferir seria pior do
    // que recusar — a tag inválida entra calada e só aparece meses depois.
    let tags = input.tags
    if (input.tags != null) {
      if (!this.tagDefs) throw new TagDesconhecidaError(input.tags)
      tags = await this.tagDefs.validarChaves(orgId, input.tags)
    }

    const updated = await this.contact.update(id, {
      name:          input.name,
      display_phone: input.displayPhone,
      display_email: input.displayEmail,
      contact_type:  input.contactType,
      status:        input.status,
      // Só entram no patch se vieram no input. Passá-los sempre colocaria
      // `source: undefined` e `tags: undefined` em TODA atualização — o
      // repositório os filtra por `!== undefined`, então o banco ficaria certo,
      // mas o patch deixaria de descrever o que a chamada realmente pediu, e
      // qualquer código que passasse a olhar suas chaves (log, auditoria, um
      // upsert futuro) apagaria campo que ninguém mandou apagar.
      ...('source' in input ? { source: input.source } : {}),
      ...('tags'   in input ? { tags }                 : {}),
    })

    void this.audit.insert({
      organization_id: orgId,
      event_type:      'contact.updated',
      performed_by:    actorId,
      // Nomear os campos alterados: "contact.updated" sozinho não distingue uma
      // correção de telefone de uma troca de tags, e a trilha existe para
      // responder o que mudou.
      payload:         { contactId: id, campos: Object.keys(input) },
    })

    return updated
  }
}
