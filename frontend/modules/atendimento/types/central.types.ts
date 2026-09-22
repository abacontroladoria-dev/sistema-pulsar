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
  // Chaves de central.tag_definitions. A migration 20260701010000 escolheu
  // TEXT[] em vez de tabela de junção, e deixou a validação das chaves para a
  // aplicação — o banco aceita qualquer string aqui.
  tags:             string[] | null
  // Campos, não tags (aba Regras, itens 5 e 8 — migration 20260922100200).
  // campanha: só o matcher de campanha grava (agente/origem-campanha.ts); a
  // Maia sempre devolve null aqui. objecao: frase curta do motivo de recuo.
  campanha:         string | null
  objecao:          string | null
  last_message_at:  string | null
  // Marca d'água de leitura pela EQUIPE, não por usuário (20260921140000).
  // Não-lido é uma COMPARAÇÃO, não um contador: existe mensagem inbound com
  // sent_at > last_read_at. NULL = ninguém abriu ainda.
  //
  // Nada a ver com `Message.status`, que é entrega do lado do contato — esse
  // diz que a pessoa leu o que mandamos, este diz que nós lemos o que ela
  // mandou.
  last_read_at:     string | null
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
  // Por que o download falhou, em texto (20260921160000). NULL quando não
  // falhou. `storage_status: 'failed'` diz QUE falhou; este diz se adianta
  // retentar — mídia expirada na Meta é irrecuperável, token vencido não.
  storage_error:   string | null
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
  // Ver a nota em Conversation.tags. As tags do painel de detalhamento vivem
  // AQUI, e não na conversa: descrevem a pessoa ('convênio', 'particular'), e
  // acompanham-na quando ela volta meses depois numa conversa nova.
  tags:                   string[] | null
  avatar_url:             string | null
  is_provisional:         boolean
  merged_into_contact_id: string | null
  last_interaction_at:    string | null
  deleted_at:             string | null
  created_at:             string
  updated_at:             string
}

// Cardinalidade de um grupo da taxonomia: quantas tags do mesmo grupo_key
// podem valer ao mesmo tempo numa conversa/contato. Aba Regras, item 2.
export type TagCardinalidade = 'single' | 'multi'

// Catálogo de tags reutilizáveis da organização (central.tag_definitions,
// migration 20260701010000, estendida em 20260922100000). `key` é o que fica
// gravado em contacts.tags / conversations.tags; `label` é o que a tela
// mostra; `color` é hex (#rrggbb).
//
// Os seis campos abaixo de `category` só existem para tags da taxonomia de
// classificação automática da Maia (144 tags, 13 grupos —
// maia_tags_catalog.json). Tags do seed genérico anterior (20260701010500)
// têm todos eles NULL/false.
export interface TagDefinition {
  id:                 string
  organization_id:    string
  key:                string
  label:              string
  color:              string | null
  category:           string | null
  is_active:          boolean
  created_at:         string
  updated_at:         string
  grupo_key:          string | null
  grupo_ordem:        number | null
  cardinalidade:      TagCardinalidade | null
  maia_pode_aplicar:  boolean
  automatico_sistema: boolean
  requer_humano:      boolean
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
  // O identificador da mídia JÁ carregada no provider (`uploadMedia`). É o
  // caminho preferido do meta_waba: a Graph API aceita um media ID e não exige
  // que o arquivo esteja acessível pela internet, o que é o que permite manter
  // o bucket privado. `mediaUrl` continua no tipo para providers que só saibam
  // enviar por URL.
  mediaId?:    string
  caption?:    string
  fileName?:   string
  replyToId?:  string    // external_message_id da mensagem citada
}

// O que o provider devolve depois de receber os bytes. `externalId` é o media
// ID — no meta_waba ele vale 30 dias, e é o que `sendMedia` consome.
export interface ProviderUploadResult {
  externalId: string
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
  // Entrega os BYTES ao provider e recebe um identificador de mídia, separado
  // do envio de propósito: o upload é a parte cara e a que pode ser reaproveitada
  // (o mesmo arquivo para dois contatos sobe uma vez só), enquanto `sendMedia`
  // é barato e específico por destinatário.
  uploadMedia(
    channel: Channel,
    arquivo: { bytes: ArrayBuffer; mimeType: string; fileName: string },
  ): Promise<ProviderUploadResult>
  // Puxa do provider uma mídia RECEBIDA, a partir do identificador que o
  // webhook guardou. Existe porque a URL que a Graph devolve vale 5 minutos e
  // exige o token — ninguém consegue baixá-la do navegador.
  baixarMedia(
    channel: Channel,
    mediaId: string,
  ): Promise<{ bytes: ArrayBuffer; mimeType: string; fileSize: number }>
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

// central.tasks — o que ficou pendente com um contato.
export type TaskStatus = 'pending' | 'done' | 'cancelled'

export interface Task {
  id:               string
  organization_id:  string
  // Ambos nullable, com CHECK exigindo ao menos um (ck_tasks_vinculo). Espelha
  // central.appointments: a tarefa é sobre a PESSOA ("ligar para a mãe do
  // João"), e amarrá-la só à conversa a faria sumir quando esta fosse resolvida.
  contact_id:       string | null
  conversation_id:  string | null
  title:            string
  description:      string | null
  // Sem FK para public.usuarios — nenhuma tabela de `central` referencia o
  // schema public (conversations.assigned_user_id também é uuid solto).
  assigned_user_id: string | null
  due_at:           string | null
  status:           TaskStatus
  completed_at:     string | null
  created_by:       string
  created_at:       string
  updated_at:       string
}

// ----------------------------------------------------------------------------
// central.contact_sentiment_readings — a leitura de sentimento do contato.
//
// Tabela APPEND-ONLY (migration 20260921100000): a linha nasce e nunca é
// atualizada. Por isso não há `updated_at` aqui — ele descreveria uma escrita
// que não pode acontecer.
// ----------------------------------------------------------------------------

export type SentimentLabel = 'positivo' | 'neutro' | 'negativo'

// 'auto'   — worker tick, a cada N mensagens novas do contato
// 'manual' — botão "Reanalisar" do painel
export type SentimentTrigger = 'auto' | 'manual'

export interface ContactSentimentReading {
  id:                string
  organization_id:   string
  contact_id:        string
  sentiment:         SentimentLabel
  // 0 a 1. Vai para a tela: "negativo a 41%" pede outra reação do atendente que
  // "negativo a 95%", e esconder isso transformaria um palpite em veredito.
  confidence:        number
  headline:          string
  reasoning:         string
  // 1 a 3 itens, garantido por ck_csr_recomendacoes. O que fazer na PRÓXIMA
  // resposta — o bloco existe para apoiar decisão, não para descrever o passado.
  recommendations:   string[]
  messages_analyzed: number
  window_start:      string
  window_end:        string
  // `sent_at` da mensagem mais recente que entrou nesta leitura. É a marca
  // d'água do gatilho automático — ver o comentário da coluna na migration.
  last_message_at:   string | null
  model:             string
  triggered_by:      SentimentTrigger
  created_at:        string
}

// O que a rota devolve ao painel. `anterior` é o que permite desenhar tendência;
// vem null na primeira leitura de um contato, e o bloco simplesmente não mostra
// movimento nesse caso — inventar "estável" a partir de uma amostra só seria uma
// afirmação que ninguém verificou.
export interface LeituraSentimento {
  atual:    ContactSentimentReading | null
  anterior: ContactSentimentReading | null
}

// ----------------------------------------------------------------------------
// Ficha do paciente — central.contact_intake (20260921180000)
//
// Os seis campos do bloco "Ficha do paciente" do painel. Quem já é da clínica
// tem quatro deles em `public.pacientes`; quem é novo tem o que a Maia coletou
// na conversa. O merge é feito na leitura, em services/ficha.service.ts.
// ----------------------------------------------------------------------------

// central.therapy_shift. 'indiferente' NÃO é o mesmo que ausente: null é "ainda
// não perguntado", 'indiferente' é "perguntou e tanto faz". Sem a distinção a
// Maia perguntaria de novo a cada turno.
export type TherapyShift = 'manha' | 'tarde' | 'integral' | 'indiferente'

// De onde veio o valor de um campo. Chega à tela porque o atendente precisa
// distinguir o que a Maia ouviu no WhatsApp do que tem lastro:
//   'cadastro'  — public.pacientes, via contact_patient_links
//   'ia'        — a Maia registrou durante a conversa
//   'atendente' — um humano digitou ou corrigiu no painel
export type OrigemCampo = 'cadastro' | 'ia' | 'atendente'

// A linha crua da tabela: SÓ o que a conversa revelou. Não há cópia do cadastro
// aqui, de propósito — ver o cabeçalho da migration.
export interface ContactIntake {
  contact_id:       string
  organization_id:  string
  patient_name:     string | null
  birth_date:       string | null   // date (YYYY-MM-DD), sem fuso
  guardian_name:    string | null
  shift:            TherapyShift | null
  health_plan:      string | null
  fontes:           Partial<Record<CampoFicha, Exclude<OrigemCampo, 'cadastro'>>>
  coleta_concluida: boolean
  created_at:       string
  updated_at:       string
}

// Os campos coletáveis, na ORDEM em que a Maia deve perguntar. A ordem não é
// cosmética: é ela que o montador de contexto usa para dizer qual é a próxima
// pergunta, e começa pelo nome do paciente porque é o que permite tratar a
// criança pelo nome no resto da conversa.
export const CAMPOS_FICHA = [
  'patient_name',
  'birth_date',
  'guardian_name',
  'shift',
  'health_plan',
] as const
export type CampoFicha = typeof CAMPOS_FICHA[number]

// Um campo já resolvido, pronto para a tela. `valor` null significa que ninguém
// sabe — nem o cadastro, nem a conversa.
export interface CampoResolvido {
  valor:  string | null
  origem: OrigemCampo | null
}

// O que a rota devolve ao painel: a ficha depois do merge.
//
// `vinculado` é o que decide os dois mundos do bloco. Com vínculo, o cadastro
// manda e a Maia não pergunta nada; sem vínculo, tudo o que existe veio da
// conversa. A tela precisa dizer qual dos dois é o caso, porque "campo vazio
// porque a Maia ainda não perguntou" e "campo vazio porque o cadastro não tem"
// pedem ações diferentes de quem está lendo.
export interface FichaPaciente {
  contact_id:    string
  vinculado:     boolean
  campos:        Record<CampoFicha, CampoResolvido>
  // Idade em anos, derivada de birth_date. Calculada a cada leitura e NUNCA
  // persistida: guardá-la produziria um número certo no dia da escrita e errado
  // daí em diante, de um jeito que ninguém percebe.
  idade:         number | null
  faltantes:     CampoFicha[]
  // Quando o cadastro foi sincronizado do TiTa. Null para contato sem vínculo.
  // Vai à tela porque `convenio_nome` é cache derivado de agenda_tita — o
  // atendente precisa poder datar o plano que está lendo.
  sincronizado_em: string | null
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
