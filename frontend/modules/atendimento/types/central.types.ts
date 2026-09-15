// ============================================================================
// Central de Atendimento — Core Types
//
// Fonte de verdade para todos os tipos da camada de domínio.
// Derivados diretamente das migrations SQL — qualquer alteração no banco
// deve ser refletida aqui antes de atualizar repositories e services.
//
// Migrations de referência:
//   20260701000100_create_ca_enums.sql      → enums
//   20260701000200_create_ca_inboxes.sql    → Inbox, InboxMember
//   20260701000300_create_ca_channels.sql   → Channel, ChannelConnection
//   20260701000400_create_ca_contacts.sql   → Contact, ContactIdentifier, ContactPatientLink
//   20260701000500_create_ca_conversations.sql → Conversation
//   20260701000600_create_ca_messages.sql   → Message, MessageAttachment
// ============================================================================

// ----------------------------------------------------------------------------
// Enums — espelham central.*_type e central.*_status do PostgreSQL
// ----------------------------------------------------------------------------

// As três unidades físicas da clínica.
//
// Não é enum do Postgres: a unidade não existe como dado na grade do TiTa
// (unidade_id é 280 e unidade_nome é 'CLÍNICA UNIVERSO ABA' em toda linha). Ela
// é DERIVADA do prefixo de sala_nome pela view central.vw_vagas_livres
// (20260904100000), e `central.listar_vagas_disponiveis` valida `p_unidade`
// contra exatamente estes três literais — passar outro LANÇA 22023.
//
// Mora aqui, e não em agente/unidade.ts, porque três superfícies precisam
// concordar com o banco: o enum do schema de function calling, a validação de
// query da rota HTTP e o tipo VagaDisponivel. A camada de tipos não pode
// depender da camada do agente. `agente/unidade.ts` reexporta e acrescenta as
// funções de normalização.
export const UNIDADES = ['Realengo', 'Fazendinha', 'Padre Miguel'] as const
export type Unidade = typeof UNIDADES[number]

export type ConversationStatus =
  | 'open'
  | 'assigned'
  | 'waiting'
  | 'resolved'
  | 'archived'

export type ContactType =
  | 'guardian'
  | 'patient'
  | 'therapist'
  | 'physician'
  | 'employee'
  | 'lead'
  | 'supplier'
  | 'other'

export type ProviderType =
  | 'evolution'
  | 'meta_waba'
  | 'instagram'

// Autonomia do agente. Espelha central.agent_settings.ai_mode e o CHECK
// ck_agent_settings_ai_mode (migration 20260811100000).
//
//   off        → o agente não é acionado; nenhuma chamada ao LLM acontece
//   assisted   → o agente responde, a resposta fica como rascunho e NÃO sai
//   autonomous → o agente responde e a resposta é enfileirada para envio
//
// Este eixo NÃO escolhe modelo. O modelo é OPENAI_MODEL, variável de runtime
// validada em modules/atendimento/llm/modelo.ts. Foram deliberadamente
// separados: a coluna antiga `ai_model_mode` misturava os dois e fazia a
// escolha de modelo acontecer em silêncio.
//
// O array vem antes do tipo para haver uma allowlist verificável em runtime —
// tipo derivado do valor garante que os dois não divirjam.
export const AI_MODES = ['off', 'assisted', 'autonomous'] as const

export type AIMode = typeof AI_MODES[number]

export function isAIMode(valor: unknown): valor is AIMode {
  return typeof valor === 'string' && (AI_MODES as readonly string[]).includes(valor)
}

export type NotificationPriority =
  | 'low'
  | 'medium'
  | 'high'
  | 'critical'

export type ChannelStatus =
  | 'active'
  | 'connecting'
  | 'disconnected'
  | 'error'
  | 'suspended'

// Derivados de constraints text das colunas (documentados nos comentários SQL)
export type MessageDirection = 'inbound' | 'outbound'

export type MessageStatus =
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'deleted'

export type StorageStatus = 'pending' | 'stored' | 'failed'

export type ContactStatus = 'active' | 'unidentified' | 'blocked' | 'merged'

export type IdentifierType =
  | 'phone'
  | 'email'
  | 'wa_id'
  | 'instagram_id'
  | 'facebook_id'

export type ResolvedBy = 'automatic' | 'manual' | 'ai'

export type RelationshipType =
  | 'guardian'
  | 'mother'
  | 'father'
  | 'grandmother'
  | 'grandfather'
  | 'sibling'
  | 'self'
  | 'caregiver'
  | 'other'

// ----------------------------------------------------------------------------
// Entidades — mirror exato das colunas do banco
// ----------------------------------------------------------------------------

export interface Conversation {
  id:               string
  organization_id:  string
  inbox_id:         string
  channel_id:       string
  contact_id:       string
  assigned_user_id: string | null
  status:           ConversationStatus
  priority:         string | null
  intent:           string | null
  sentiment:        string | null
  // NULL = ninguém decidiu nada nesta conversa; vale o ai_mode de
  // agent_settings (inbox vence org). Ver 20260915220000: a coluna deixou de
  // ser `not null default 'off'` justamente porque "nunca foi tocada" e
  // "desligada de propósito" precisam ser distinguíveis — sem isso, o padrão da
  // organização não alcançaria conversa nenhuma.
  ai_mode:          AIMode | null
  last_message_at:  string | null
  resolved_at:      string | null
  archived_at:      string | null
  created_at:       string
  updated_at:       string
}

export interface Message {
  id:                  string
  organization_id:     string
  conversation_id:     string
  external_message_id: string | null
  direction:           MessageDirection
  message_type:        string
  body:                string | null
  // Coluna 'provider' (não provider_type) — espelha central.provider_type enum
  provider:            ProviderType | null
  sent_by_user_id:     string | null
  sent_by_ai:          boolean
  reply_to_message_id: string | null
  status:              MessageStatus
  sent_at:             string | null
  deleted_at:          string | null
  created_at:          string
  updated_at:          string
  // Relacionamento expandido opcionalmente por listByConversation
  attachments?:        MessageAttachment[]
}

export interface MessageAttachment {
  id:              string
  organization_id: string
  message_id:      string
  file_name:       string | null
  file_type:       string | null
  file_size:       number | null
  storage_path:    string | null
  external_url:    string | null
  storage_status:  StorageStatus
  duration_secs:   number | null
  thumbnail_path:  string | null
  created_at:      string
  updated_at:      string
}

export interface Contact {
  id:                     string
  organization_id:        string
  name:                   string | null
  display_phone:          string | null
  display_email:          string | null
  contact_type:           ContactType
  status:                 ContactStatus
  source:                 string | null
  avatar_url:             string | null
  is_provisional:         boolean
  merged_into_contact_id: string | null
  last_interaction_at:    string | null
  deleted_at:             string | null
  created_at:             string
  updated_at:             string
}

export interface ContactIdentifier {
  id:               string
  organization_id:  string
  contact_id:       string
  identifier_type:  IdentifierType
  identifier_value: string
  is_primary:       boolean
  created_at:       string
}

export interface ContactPatientLink {
  id:               string
  organization_id:  string
  contact_id:       string
  // BIGINT no banco → number no TypeScript (não UUID)
  tita_paciente_id: number
  relationship_type:RelationshipType | null
  confidence_score: number | null
  resolved_by:      ResolvedBy | null
  resolved_at:      string | null
  created_by:       string | null
  created_at:       string
}

export interface Channel {
  id:              string
  organization_id: string
  inbox_id:        string
  name:            string
  // Coluna 'provider' (não provider_type) — espelha central.provider_type enum
  provider:        ProviderType
  channel_type:    string
  status:          ChannelStatus
  active:          boolean
  created_at:      string
  updated_at:      string
}

export interface ChannelConnection {
  id:                   string
  organization_id:      string
  channel_id:           string
  external_id:          string | null
  provider_instance_id: string | null
  provider_account_id:  string | null
  provider_metadata:    Record<string, unknown> | null
  connection_status:    ChannelStatus
  last_sync_at:         string | null
  created_at:           string
  updated_at:           string
}

// ----------------------------------------------------------------------------
// Provider abstraction — interface do contrato de mensageria
// Implementações: EvolutionProvider (Sprint 2), MetaWabaProvider (Sprint 3)
// ----------------------------------------------------------------------------

export interface ProviderSendInput {
  to:          string     // número E.164 ou wa_id do contato
  body?:       string
  messageType: string
  mediaUrl?:   string
  caption?:    string
  fileName?:   string
  replyToId?:  string    // external_message_id da mensagem citada
}

export interface ProviderSendResult {
  externalId: string
  status:     MessageStatus
  sentAt:     string
}

export interface NormalizedIncomingMessage {
  externalMessageId:  string
  from:               string   // número E.164 ou wa_id
  body?:              string
  messageType:        string
  sentAt?:            string
  replyToExternalId?: string
  attachments?: {
    externalUrl:  string
    fileType?:    string
    fileName?:    string
    fileSize?:    number
    durationSecs?:number
  }[]
}

export interface MessagingProvider {
  sendMessage(channel: Channel, input: ProviderSendInput): Promise<ProviderSendResult>
  sendMedia(channel: Channel, input: ProviderSendInput): Promise<ProviderSendResult>
  getStatus(channel: Channel): Promise<ChannelStatus>
  processWebhook(raw: unknown): Promise<NormalizedIncomingMessage>
}

// Contrato mínimo que MessageService exige do factory.
// ProviderFactory (services/index.ts) implementa este contrato.
// Evita dependência circular entre message.service.ts e services/index.ts.
export interface ProviderResolver {
  get(type: ProviderType): MessagingProvider
}

// ----------------------------------------------------------------------------
// Agendamentos
// ----------------------------------------------------------------------------

// Espelha central.appointment_type (migration 20260701010000).
// Adaptado do Nina comercial (demo/meeting/support/followup) para clínico.
export type AppointmentType =
  | 'triagem'
  | 'retorno'
  | 'reuniao'
  | 'followup'
  | 'demo'
  | 'other'

// Espelha ck_appointments_status (migration 20260810100000).
// scheduled e confirmed OCUPAM a vaga; cancelled e no_show a liberam.
export type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'no_show'

// Status que ocupam a vaga — mesma lista do predicado de uq_appointments_slot_ocupada.
// Exportada para que a checagem no TypeScript nunca divirja da do banco.
export const STATUS_QUE_OCUPAM_VAGA: readonly AppointmentStatus[] = ['scheduled', 'confirmed']

export interface Appointment {
  id:                string
  organization_id:   string
  contact_id:        string | null
  conversation_id:   string | null
  title:             string
  description:       string | null
  // date: 'YYYY-MM-DD'. time: 'HH:MM:SS' (Postgres time, sem fuso).
  date:              string
  time:              string | null
  duration:          number | null
  type:              AppointmentType
  attendees:         string[] | null
  meeting_url:       string | null
  status:            AppointmentStatus
  // Preenchido só depois que a sessão é criada no TiTa — não serve para reservar.
  tita_session_id:   number | null
  created_by_ai:     boolean
  // Identidade da vaga (migration 20260810100000)
  profissional_id:   number | null
  profissional_nome: string | null
  terapia_id:        number | null
  terapia_nome:      string | null
  unidade_id:        number | null
  sala_nome:         string | null
  tita_paciente_id:  number | null
  created_at:        string
  updated_at:        string
}

// Retorno de central.listar_vagas_disponiveis.
// Não é uma tabela: é a grade do TiTa menos o que já prometemos.
export interface VagaDisponivel {
  data:              string
  dia_semana:        string | null
  hora_inicial:      string
  hora_final:        string | null
  profissional_id:   number
  profissional_nome: string | null
  terapia_id:        number | null
  terapia_nome:      string | null
  // Estes dois NÃO distinguem endereço: unidade_id é 280 e unidade_nome é
  // 'CLÍNICA UNIVERSO ABA' em toda linha da grade. Ficam porque a RPC os
  // devolve; para saber a unidade, use `unidade`.
  unidade_id:        number | null
  unidade_nome:      string | null
  sala_nome:         string | null
  // A unidade física, derivada do prefixo de sala_nome pela view
  // central.vw_vagas_livres (20260904100000). É o único campo que separa
  // Realengo de Fazendinha de Padre Miguel. Null não deveria ocorrer aqui — a
  // view só devolve linhas com uma das três — mas o tipo admite porque a coluna
  // é derivada e não tem NOT NULL.
  unidade:           Unidade | null
  // Sala física numerada ('Unid. Realengo - Sala 20') vs. papel na unidade
  // ('Unid. Fazendinha - Aplicador Suporte', 'Unid. Padre Miguel - Visita
  // Guiada'). Ambos são ofertáveis; a distinção existe para quem precisar dela.
  e_sala_numerada:   boolean
}

// Retorno de central.vaga_esta_disponivel — os três motivos de recusa separados.
export interface DiagnosticoVaga {
  existe_na_grade: boolean
  ja_reservada:    boolean
  no_passado:      boolean
}

// ----------------------------------------------------------------------------
// Utilitários de paginação
// ----------------------------------------------------------------------------

export interface PaginatedResult<T> {
  data:  T[]
  count: number
}

export interface PaginationParams {
  limit?:  number
  offset?: number
}
