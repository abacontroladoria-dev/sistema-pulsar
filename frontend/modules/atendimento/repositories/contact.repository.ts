import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Contact,
  ContactIdentifier,
  ContactPatientLink,
  ContactType,
  ContactStatus,
  IdentifierType,
  RelationshipType,
  ResolvedBy,
} from '../types/central.types'

// ============================================================================
// ContactRepository
//
// Acesso às tabelas:
//   central.contacts              — entidade principal
//   central.contact_identifiers   — identificadores (phone, email, wa_id, etc)
//   central.contact_patient_links — vínculos com pacientes do TITA
//
// Hot path de desempenho:
//   findByIdentifier() é chamado em TODA mensagem inbound.
//   Usa dois lookups indexados sequenciais (sem JOIN) por confiabilidade:
//     1. contact_identifiers → uq_identifier_global (unique constraint implícito)
//     2. contacts            → idx_contacts_not_deleted + is null filters
//
// Indexes utilizados (migration 20260701000400):
//   findByIdentifier    → uq_identifier_global (contact_identifiers)
//                       → idx_contacts_not_deleted (contacts)
//   findById            → PK lookup
//   createPatientLink   → uq_contact_patient (upsert DO NOTHING)
// ============================================================================

export interface CreateContactInput {
  organization_id: string
  name?:           string
  display_phone?:  string
  display_email?:  string
  contact_type?:   ContactType    // default 'other'
  status?:         ContactStatus  // default 'active'
  source?:         string
  is_provisional?: boolean        // default false
}

export interface UpdateContactInput {
  name?:          string
  display_phone?: string
  display_email?: string
  contact_type?:  ContactType
  status?:        ContactStatus
  // `null` grava NULL na coluna; ausente deixa como está. O `update()` abaixo
  // testa `!== undefined` justamente para manter essa diferença — é o que
  // permite LIMPAR a origem de um contato, e não só sobrescrevê-la.
  source?:        string | null
  tags?:          string[] | null
  is_provisional?:boolean
}

export interface UpsertIdentifierInput {
  organization_id:  string
  contact_id:       string
  identifier_type:  IdentifierType
  identifier_value: string
  is_primary?:      boolean
}

export interface CreatePatientLinkInput {
  organization_id:   string
  contact_id:        string
  tita_paciente_id:  number
  relationship_type?:RelationshipType
  confidence_score?: number
  resolved_by?:      ResolvedBy
  created_by?:       string
}

export interface SearchContactsInput {
  orgId:        string
  search?:      string    // ILIKE em name + display_phone
  phone?:       string    // ILIKE adicional em display_phone
  contactType?: ContactType
  limit?:       number    // default 20
  offset?:      number    // default 0
}

export class ContactRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  // Busca paginada com filtros opcionais de texto e tipo.
  // Usado pela contacts API e pela search API.
  async search(params: SearchContactsInput): Promise<{ data: Contact[]; count: number }> {
    const limit  = params.limit  ?? 20
    const offset = params.offset ?? 0

    let query = (this.supabase as any)
      .schema('central')
      .from('contacts')
      .select('*', { count: 'exact' })
      .eq('organization_id', params.orgId)
      .is('deleted_at', null)
      .order('name', { ascending: true, nullsFirst: false })
      .range(offset, offset + limit - 1)

    if (params.search) {
      query = query.or(
        `name.ilike.%${params.search}%,display_phone.ilike.%${params.search}%`
      )
    }

    if (params.phone) {
      query = query.ilike('display_phone', `%${params.phone}%`)
    }

    if (params.contactType) {
      query = query.eq('contact_type', params.contactType)
    }

    const { data, count, error } = await query
    if (error) throw error
    return { data: (data ?? []) as Contact[], count: count ?? 0 }
  }

  async findById(id: string): Promise<Contact | null> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('contacts')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()

    if (error) throw error
    return (data ?? null) as Contact | null
  }

  // Hot path: resolve contato a partir de um identificador bruto.
  // Dois lookups sequenciais para evitar ambiguidade de filtros em JOINs
  // via Supabase JS com schema customizado.
  async findByIdentifier(
    value: string,
    type:  IdentifierType,
    orgId: string
  ): Promise<Contact | null> {
    // Passo 1: localizar o contact_id via índice único do identificador
    const { data: identifier, error: idErr } = await (this.supabase as any)
      .schema('central')
      .from('contact_identifiers')
      .select('contact_id')
      .eq('organization_id', orgId)
      .eq('identifier_type', type)
      .eq('identifier_value', value)
      .maybeSingle()

    if (idErr) throw idErr
    if (!identifier) return null

    // Passo 2: validar que o contato está ativo e não foi fundido com outro
    const { data: contact, error: cErr } = await (this.supabase as any)
      .schema('central')
      .from('contacts')
      .select('*')
      .eq('id', (identifier as Record<string, string>)['contact_id'])
      .is('deleted_at', null)
      .is('merged_into_contact_id', null)
      .maybeSingle()

    if (cErr) throw cErr
    return (contact ?? null) as Contact | null
  }

  async create(input: CreateContactInput): Promise<Contact> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('contacts')
      .insert({
        organization_id: input.organization_id,
        name:            input.name           ?? null,
        display_phone:   input.display_phone  ?? null,
        display_email:   input.display_email  ?? null,
        contact_type:    input.contact_type   ?? 'other',
        status:          input.status         ?? 'active',
        source:          input.source         ?? null,
        is_provisional:  input.is_provisional ?? false,
      })
      .select()
      .single()

    if (error) throw error
    return data as Contact
  }

  async update(id: string, input: UpdateContactInput): Promise<Contact> {
    const patch: Record<string, unknown> = {}
    if (input.name           !== undefined) patch.name           = input.name
    if (input.display_phone  !== undefined) patch.display_phone  = input.display_phone
    if (input.display_email  !== undefined) patch.display_email  = input.display_email
    if (input.contact_type   !== undefined) patch.contact_type   = input.contact_type
    if (input.status         !== undefined) patch.status         = input.status
    if (input.source         !== undefined) patch.source         = input.source
    if (input.tags           !== undefined) patch.tags           = input.tags
    if (input.is_provisional !== undefined) patch.is_provisional = input.is_provisional

    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('contacts')
      .update(patch)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data as Contact
  }

  // INSERT ... ON CONFLICT (contact_id, identifier_type, identifier_value) DO UPDATE
  // Mantém is_primary atualizado sem violar a constraint uq_identifier_per_contact.
  async upsertIdentifier(input: UpsertIdentifierInput): Promise<ContactIdentifier> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('contact_identifiers')
      .upsert(
        {
          organization_id:  input.organization_id,
          contact_id:       input.contact_id,
          identifier_type:  input.identifier_type,
          identifier_value: input.identifier_value,
          is_primary:       input.is_primary ?? false,
        },
        { onConflict: 'contact_id,identifier_type,identifier_value' }
      )
      .select()
      .single()

    if (error) throw error
    return data as ContactIdentifier
  }

  async listIdentifiers(contactId: string): Promise<ContactIdentifier[]> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('contact_identifiers')
      .select('*')
      .eq('contact_id', contactId)
      .order('is_primary', { ascending: false })

    if (error) throw error
    return (data ?? []) as ContactIdentifier[]
  }

  // ON CONFLICT (contact_id, tita_paciente_id) DO NOTHING — idempotente.
  // Retorna null se o vínculo já existia (sem erro).
  async createPatientLink(input: CreatePatientLinkInput): Promise<ContactPatientLink | null> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('contact_patient_links')
      .upsert(
        {
          organization_id:  input.organization_id,
          contact_id:       input.contact_id,
          tita_paciente_id: input.tita_paciente_id,
          relationship_type:input.relationship_type ?? null,
          confidence_score: input.confidence_score  ?? null,
          resolved_by:      input.resolved_by       ?? null,
          created_by:       input.created_by        ?? null,
        },
        { onConflict: 'contact_id,tita_paciente_id', ignoreDuplicates: true }
      )
      .select()
      .maybeSingle()

    if (error) throw error
    return (data ?? null) as ContactPatientLink | null
  }

  async findPatientLinks(contactId: string): Promise<ContactPatientLink[]> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('contact_patient_links')
      .select('*')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return (data ?? []) as ContactPatientLink[]
  }

  // Deduplicação: marca o contato de origem como fundido e aponta para o destino.
  // Após este UPDATE, findByIdentifier ignora o contato de origem
  // (filtro is null merged_into_contact_id no Passo 2).
  async markMerged(sourceId: string, targetId: string): Promise<void> {
    const { error } = await (this.supabase as any)
      .schema('central')
      .from('contacts')
      .update({
        merged_into_contact_id: targetId,
        status:                 'merged',
      })
      .eq('id', sourceId)

    if (error) throw error
  }
}
