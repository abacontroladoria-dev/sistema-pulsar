-- Central de Atendimento — trazer produção à paridade com o local.
-- Gerado em 2026-08-11. 14 migrations na ordem, dentro de UMA transação:
-- se qualquer uma falhar, nada é aplicado e o banco fica como estava.
-- Não inclui 20260811100000_central_ai_mode (não aplicada nem no local)
-- nem o bloco CRM (decisão de não aplicar).
--
-- ⚠ NOTA DE 2026-09-10 — a frase acima descreve a decisão de 11/08 e fica como
-- registro histórico, mas NÃO vale mais como estado atual: o bloco CRM
-- (20260701020000…020400) está em produção desde então. Medido por
-- crm_diagnostico_pre_exposicao.sql em 2026-09-10 — 6 tabelas, grants
-- completos em `authenticated`, RLS com 4 policies cada, 6 estágios semeados.
-- Ver a seção "O bloco CRM ESTÁ em produção" no README desta pasta.
--
-- Cria 7 tabelas (agent_settings, appointments, conversation_states,
-- message_grouping_queue, send_queue, tag_definitions, teams) e 5 views.

begin;

-- ============================================================================
-- 20260701010000_central_nina_tables.sql
-- ============================================================================
-- Central de Atendimento — Nina Integration: Tables & Schema Extensions
-- M-N01 | Nina Integration Block
-- Depends on:
--   20260701000000_create_ca_schema.sql       (central.organizations, grants)
--   20260701000001_extend_usuarios_central.sql (public.usuarios)
--   20260701000100_create_ca_enums.sql        (central enums)
--   20260701000200_create_ca_inboxes.sql      (central.inboxes, central.inbox_members)
--   20260701000400_create_ca_contacts.sql     (central.contacts)
--   20260701000500_create_ca_conversations.sql (central.conversations)
--   20260701000600_create_ca_messages.sql     (central.messages)
--
-- O que faz:
--   1. Novos enums: queue_status, appointment_type
--   2. Nova tabela: central.teams (grupos de operadores)
--   3. Nova tabela: central.agent_settings (configurações IA por org/inbox)
--   4. Nova tabela: central.tag_definitions (tags reutilizáveis)
--   5. Nova tabela: central.appointments (agendamentos criados via IA)
--   6. Nova tabela: central.conversation_states (estado do orquestrador IA)
--   7. Nova tabela: central.message_grouping_queue (fila de agrupamento)
--   8. Nova tabela: central.send_queue (fila de envio ao provider)
--   9. ALTER TABLE: central.contacts — colunas IA
--   10. ALTER TABLE: central.conversations — colunas IA
--   11. ALTER TABLE: central.messages — métrica IA
--   12. ALTER TABLE: central.inbox_members — weight + team_id
--   13. ALTER TABLE: central.organizations — timezone + horário comercial + agent_name

-- ============================================================================
-- ROLLBACK REFERENCE (execute em ordem inversa para desfazer):
--
--   alter table central.organizations drop column if exists agent_name, drop column if exists business_days, drop column if exists business_hours_end, drop column if exists business_hours_start, drop column if exists timezone;
--   alter table central.inbox_members drop column if exists team_id, drop column if exists weight;
--   alter table central.messages drop column if exists ai_response_time_ms;
--   alter table central.conversations drop column if exists ai_context, drop column if exists tags;
--   alter table central.contacts drop column if exists ai_memory, drop column if exists tags;
--   drop table if exists central.send_queue;
--   drop table if exists central.message_grouping_queue;
--   drop table if exists central.conversation_states;
--   drop table if exists central.appointments;
--   drop table if exists central.tag_definitions;
--   drop table if exists central.agent_settings;
--   drop table if exists central.teams;
--   drop type if exists central.appointment_type;
--   drop type if exists central.queue_status;
-- ============================================================================

-- ============================================================================
-- ENUM: central.queue_status
--
-- Estado comum para todas as filas assíncronas (message_grouping_queue, send_queue).
-- pending    → aguardando processamento pelo worker
-- processing → worker em execução (FOR UPDATE SKIP LOCKED)
-- completed  → processado com sucesso
-- failed     → falhou após max_retries; requer intervenção manual
-- cancelled  → cancelado por regra de negócio (ex: conversa encerrada)
-- ============================================================================
create type central.queue_status as enum (
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled'
);

-- ============================================================================
-- ENUM: central.appointment_type
--
-- Tipos de agendamento criados pelo agente de IA via WhatsApp.
-- Adaptado do Nina (demo/meeting/support/followup) para contexto clínico.
-- triagem   → primeira consulta para avaliação do paciente
-- retorno   → acompanhamento de paciente em tratamento
-- reuniao   → reunião com responsável ou equipe clínica
-- followup  → acompanhamento administrativo ou pós-alta
-- demo      → apresentação comercial da clínica (lead não-convertido)
-- other     → outros casos não classificados
-- ============================================================================
create type central.appointment_type as enum (
  'triagem',
  'retorno',
  'reuniao',
  'followup',
  'demo',
  'other'
);

-- ============================================================================
-- TABLE: central.teams
--
-- Grupos lógicos de operadores para distribuição de conversas.
-- Substituição da tabela Nina teams, adaptada para multi-tenant.
--
-- inbox_members.team_id → FK para esta tabela (adicionada mais abaixo).
-- Não possui FK para inboxes: times são cross-inbox por design —
-- um time de "Recepção" pode atuar em múltiplas inboxes simultaneamente.
--
-- color: hexadecimal ou nome CSS. Usado na UI para diferenciar times visualmente.
-- UNIQUE (organization_id, name): times com mesmo nome na mesma org são ambíguos.
-- ============================================================================
create table central.teams (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references central.organizations(id),
  name            text        not null,
  description     text,
  color           text,
  is_active       boolean     not null default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  constraint uq_teams_org_name unique (organization_id, name)
);

drop trigger if exists set_updated_at on central.teams;
create trigger set_updated_at
  before update on central.teams
  for each row execute function public.set_updated_at();

-- ============================================================================
-- TABLE: central.agent_settings
--
-- Configurações do agente de IA por organização ou por inbox.
-- Substituição da tabela Nina nina_settings, com separação de responsabilidades:
--   - Credenciais WhatsApp → central.channel_connections.provider_metadata
--   - Dados da empresa → central.organizations (colunas adicionadas abaixo)
--   - Configurações IA + TTS → esta tabela
--
-- inbox_id nullable:
--   NULL  → configuração padrão da organização (org-level default)
--   UUID  → override específico por inbox
--   Índice parcial uq_agent_settings_org_default impede múltiplos defaults por org.
--
-- Campos de credencial (elevenlabs_api_key):
--   Armazenados em texto puro nesta migration. Em produção, recomenda-se
--   migrar para Supabase Vault (pgsodium.create_key / pgsodium.encrypt).
--   Aceitos como texto enquanto o Vault não estiver configurado.
--
-- response_delay_min / response_delay_max:
--   Intervalo em segundos para simular digitação humana antes de enviar.
--   Nina usa 3–8 s por padrão; ajustável por inbox.
-- ============================================================================
create table central.agent_settings (
  id                          uuid    primary key default gen_random_uuid(),
  organization_id             uuid    not null references central.organizations(id),
  inbox_id                    uuid    references central.inboxes(id) on delete cascade,

  -- Comportamento do agente
  ai_model_mode               text    not null default 'gpt-4o',
  system_prompt               text,
  auto_response_enabled       boolean not null default false,
  response_delay_min          integer not null default 3,
  response_delay_max          integer not null default 8,
  message_breaking_enabled    boolean not null default true,
  openai_assistant_id         text,

  -- ElevenLabs TTS
  elevenlabs_api_key          text,
  elevenlabs_voice_id         text,
  elevenlabs_model            text    default 'eleven_multilingual_v2',
  elevenlabs_stability        numeric(3,2) default 0.50,
  elevenlabs_similarity_boost numeric(3,2) default 0.75,
  elevenlabs_speed            numeric(3,2) default 1.00,
  tts_enabled                 boolean not null default false,

  created_at                  timestamptz default now(),
  updated_at                  timestamptz default now()
);

drop trigger if exists set_updated_at on central.agent_settings;
create trigger set_updated_at
  before update on central.agent_settings
  for each row execute function public.set_updated_at();

-- Garante no máximo um registro padrão (inbox_id IS NULL) por organização.
create unique index uq_agent_settings_org_default
  on central.agent_settings(organization_id)
  where inbox_id is null;

-- Garante unicidade para overrides por inbox específica.
create unique index uq_agent_settings_org_inbox
  on central.agent_settings(organization_id, inbox_id)
  where inbox_id is not null;

-- ============================================================================
-- TABLE: central.tag_definitions
--
-- Catálogo de tags reutilizáveis por organização.
-- Tags são referenciadas por central.contacts.tags TEXT[] e
-- central.conversations.tags TEXT[] (arrays de tag key).
--
-- Abordagem TEXT[] em vez de tabela junction (contact_tags):
--   Prioridade: simplicidade de leitura e escrita.
--   A busca "todos os contatos com tag X" usa índice GIN em contacts.tags.
--   Se no futuro surgir necessidade de metadados por tag-contato (created_at,
--   created_by), migrar para tabela junction em migration separada.
--
-- key: identificador de código único por org (ex: 'lead_quente', 'sem_resposta').
-- label: texto exibido na UI (ex: 'Lead quente', 'Sem resposta').
-- category: agrupamento na UI (ex: 'Triagem', 'Comercial', 'Atendimento').
-- ============================================================================
create table central.tag_definitions (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references central.organizations(id),
  key             text        not null,
  label           text        not null,
  color           text,
  category        text,
  is_active       boolean     not null default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  constraint uq_tag_key_per_org unique (organization_id, key)
);

drop trigger if exists set_updated_at on central.tag_definitions;
create trigger set_updated_at
  before update on central.tag_definitions
  for each row execute function public.set_updated_at();

-- ============================================================================
-- TABLE: central.appointments
--
-- Agendamentos criados pelo agente de IA via WhatsApp ou por operadores.
-- Independente de agenda_tita: não replica dados do TITA — é um registro
-- de intenção de agendamento originado pelo canal de mensageria.
--
-- Vínculo com agenda_tita: quando o agendamento é confirmado no TITA,
-- o campo tita_session_id pode ser preenchido para rastreabilidade.
-- Esta vinculação é bidirecional e feita pela aplicação, não por FK
-- (o TITA usa IDs inteiros e não é controlado pelo Central).
--
-- status valid values: 'scheduled' | 'confirmed' | 'cancelled' | 'completed' | 'no_show'
-- ============================================================================
create table central.appointments (
  id              uuid                      primary key default gen_random_uuid(),
  organization_id uuid                      not null references central.organizations(id),
  contact_id      uuid                      references central.contacts(id) on delete set null,
  conversation_id uuid                      references central.conversations(id) on delete set null,
  title           text                      not null,
  description     text,
  date            date                      not null,
  time            time,
  duration        integer,
  type            central.appointment_type  not null default 'other',
  attendees       text[],
  meeting_url     text,
  status          text                      not null default 'scheduled',
  tita_session_id bigint,
  created_by_ai   boolean                   not null default false,
  created_at      timestamptz               default now(),
  updated_at      timestamptz               default now()
);

drop trigger if exists set_updated_at on central.appointments;
create trigger set_updated_at
  before update on central.appointments
  for each row execute function public.set_updated_at();

-- ============================================================================
-- TABLE: central.conversation_states
--
-- Estado da máquina de estados do orquestrador de IA por conversa.
-- Necessária para que o nina-orchestrator (portado como Edge Function ou
-- worker externo) persista o passo atual do fluxo entre mensagens.
--
-- current_state valid values (definidos pelo orquestrador):
--   'idle'          → aguardando nova mensagem
--   'processing'    → IA processando resposta
--   'scheduling'    → em fluxo de agendamento
--   'handoff'       → transferindo para humano
--   'waiting_human' → aguardando resposta do operador humano
--
-- scheduling_context JSONB:
--   Dados parciais coletados durante o fluxo de agendamento.
--   Ex: { "collected_date": "2026-07-15", "collected_time": null, "step": 2 }
--   Persiste entre mensagens para que o orquestrador retome do passo correto.
--
-- UNIQUE (conversation_id): uma conversa tem exatamente um estado ativo.
-- Criação via upsert: INSERT ON CONFLICT (conversation_id) DO UPDATE.
-- ============================================================================
create table central.conversation_states (
  id                  uuid        primary key default gen_random_uuid(),
  organization_id     uuid        not null references central.organizations(id),
  conversation_id     uuid        not null references central.conversations(id) on delete cascade,
  current_state       text        not null default 'idle',
  last_action         text,
  last_action_at      timestamptz,
  scheduling_context  jsonb,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  constraint uq_conversation_state unique (conversation_id)
);

drop trigger if exists set_updated_at on central.conversation_states;
create trigger set_updated_at
  before update on central.conversation_states
  for each row execute function public.set_updated_at();

-- ============================================================================
-- TABLE: central.message_grouping_queue
--
-- Fila de agrupamento com delay: mensagens recebidas são enfileiradas e
-- aguardam N segundos antes de serem enviadas ao orquestrador. Isso permite
-- agrupar múltiplas mensagens enviadas em rápida sucessão (ex: usuário envia
-- 3 mensagens curtas seguidas) em um único turno de processamento.
--
-- process_after: timestamp a partir do qual o worker pode processar.
--   DEFAULT now() + '15 seconds' — ajustável por inbox em agent_settings.
--   Não hardcodado aqui para permitir override sem migration.
--
-- whatsapp_message_id: ID externo da mensagem no provider.
--   Usado para deduplicação — webhooks duplicados não devem enfileirar duas vezes.
--
-- status (central.queue_status):
--   Substitui o campo processed BOOLEAN do Nina original.
--   Permite rastrear falhas e retentativas (retry_count).
--
-- Worker: usa FOR UPDATE SKIP LOCKED para claims concorrentes seguros.
-- Função: central.claim_message_grouping_batch() em 20260701010400.
-- ============================================================================
create table central.message_grouping_queue (
  id                   uuid                  primary key default gen_random_uuid(),
  organization_id      uuid                  not null references central.organizations(id),
  whatsapp_message_id  text                  not null,
  phone_number_id      text                  not null,
  message_data         jsonb                 not null,
  contacts_data        jsonb,
  status               central.queue_status  not null default 'pending',
  process_after        timestamptz           not null default now() + interval '15 seconds',
  message_id           uuid                  references central.messages(id) on delete set null,
  processed_at         timestamptz,
  error_message        text,
  retry_count          integer               not null default 0,
  created_at           timestamptz           default now(),
  updated_at           timestamptz           default now()
);

drop trigger if exists set_updated_at on central.message_grouping_queue;
create trigger set_updated_at
  before update on central.message_grouping_queue
  for each row execute function public.set_updated_at();

-- ============================================================================
-- TABLE: central.send_queue
--
-- Fila de envio de mensagens ao provider.
-- Desacopla a geração da resposta pela IA do envio efetivo ao WhatsApp/Instagram,
-- permitindo retentativas, scheduling e throttling independentes.
--
-- direction:
--   Quase sempre 'outbound' (central → contato).
--   Manter o campo para consistência com central.messages.
--
-- message_id FK:
--   Referencia a mensagem em central.messages já persistida.
--   Nullable: a mensagem pode ser enfileirada antes de ser persistida em
--   cenários de draft (raro, mas permitido pela arquitetura).
--
-- Worker: usa FOR UPDATE SKIP LOCKED para claims concorrentes seguros.
-- Função: central.claim_send_queue_batch() em 20260701010400.
-- ============================================================================
create table central.send_queue (
  id              uuid                  primary key default gen_random_uuid(),
  organization_id uuid                  not null references central.organizations(id),
  conversation_id uuid                  not null references central.conversations(id) on delete cascade,
  contact_id      uuid                  not null references central.contacts(id) on delete cascade,
  message_id      uuid                  references central.messages(id) on delete set null,
  message_type    text                  not null default 'text',
  direction       text                  not null default 'outbound',
  body            text,
  media_url       text,
  status          central.queue_status  not null default 'pending',
  scheduled_at    timestamptz           not null default now(),
  sent_at         timestamptz,
  error_message   text,
  retry_count     integer               not null default 0,
  created_at      timestamptz           default now(),
  updated_at      timestamptz           default now()
);

drop trigger if exists set_updated_at on central.send_queue;
create trigger set_updated_at
  before update on central.send_queue
  for each row execute function public.set_updated_at();

-- ============================================================================
-- ALTER TABLE: central.contacts
--
-- tags TEXT[]:
--   Array de tag keys (ex: ['lead_quente', 'sem_resposta']).
--   Indexado com GIN em 20260701010100 para queries de filtragem por tag.
--   Chaves devem existir em central.tag_definitions; validação na camada da aplicação.
--
-- ai_memory JSONB:
--   Memória acumulada do agente sobre este contato.
--   Equivale ao campo client_memory do Nina.
--   Estrutura sugerida: { "profile": {...}, "preferences": {...}, "history_summary": "..." }
--   Atualizado pela função central.update_contact_ai_memory() em 20260701010400.
-- ============================================================================
alter table central.contacts
  add column if not exists tags       text[],
  add column if not exists ai_memory  jsonb;

-- ============================================================================
-- ALTER TABLE: central.conversations
--
-- tags TEXT[]:
--   Array de tag keys da conversa (ex: ['urgente', 'matricula']).
--   Separado de contacts.tags: uma conversa pode ter tags diferentes do contato.
--
-- ai_context JSONB:
--   Contexto acumulado do agente para esta conversa específica.
--   Equivale ao campo nina_context do Nina.
--   Estrutura sugerida: { "thread_id": "...", "last_summary": "...", "intent_stack": [...] }
-- ============================================================================
alter table central.conversations
  add column if not exists tags        text[],
  add column if not exists ai_context  jsonb;

-- ============================================================================
-- ALTER TABLE: central.messages
--
-- ai_response_time_ms INTEGER:
--   Tempo de resposta do modelo de IA em milissegundos para mensagens outbound
--   geradas pela IA (sent_by_ai = true).
--   Equivale ao campo nina_response_time do Nina.
--   NULL para mensagens humanas e inbound.
--   Usado em métricas de performance do agente.
-- ============================================================================
alter table central.messages
  add column if not exists ai_response_time_ms integer;

-- ============================================================================
-- ALTER TABLE: central.inbox_members
--
-- weight INTEGER DEFAULT 1:
--   Peso para algoritmo de distribuição de conversas por carga.
--   Copiado do Nina (team_members.weight).
--   Valores sugeridos: 1 (padrão) a 10 (operador premium de alta capacidade).
--   O algoritmo de distribuição divide a carga proporcionalmente.
--
-- team_id UUID FK central.teams:
--   Vincula o membro a um time dentro da inbox.
--   ON DELETE SET NULL: excluir o time não remove o membro da inbox.
--   Nullable: membro pode não pertencer a nenhum time (atendimento individual).
-- ============================================================================
alter table central.inbox_members
  add column if not exists weight   integer  not null default 1,
  add column if not exists team_id  uuid     references central.teams(id) on delete set null;

-- ============================================================================
-- ALTER TABLE: central.organizations
--
-- Campos vindos de nina_settings que descrevem a empresa, não o canal.
--
-- timezone TEXT:
--   Timezone da organização em formato IANA (ex: 'America/Sao_Paulo').
--   Usado para converter business_hours_start/end para UTC no orquestrador.
--
-- business_hours_start / business_hours_end TIME:
--   Horário comercial. Agente só responde automaticamente neste intervalo
--   quando auto_response_enabled = true em agent_settings.
--
-- business_days INTEGER[]:
--   Dias úteis como array de inteiros ISO (1=Segunda … 7=Domingo).
--   Ex: {1,2,3,4,5} = segunda a sexta.
--   Escolhido sobre TEXT[] para facilitar comparações aritméticas no orquestrador.
--
-- agent_name TEXT:
--   Nome do agente de IA exibido nas mensagens (ex: 'Nina', 'Kira').
--   Equivale ao campo sdr_name do Nina.
-- ============================================================================
alter table central.organizations
  add column if not exists timezone              text      default 'America/Sao_Paulo',
  add column if not exists business_hours_start  time      default '08:00',
  add column if not exists business_hours_end    time      default '18:00',
  add column if not exists business_days         integer[] default '{1,2,3,4,5}',
  add column if not exists agent_name            text;

-- ============================================================================
-- 20260701010100_central_nina_indexes.sql
-- ============================================================================
-- Central de Atendimento — Nina Integration: Indexes
-- M-N02 | Nina Integration Block
-- Depends on: 20260701010000_central_nina_tables.sql (all new tables + ALTER TABLEs)
--
-- ROLLBACK: drop each index by name individually (todos idempotentes via IF EXISTS).
--   drop index if exists central.idx_teams_org_active;
--   drop index if exists central.idx_agent_settings_org;
--   drop index if exists central.idx_tag_definitions_org_active;
--   drop index if exists central.idx_tag_definitions_org_category;
--   drop index if exists central.idx_appointments_org_date;
--   drop index if exists central.idx_appointments_org_contact;
--   drop index if exists central.idx_appointments_org_conv;
--   drop index if exists central.idx_appointments_org_status;
--   drop index if exists central.idx_conv_states_org;
--   drop index if exists central.idx_msg_grouping_pending;
--   drop index if exists central.idx_msg_grouping_wamid;
--   drop index if exists central.idx_send_queue_pending;
--   drop index if exists central.idx_send_queue_conversation;
--   drop index if exists central.idx_contacts_tags_gin;
--   drop index if exists central.idx_conversations_tags_gin;
--   drop index if exists central.idx_inbox_members_team;

-- ============================================================================
-- INDEXES — central.teams
-- ============================================================================

-- Listar times ativos de uma org (dropdown de atribuição no workspace)
create index idx_teams_org_active
  on central.teams(organization_id, is_active);

-- ============================================================================
-- INDEXES — central.agent_settings
-- ============================================================================

-- Lookup de configuração da org: "qual é o default de IA para esta org?"
-- Frequente em cada mensagem processada pelo worker.
-- O índice parcial uq_agent_settings_org_default (criado em 010000)
-- cobre a query WHERE inbox_id IS NULL implicitamente via B-tree;
-- este índice cobre queries com inbox_id explícito.
create index idx_agent_settings_org
  on central.agent_settings(organization_id, inbox_id);

-- ============================================================================
-- INDEXES — central.tag_definitions
-- ============================================================================

-- Listar tags ativas de uma org para o seletor da UI (query mais comum)
create index idx_tag_definitions_org_active
  on central.tag_definitions(organization_id, is_active)
  where is_active = true;

-- Agrupar tags por categoria dentro da org (painéis de filtro agrupados)
create index idx_tag_definitions_org_category
  on central.tag_definitions(organization_id, category)
  where category is not null;

-- ============================================================================
-- INDEXES — central.appointments
-- ============================================================================

-- Listagem cronológica de agendamentos por org (agenda do dia / semana)
create index idx_appointments_org_date
  on central.appointments(organization_id, date desc, time asc);

-- Agendamentos de um contato específico (painel de histórico do contato)
create index idx_appointments_org_contact
  on central.appointments(organization_id, contact_id)
  where contact_id is not null;

-- Agendamentos originados de uma conversa (rastreabilidade IA → agenda)
create index idx_appointments_org_conv
  on central.appointments(organization_id, conversation_id)
  where conversation_id is not null;

-- Filtrar por status dentro da org (ex: "todos os agendamentos pendentes hoje")
create index idx_appointments_org_status
  on central.appointments(organization_id, status, date asc);

-- ============================================================================
-- INDEXES — central.conversation_states
-- ============================================================================

-- A constraint UNIQUE (conversation_id) em 010000 cria um índice B-tree
-- implicitamente — lookup direto por conversation_id está coberto.

-- Monitoramento: quantas conversas em cada estado por org (dashboard IA)
create index idx_conv_states_org
  on central.conversation_states(organization_id, current_state);

-- ============================================================================
-- INDEXES — central.message_grouping_queue
-- ============================================================================

-- Hot path do worker de agrupamento: busca itens pendentes prontos para processar.
-- process_after ASC garante FIFO com delay: processa os mais antigos primeiro.
-- Índice parcial (status = 'pending'): exclui completed/failed/cancelled da varredura.
-- Tipicamente pouquíssimas linhas neste índice — filas funcionam com throughput alto.
create index idx_msg_grouping_pending
  on central.message_grouping_queue(organization_id, process_after asc)
  where status = 'pending';

-- Deduplicação de webhook: "já existe entrada pendente para esta mensagem?"
-- Evita enfileirar o mesmo whatsapp_message_id duas vezes em caso de retry do provider.
create index idx_msg_grouping_wamid
  on central.message_grouping_queue(organization_id, whatsapp_message_id);

-- ============================================================================
-- INDEXES — central.send_queue
-- ============================================================================

-- Hot path do worker de envio: busca itens pendentes agendados para agora ou passado.
-- scheduled_at ASC: processa os mais antigos primeiro (respeita ordem de enfileiramento).
create index idx_send_queue_pending
  on central.send_queue(organization_id, scheduled_at asc)
  where status = 'pending';

-- Lookup de status da fila por conversa: "há mensagens pendentes nesta conversa?"
-- Usado pelo workspace para exibir indicador "enviando..." na thread.
create index idx_send_queue_conversation
  on central.send_queue(organization_id, conversation_id, created_at desc);

-- ============================================================================
-- INDEXES — colunas novas em tabelas existentes
-- ============================================================================

-- central.contacts.tags: filtragem por tag em toda a base de contatos da org.
-- GIN (Generalized Inverted Index) é obrigatório para queries @> (contains) em arrays.
-- Ex: WHERE tags @> ARRAY['lead_quente'] — sem GIN isso faz seq scan em toda a tabela.
create index idx_contacts_tags_gin
  on central.contacts using gin(tags)
  where tags is not null;

-- central.conversations.tags: filtragem de conversas por tag.
-- Mesma justificativa do GIN acima.
create index idx_conversations_tags_gin
  on central.conversations using gin(tags)
  where tags is not null;

-- central.inbox_members.team_id: "quais membros pertencem ao time X?"
-- Usado pela lógica de distribuição de conversas por time no workspace.
create index idx_inbox_members_team
  on central.inbox_members(team_id)
  where team_id is not null;

-- ============================================================================
-- 20260701010200_central_nina_rls.sql
-- ============================================================================
-- Central de Atendimento — Nina Integration: RLS Policies
-- M-N03 | Nina Integration Block
-- Depends on:
--   20260701010000_central_nina_tables.sql (novas tabelas)
--   20260701000700_create_ca_rls_helpers.sql (central.current_organization_id, central.ca_current_role)
--
-- Padrão herdado das policies existentes (20260701000800_create_ca_rls_policies.sql):
--   admin    → controle total dentro da org
--   director → leitura + updates operacionais; sem escrita em config/infra
--   service_role → bypass total (workers, Edge Functions)
--
-- Filas (message_grouping_queue, send_queue):
--   authenticated pode apenas ler (SELECT) para monitoramento.
--   INSERT / UPDATE: service_role apenas (workers via Edge Function com service_role key).
--   Isso protege integridade das filas de modificações manuais via cliente.
--
-- ROLLBACK:
--   drop policy if exists <nome> on central.<tabela>;
--   alter table central.<tabela> disable row level security;

-- ============================================================================
-- ENABLE RLS — todas as novas tabelas
-- ============================================================================

alter table central.teams                   enable row level security;
alter table central.agent_settings          enable row level security;
alter table central.tag_definitions         enable row level security;
alter table central.appointments            enable row level security;
alter table central.conversation_states     enable row level security;
alter table central.message_grouping_queue  enable row level security;
alter table central.send_queue              enable row level security;

-- ============================================================================
-- TABLE: central.teams
--
-- admin    : leitura + escrita (criar/editar/desativar times)
-- director : somente leitura (visão de operação, sem gerenciamento de times)
-- ============================================================================

create policy teams_select
  on central.teams
  for select
  to authenticated
  using (
    organization_id = central.current_organization_id()
    and central.ca_current_role() in ('admin', 'director')
  );

create policy teams_insert_admin
  on central.teams
  for insert
  to authenticated
  with check (
    organization_id = central.current_organization_id()
    and central.ca_current_role() = 'admin'
  );

create policy teams_update_admin
  on central.teams
  for update
  to authenticated
  using (
    organization_id = central.current_organization_id()
    and central.ca_current_role() = 'admin'
  )
  with check (
    organization_id = central.current_organization_id()
    and central.ca_current_role() = 'admin'
  );

create policy teams_delete_admin
  on central.teams
  for delete
  to authenticated
  using (
    organization_id = central.current_organization_id()
    and central.ca_current_role() = 'admin'
  );

-- ============================================================================
-- TABLE: central.agent_settings
--
-- admin    : leitura + escrita (configurar credenciais TTS, prompt, parâmetros IA)
-- director : somente leitura (visão das configurações ativas, sem editar credenciais)
--
-- Nota de segurança: elevenlabs_api_key é armazenada em texto puro.
--   A policy de SELECT para director permite ver a chave. Se isso for indesejável,
--   criar uma view central.agent_settings_public (ver 20260701010300) que omite
--   as colunas de credencial, e restringir o SELECT direto a admin apenas.
-- ============================================================================

create policy agent_settings_select_admin
  on central.agent_settings
  for select
  to authenticated
  using (
    organization_id = central.current_organization_id()
    and central.ca_current_role() = 'admin'
  );

create policy agent_settings_insert_admin
  on central.agent_settings
  for insert
  to authenticated
  with check (
    organization_id = central.current_organization_id()
    and central.ca_current_role() = 'admin'
  );

create policy agent_settings_update_admin
  on central.agent_settings
  for update
  to authenticated
  using (
    organization_id = central.current_organization_id()
    and central.ca_current_role() = 'admin'
  )
  with check (
    organization_id = central.current_organization_id()
    and central.ca_current_role() = 'admin'
  );

create policy agent_settings_delete_admin
  on central.agent_settings
  for delete
  to authenticated
  using (
    organization_id = central.current_organization_id()
    and central.ca_current_role() = 'admin'
  );

-- ============================================================================
-- TABLE: central.tag_definitions
--
-- admin    : leitura + escrita (gerenciar catálogo de tags)
-- director : somente leitura (usar tags existentes)
-- ============================================================================

create policy tag_definitions_select
  on central.tag_definitions
  for select
  to authenticated
  using (
    organization_id = central.current_organization_id()
    and central.ca_current_role() in ('admin', 'director')
  );

create policy tag_definitions_insert_admin
  on central.tag_definitions
  for insert
  to authenticated
  with check (
    organization_id = central.current_organization_id()
    and central.ca_current_role() = 'admin'
  );

create policy tag_definitions_update_admin
  on central.tag_definitions
  for update
  to authenticated
  using (
    organization_id = central.current_organization_id()
    and central.ca_current_role() = 'admin'
  )
  with check (
    organization_id = central.current_organization_id()
    and central.ca_current_role() = 'admin'
  );

create policy tag_definitions_delete_admin
  on central.tag_definitions
  for delete
  to authenticated
  using (
    organization_id = central.current_organization_id()
    and central.ca_current_role() = 'admin'
  );

-- ============================================================================
-- TABLE: central.appointments
--
-- admin + director : leitura + escrita (criar e gerenciar agendamentos)
-- DELETE           : admin apenas
-- Nota: agendamentos criados pela IA (created_by_ai = true) são inseridos
--       via service_role no worker — sem necessidade de policy para INSERT autômato.
-- ============================================================================

create policy appointments_select
  on central.appointments
  for select
  to authenticated
  using (
    organization_id = central.current_organization_id()
    and central.ca_current_role() in ('admin', 'director')
  );

create policy appointments_insert
  on central.appointments
  for insert
  to authenticated
  with check (
    organization_id = central.current_organization_id()
    and central.ca_current_role() in ('admin', 'director')
  );

create policy appointments_update
  on central.appointments
  for update
  to authenticated
  using (
    organization_id = central.current_organization_id()
    and central.ca_current_role() in ('admin', 'director')
  )
  with check (
    organization_id = central.current_organization_id()
    and central.ca_current_role() in ('admin', 'director')
  );

create policy appointments_delete_admin
  on central.appointments
  for delete
  to authenticated
  using (
    organization_id = central.current_organization_id()
    and central.ca_current_role() = 'admin'
  );

-- ============================================================================
-- TABLE: central.conversation_states
--
-- admin + director : SELECT (monitoramento do estado IA das conversas)
-- UPDATE           : service_role apenas (worker/orquestrador atualiza o estado)
-- INSERT           : service_role apenas (criado automaticamente no início da conversa)
-- DELETE           : service_role apenas (cascaded por ON DELETE CASCADE em conversations)
--
-- Não expor UPDATE para authenticated evita que a UI sobrescreva o estado da
-- máquina de estados diretamente, o que poderia corromper o fluxo do orquestrador.
-- ============================================================================

create policy conversation_states_select
  on central.conversation_states
  for select
  to authenticated
  using (
    organization_id = central.current_organization_id()
    and central.ca_current_role() in ('admin', 'director')
  );

-- ============================================================================
-- TABLE: central.message_grouping_queue
--
-- SELECT  : admin + director (monitoramento e diagnóstico)
-- INSERT / UPDATE / DELETE : service_role apenas (worker)
-- ============================================================================

create policy message_grouping_queue_select
  on central.message_grouping_queue
  for select
  to authenticated
  using (
    organization_id = central.current_organization_id()
    and central.ca_current_role() in ('admin', 'director')
  );

-- ============================================================================
-- TABLE: central.send_queue
--
-- SELECT  : admin + director (monitoramento de mensagens pendentes de envio)
-- INSERT / UPDATE / DELETE : service_role apenas (worker)
-- ============================================================================

create policy send_queue_select
  on central.send_queue
  for select
  to authenticated
  using (
    organization_id = central.current_organization_id()
    and central.ca_current_role() in ('admin', 'director')
  );

-- ============================================================================
-- 20260701010300_central_nina_views.sql
-- ============================================================================
-- Central de Atendimento — Nina Integration: Views
-- M-N04 | Nina Integration Block
-- Depends on:
--   20260701010000_central_nina_tables.sql (novas tabelas + ALTER TABLEs)
--   20260701010200_central_nina_rls.sql   (RLS habilitado nas novas tabelas)
--
-- Views criadas:
--   1. central.contacts_with_stats        — contatos + métricas de conversa
--   2. central.agent_settings_public      — configurações IA sem credenciais sensíveis
--   3. central.pending_queue_overview     — visão consolidada das filas para monitoramento
--
-- ROLLBACK:
--   drop view if exists central.pending_queue_overview;
--   drop view if exists central.agent_settings_public;
--   drop view if exists central.contacts_with_stats;

-- ============================================================================
-- VIEW: central.contacts_with_stats
--
-- Equivalente à view contacts_with_stats do Nina, adaptada para multi-tenant.
-- Exposta com SECURITY INVOKER: cada usuário vê apenas o que as policies
-- de contacts e conversations permitem. Não usa SECURITY DEFINER para evitar
-- escalonamento de privilégio via JOINs.
--
-- Campos:
--   contact_*           — todos os campos de central.contacts
--   total_conversations — total de conversas (qualquer status)
--   open_conversations  — conversas ativas (open + assigned + waiting)
--   last_conversation_at— timestamp da conversa mais recente
--   last_message_at     — última mensagem em qualquer conversa do contato
--   primary_phone       — identificador principal do tipo 'phone'
--   primary_wa_id       — identificador principal do tipo 'wa_id'
-- ============================================================================
create or replace view central.contacts_with_stats
  with (security_invoker = true)
as
select
  c.id,
  c.organization_id,
  c.name,
  c.display_phone,
  c.display_email,
  c.contact_type,
  c.status,
  c.source,
  c.avatar_url,
  c.is_provisional,
  c.merged_into_contact_id,
  c.last_interaction_at,
  c.deleted_at,
  c.tags,
  c.ai_memory,
  c.created_at,
  c.updated_at,

  -- Estatísticas de conversas
  count(conv.id)                                                        as total_conversations,
  count(conv.id) filter (
    where conv.status in ('open', 'assigned', 'waiting')
  )                                                                     as open_conversations,
  max(conv.created_at)                                                  as last_conversation_at,
  max(conv.last_message_at)                                             as last_message_at,

  -- Identificadores primários desnormalizados para display sem JOIN adicional
  (
    select ci.identifier_value
    from central.contact_identifiers ci
    where ci.contact_id = c.id
      and ci.identifier_type = 'phone'
      and ci.is_primary = true
    limit 1
  )                                                                     as primary_phone,
  (
    select ci.identifier_value
    from central.contact_identifiers ci
    where ci.contact_id = c.id
      and ci.identifier_type = 'wa_id'
      and ci.is_primary = true
    limit 1
  )                                                                     as primary_wa_id

from central.contacts c
left join central.conversations conv
  on conv.contact_id = c.id
  and conv.organization_id = c.organization_id
where c.deleted_at is null
group by c.id;

-- ============================================================================
-- VIEW: central.agent_settings_public
--
-- Versão segura de central.agent_settings sem as colunas de credencial.
-- Usada pela UI para exibir/editar configurações de comportamento do agente
-- sem expor elevenlabs_api_key ao cliente.
--
-- Campos omitidos: elevenlabs_api_key, openai_assistant_id
-- Campos incluídos: todos os campos comportamentais + campos de modelo TTS
--                   (voice_id, model, parâmetros de qualidade — sem a chave)
--
-- SECURITY INVOKER: RLS de agent_settings (admin apenas para SELECT direto)
-- ainda se aplica. Esta view não escalona privilégio.
-- ============================================================================
create or replace view central.agent_settings_public
  with (security_invoker = true)
as
select
  id,
  organization_id,
  inbox_id,
  ai_model_mode,
  system_prompt,
  auto_response_enabled,
  response_delay_min,
  response_delay_max,
  message_breaking_enabled,
  -- openai_assistant_id omitido
  -- elevenlabs_api_key omitido
  elevenlabs_voice_id,
  elevenlabs_model,
  elevenlabs_stability,
  elevenlabs_similarity_boost,
  elevenlabs_speed,
  tts_enabled,
  created_at,
  updated_at
from central.agent_settings;

-- ============================================================================
-- VIEW: central.pending_queue_overview
--
-- Visão consolidada das duas filas assíncronas para monitoramento operacional.
-- Exibe apenas itens pendentes ou em processamento — não polui com histórico.
-- Usado no painel de saúde da Central para detectar gargalos.
--
-- queue_type: 'grouping' | 'send' — identifica a origem
-- item_id: UUID do item na fila
-- status: pending | processing
-- scheduled_at: quando o item deve ser / foi processado
-- age_seconds: idade do item desde criação (alertar se > threshold)
-- retry_count: número de tentativas anteriores (alertar se > 0)
-- error_message: último erro registrado
--
-- SECURITY INVOKER: respeita as RLS das filas (admin + director SELECT).
-- ============================================================================
create or replace view central.pending_queue_overview
  with (security_invoker = true)
as
select
  'grouping'::text                                  as queue_type,
  q.id                                              as item_id,
  q.organization_id,
  q.status,
  q.process_after                                   as scheduled_at,
  extract(epoch from (now() - q.created_at))::int   as age_seconds,
  q.retry_count,
  q.error_message,
  q.created_at
from central.message_grouping_queue q
where q.status in ('pending', 'processing')

union all

select
  'send'::text                                      as queue_type,
  s.id                                              as item_id,
  s.organization_id,
  s.status,
  s.scheduled_at,
  extract(epoch from (now() - s.created_at))::int   as age_seconds,
  s.retry_count,
  s.error_message,
  s.created_at
from central.send_queue s
where s.status in ('pending', 'processing')

order by created_at asc;

-- ============================================================================
-- 20260701010400_central_nina_functions.sql
-- ============================================================================
-- Central de Atendimento — Nina Integration: Functions & Triggers
-- M-N05 | Nina Integration Block
-- Depends on:
--   20260701010000_central_nina_tables.sql (central.conversation_states, filas)
--
-- Funções criadas:
--   1. central.get_or_create_conversation_state()  — upsert de estado IA
--   2. central.update_conversation_state()         — atualiza estado + scheduling_context
--   3. central.update_contact_ai_memory()          — merge de memória do contato
--   4. central.claim_message_grouping_batch()      — FOR UPDATE SKIP LOCKED (agrupamento)
--   5. central.claim_send_queue_batch()            — FOR UPDATE SKIP LOCKED (envio)
--   6. central.cleanup_processed_queues()          — purge de itens antigos processados
--
-- Todas as funções usam SECURITY DEFINER + set search_path para evitar
-- SQL injection via search_path manipulation.
--
-- ROLLBACK:
--   drop function if exists central.cleanup_processed_queues(integer);
--   drop function if exists central.claim_send_queue_batch(uuid, integer);
--   drop function if exists central.claim_message_grouping_batch(uuid, integer);
--   drop function if exists central.update_contact_ai_memory(uuid, uuid, jsonb);
--   drop function if exists central.update_conversation_state(uuid, uuid, text, text, jsonb);
--   drop function if exists central.get_or_create_conversation_state(uuid, uuid);

-- ============================================================================
-- FUNCTION: central.get_or_create_conversation_state
--
-- Retorna o registro de conversation_states para a conversa indicada.
-- Se não existir, cria com estado 'idle'.
-- Padrão: INSERT ... ON CONFLICT DO UPDATE (upsert idiomático no PG).
--
-- Uso típico: chamado pelo orquestrador de IA ao receber uma nova mensagem
-- antes de decidir o próximo passo do fluxo.
--
-- Parâmetros:
--   p_organization_id — obrigatório para RLS e particionamento futuro
--   p_conversation_id — conversa cujo estado deve ser recuperado/criado
-- ============================================================================
create or replace function central.get_or_create_conversation_state(
  p_organization_id uuid,
  p_conversation_id uuid
)
returns central.conversation_states
language plpgsql
security definer
set search_path = central, public
as $$
declare
  v_state central.conversation_states;
begin
  insert into central.conversation_states (
    organization_id,
    conversation_id,
    current_state
  )
  values (
    p_organization_id,
    p_conversation_id,
    'idle'
  )
  on conflict (conversation_id) do update
    set updated_at = now()
  returning * into v_state;

  return v_state;
end;
$$;

grant execute on function central.get_or_create_conversation_state(uuid, uuid) to service_role;

-- ============================================================================
-- FUNCTION: central.update_conversation_state
--
-- Atualiza o estado da máquina de estados de uma conversa.
-- Registra last_action e opcionalmente atualiza scheduling_context.
--
-- p_scheduling_context: se NULL, preserva o scheduling_context existente.
--   Se passado como '{}' (empty object), limpa o contexto.
--   Permite reset explícito sem ambiguidade.
--
-- Retorna: o registro atualizado (para confirmação pelo caller).
-- ============================================================================
create or replace function central.update_conversation_state(
  p_organization_id     uuid,
  p_conversation_id     uuid,
  p_new_state           text,
  p_last_action         text      default null,
  p_scheduling_context  jsonb     default null
)
returns central.conversation_states
language plpgsql
security definer
set search_path = central, public
as $$
declare
  v_state central.conversation_states;
begin
  update central.conversation_states
  set
    current_state      = p_new_state,
    last_action        = coalesce(p_last_action, last_action),
    last_action_at     = case when p_last_action is not null then now() else last_action_at end,
    scheduling_context = case when p_scheduling_context is not null then p_scheduling_context else scheduling_context end,
    updated_at         = now()
  where
    organization_id  = p_organization_id
    and conversation_id = p_conversation_id
  returning * into v_state;

  if not found then
    raise exception 'conversation_state not found for conversation_id=%', p_conversation_id;
  end if;

  return v_state;
end;
$$;

grant execute on function central.update_conversation_state(uuid, uuid, text, text, jsonb) to service_role;

-- ============================================================================
-- FUNCTION: central.update_contact_ai_memory
--
-- Faz merge da memória de IA do contato com novos dados.
-- Usa o operador || (jsonb concat) para mesclar — chaves novas são adicionadas,
-- chaves existentes são sobrescritas, chaves ausentes são preservadas.
--
-- Para apagar uma chave específica, use jsonb_set + null explícito na aplicação.
-- Para reset completo, passar p_memory_patch como o novo objeto completo
-- após limpar a coluna via UPDATE direto (service_role).
--
-- Equivale à função update_client_memory do Nina.
-- ============================================================================
create or replace function central.update_contact_ai_memory(
  p_organization_id  uuid,
  p_contact_id       uuid,
  p_memory_patch     jsonb
)
returns void
language plpgsql
security definer
set search_path = central, public
as $$
begin
  update central.contacts
  set
    ai_memory  = coalesce(ai_memory, '{}'::jsonb) || p_memory_patch,
    updated_at = now()
  where
    organization_id = p_organization_id
    and id          = p_contact_id
    and deleted_at  is null;

  if not found then
    raise exception 'contact not found or deleted: organization_id=%, contact_id=%',
      p_organization_id, p_contact_id;
  end if;
end;
$$;

grant execute on function central.update_contact_ai_memory(uuid, uuid, jsonb) to service_role;

-- ============================================================================
-- FUNCTION: central.claim_message_grouping_batch
--
-- Reclama um lote de itens da fila de agrupamento para processamento exclusivo.
-- Usa FOR UPDATE SKIP LOCKED para evitar que múltiplos workers processem
-- o mesmo item concorrentemente — padrão seguro para filas no PostgreSQL.
--
-- Condições de elegibilidade:
--   status = 'pending'
--   process_after <= now()  (delay expirou)
--   organization_id = p_organization_id (isolamento multi-tenant)
--
-- Após a claim, o status muda para 'processing'.
-- O worker deve:
--   1. Processar o item
--   2. UPDATE status = 'completed' (sucesso) ou 'failed' + error_message (falha)
-- ============================================================================
create or replace function central.claim_message_grouping_batch(
  p_organization_id uuid,
  p_batch_size      integer default 10
)
returns setof central.message_grouping_queue
language sql
security definer
set search_path = central, public
as $$
  update central.message_grouping_queue
  set
    status     = 'processing',
    updated_at = now()
  where id in (
    select id
    from central.message_grouping_queue
    where
      organization_id = p_organization_id
      and status      = 'pending'
      and process_after <= now()
    order by process_after asc
    limit p_batch_size
    for update skip locked
  )
  returning *;
$$;

grant execute on function central.claim_message_grouping_batch(uuid, integer) to service_role;

-- ============================================================================
-- FUNCTION: central.claim_send_queue_batch
--
-- Reclama um lote de itens da fila de envio para processamento exclusivo.
-- Mesmo padrão FOR UPDATE SKIP LOCKED da fila de agrupamento.
--
-- Condições de elegibilidade:
--   status = 'pending'
--   scheduled_at <= now()  (hora de envio chegou)
--   organization_id = p_organization_id
--
-- Após a claim, o status muda para 'processing'.
-- O worker deve:
--   1. Chamar o provider WhatsApp/Instagram
--   2. UPDATE status = 'completed', sent_at = now() (sucesso)
--         ou status = 'failed', error_message = '...' (falha)
--
-- Retentativas: retry_count é incrementado pelo worker antes de re-enfileirar
--   (UPDATE SET status = 'pending', retry_count = retry_count + 1, scheduled_at = now() + delay).
-- ============================================================================
create or replace function central.claim_send_queue_batch(
  p_organization_id uuid,
  p_batch_size      integer default 10
)
returns setof central.send_queue
language sql
security definer
set search_path = central, public
as $$
  update central.send_queue
  set
    status     = 'processing',
    updated_at = now()
  where id in (
    select id
    from central.send_queue
    where
      organization_id = p_organization_id
      and status      = 'pending'
      and scheduled_at <= now()
    order by scheduled_at asc
    limit p_batch_size
    for update skip locked
  )
  returning *;
$$;

grant execute on function central.claim_send_queue_batch(uuid, integer) to service_role;

-- ============================================================================
-- FUNCTION: central.cleanup_processed_queues
--
-- Remove itens antigos com status 'completed', 'failed' ou 'cancelled'
-- de ambas as filas assíncronas.
--
-- Propósito: evitar crescimento ilimitado das tabelas de fila.
--   Itens processados há > p_older_than_days dias não têm valor operacional.
--   Em caso de debug, os dados relevantes já estão em central.messages e
--   central.conversation_events (audit trail imutável).
--
-- Chamada recomendada: job agendado (pg_cron ou Supabase Edge Function cron)
--   diariamente, com p_older_than_days = 7.
--
-- Retorna: número total de linhas removidas.
-- ============================================================================
create or replace function central.cleanup_processed_queues(
  p_older_than_days integer default 7
)
returns integer
language plpgsql
security definer
set search_path = central, public
as $$
declare
  v_cutoff     timestamptz;
  v_grouping   integer;
  v_send       integer;
begin
  v_cutoff := now() - (p_older_than_days || ' days')::interval;

  delete from central.message_grouping_queue
  where
    status in ('completed', 'failed', 'cancelled')
    and updated_at < v_cutoff;
  get diagnostics v_grouping = row_count;

  delete from central.send_queue
  where
    status in ('completed', 'failed', 'cancelled')
    and updated_at < v_cutoff;
  get diagnostics v_send = row_count;

  return v_grouping + v_send;
end;
$$;

grant execute on function central.cleanup_processed_queues(integer) to service_role;

-- ============================================================================
-- 20260701010500_central_nina_seed.sql
-- ============================================================================
-- Central de Atendimento — Nina Integration: Seed Data
-- M-N06 | Nina Integration Block
-- Depends on:
--   20260701010000_central_nina_tables.sql (central.agent_settings, central.tag_definitions)
--   20260701010400_central_nina_functions.sql (não obrigatório, mas seed é o último passo)
--
-- O que faz:
--   1. Atualiza central.organizations (Universo ABA) com timezone e horário comercial
--   2. Cria configuração padrão de agente (central.agent_settings) para Universo ABA
--   3. Cria tags padrão (central.tag_definitions) alinhadas com contexto clínico
--
-- Idempotente: todos os inserts usam ON CONFLICT DO NOTHING ou ON CONFLICT DO UPDATE.
-- Re-executar esta migration não cria duplicatas.
--
-- ROLLBACK (somente dados, estrutura preservada):
--   delete from central.tag_definitions where organization_id = 'a0000000-0000-0000-0000-000000000001';
--   delete from central.agent_settings   where organization_id = 'a0000000-0000-0000-0000-000000000001';
--   update central.organizations set timezone = null, business_hours_start = null,
--     business_hours_end = null, business_days = null, agent_name = null
--   where id = 'a0000000-0000-0000-0000-000000000001';

-- ============================================================================
-- UPDATE: central.organizations — dados operacionais da Universo ABA
--
-- UUID 'a0000000-0000-0000-0000-000000000001' é o ID fixo da org padrão
-- inserido em 20260701000000_create_ca_schema.sql.
-- ============================================================================
update central.organizations
set
  timezone             = 'America/Sao_Paulo',
  business_hours_start = '08:00',
  business_hours_end   = '18:00',
  business_days        = '{1,2,3,4,5}',
  agent_name           = 'Nina'
where id = 'a0000000-0000-0000-0000-000000000001';

-- ============================================================================
-- INSERT: central.agent_settings — configuração padrão IA
--
-- inbox_id = NULL → configuração padrão da organização (org-level default).
-- Todos os campos de credencial ficam NULL — devem ser preenchidos no painel
-- de configurações após o deploy.
--
-- Autonomia do agente:
--   Esta migration NÃO define autonomia. `ai_model_mode` e
--   `auto_response_enabled` — que existiam aqui — foram substituídos por
--   `ai_mode` na 20260811100000, que nasce com default 'off'. O agente começa
--   desligado, e ligá-lo é ação explícita de um admin pela tela.
--
--   Modelo do LLM também saiu daqui: é OPENAI_MODEL, variável de runtime.
--   Deixar 'gpt-4o' gravado no banco criava a ilusão de que o banco escolhe o
--   modelo, quando nenhum consumidor OpenAI jamais leu essa coluna.
-- ============================================================================
insert into central.agent_settings (
  id,
  organization_id,
  inbox_id,
  system_prompt,
  response_delay_min,
  response_delay_max,
  message_breaking_enabled,
  elevenlabs_api_key,
  elevenlabs_voice_id,
  elevenlabs_model,
  elevenlabs_stability,
  elevenlabs_similarity_boost,
  elevenlabs_speed,
  tts_enabled
)
values (
  'b0000000-0000-0000-0000-000000000001',   -- UUID fixo para idempotência
  'a0000000-0000-0000-0000-000000000001',
  null,                                      -- org-level default
  null,                                      -- system_prompt: configurar no painel
  3,                                         -- delay mínimo: 3 segundos
  8,                                         -- delay máximo: 8 segundos
  true,                                      -- message_breaking: quebrará respostas longas
  null,                                      -- elevenlabs_api_key: configurar no painel
  null,                                      -- elevenlabs_voice_id: configurar no painel
  'eleven_multilingual_v2',
  0.50,
  0.75,
  1.00,
  false                                      -- TTS desligado por padrão
)
-- uq_agent_settings_org_default é um índice único PARCIAL (where inbox_id is null),
-- não uma constraint de tabela — ON CONFLICT ON CONSTRAINT não o aceita.
-- A inferência precisa repetir o mesmo predicado do índice.
--
-- ai_mode NÃO entra no do update: reaplicar o seed não deve desligar um agente
-- que o admin ligou.
on conflict (organization_id) where inbox_id is null do update
  set
    response_delay_min       = excluded.response_delay_min,
    response_delay_max       = excluded.response_delay_max,
    message_breaking_enabled = excluded.message_breaking_enabled,
    elevenlabs_model         = excluded.elevenlabs_model,
    elevenlabs_stability     = excluded.elevenlabs_stability,
    elevenlabs_similarity_boost = excluded.elevenlabs_similarity_boost,
    elevenlabs_speed         = excluded.elevenlabs_speed,
    updated_at               = now();

-- ============================================================================
-- INSERT: central.tag_definitions — tags padrão Universo ABA
--
-- Organizadas em 4 categorias:
--   Triagem       → estado do lead/contato novo
--   Atendimento   → estado operacional da conversa
--   Financeiro    → flags financeiras
--   Urgência      → prioridade operacional
-- ============================================================================
insert into central.tag_definitions (organization_id, key, label, color, category, is_active) values

  -- Triagem
  ('a0000000-0000-0000-0000-000000000001', 'lead_novo',          'Lead novo',          '#6366f1', 'Triagem',    true),
  ('a0000000-0000-0000-0000-000000000001', 'aguardando_triagem', 'Aguardando triagem', '#8b5cf6', 'Triagem',    true),
  ('a0000000-0000-0000-0000-000000000001', 'em_triagem',         'Em triagem',         '#a78bfa', 'Triagem',    true),
  ('a0000000-0000-0000-0000-000000000001', 'triagem_concluida',  'Triagem concluída',  '#7c3aed', 'Triagem',    true),

  -- Atendimento
  ('a0000000-0000-0000-0000-000000000001', 'sem_resposta',       'Sem resposta',       '#f59e0b', 'Atendimento', true),
  ('a0000000-0000-0000-0000-000000000001', 'em_andamento',       'Em andamento',       '#10b981', 'Atendimento', true),
  ('a0000000-0000-0000-0000-000000000001', 'matricula_pendente', 'Matrícula pendente', '#3b82f6', 'Atendimento', true),
  ('a0000000-0000-0000-0000-000000000001', 'documentacao',       'Documentação',       '#0ea5e9', 'Atendimento', true),
  ('a0000000-0000-0000-0000-000000000001', 'responsavel_viagem', 'Responsável viagem', '#64748b', 'Atendimento', true),

  -- Financeiro
  ('a0000000-0000-0000-0000-000000000001', 'negociacao',         'Negociação',         '#f97316', 'Financeiro',  true),
  ('a0000000-0000-0000-0000-000000000001', 'particular',         'Particular',         '#84cc16', 'Financeiro',  true),
  ('a0000000-0000-0000-0000-000000000001', 'convenio',           'Convênio',           '#22c55e', 'Financeiro',  true),

  -- Urgência
  ('a0000000-0000-0000-0000-000000000001', 'urgente',            'Urgente',            '#ef4444', 'Urgência',    true),
  ('a0000000-0000-0000-0000-000000000001', 'alta_prioridade',    'Alta prioridade',    '#f43f5e', 'Urgência',    true)

on conflict (organization_id, key) do update
  set
    label      = excluded.label,
    color      = excluded.color,
    category   = excluded.category,
    is_active  = excluded.is_active,
    updated_at = now();

-- ============================================================================
-- 20260810100000_central_appointments_slot_identity.sql
-- ============================================================================
-- Central de Atendimento — Agendamentos: identidade da vaga (slot)
-- Depends on:
--   20260701010000_central_nina_tables.sql (central.appointments)
--   20260701010100_central_nina_indexes.sql (idx_appointments_org_date, ...)
--
-- PROBLEMA QUE ESTA MIGRATION RESOLVE
--
-- central.appointments nasceu como "registro de intenção" genérico, com apenas
-- date + time + duration + tita_session_id. Isso é suficiente para uma agenda
-- comercial (demo/reunião), mas não para a agenda clínica: aqui um agendamento
-- ocupa a vaga de UM profissional específico, para UMA terapia, em UMA sala.
--
-- A vaga livre vem de public.vw_grade_base com status_agendamento = 'Livre'.
-- Medido em 2026-08-10 sobre 97.048 linhas de csv_grades_profissionais:
--   Agendado → 96.427 linhas, 96.427 com paciente_id
--   Livre    →    619 linhas,       0 com paciente_id e 0 com tita_agendamento_id
--
-- Ou seja: a vaga livre NÃO é um registro endereçável do TiTa — ela não tem id.
-- A TiTa a devolve com paciente_nome = 'Ainda não selecionado'. A única chave
-- que a identifica é a tupla natural (profissional_id, data, hora_inicial).
--
-- Consequência para tita_session_id: ele continua nullable e continua sendo o
-- vínculo com o TiTa, mas só pode ser preenchido DEPOIS que alguém efetivamente
-- cria a sessão no TiTa. Ele não serve para reservar, apenas para reconciliar.
--
-- Sem as colunas abaixo, dois agendamentos podiam cair na mesma vaga do mesmo
-- profissional sem que nada detectasse, e a recepção não tinha como saber qual
-- vaga honrar no TiTa.
--
-- ROLLBACK:
--   drop index if exists central.uq_appointments_slot_ocupada;
--   drop index if exists central.idx_appointments_org_profissional;
--   alter table central.appointments drop constraint if exists ck_appointments_status;
--   alter table central.appointments
--     drop column if exists tita_paciente_id,
--     drop column if exists sala_nome,
--     drop column if exists unidade_id,
--     drop column if exists terapia_nome,
--     drop column if exists terapia_id,
--     drop column if exists profissional_nome,
--     drop column if exists profissional_id;

-- ============================================================================
-- ALTER TABLE: central.appointments — identidade da vaga
--
-- Os campos *_nome são desnormalizados de propósito. A grade é congelada
-- (csv_grades_profissionais nunca sofre DELETE físico, linhas antigas viram
-- ativo = false), então o nome no momento da reserva é um fato histórico que
-- não deve mudar quando o profissional é desligado — o prefixo INATIVO- que a
-- TiTa aplica ao nome não deve reescrever agendamentos já registrados.
--
-- tita_paciente_id:
--   Paciente do TiTa que ocupará a vaga. BIGINT, não FK — o TiTa não é
--   controlado por este banco (mesma decisão de central.contact_patient_links).
--   Nullable: numa triagem de lead novo o paciente ainda não existe no TiTa.
-- ============================================================================
alter table central.appointments
  add column if not exists profissional_id   bigint,
  add column if not exists profissional_nome text,
  add column if not exists terapia_id        bigint,
  add column if not exists terapia_nome      text,
  add column if not exists unidade_id        bigint,
  add column if not exists sala_nome         text,
  add column if not exists tita_paciente_id  bigint;

comment on column central.appointments.profissional_id is
  'profissional_id do TiTa (vw_grade_base.profissional_id). Junto com date e time forma a identidade da vaga reservada.';
comment on column central.appointments.profissional_nome is
  'Nome do profissional no momento da reserva. Desnormalizado: é fato histórico e não deve mudar com desligamento (prefixo INATIVO-).';
comment on column central.appointments.terapia_id is
  'terapia_id do TiTa. A vaga livre é sempre de uma terapia específica — não é um horário genérico.';
comment on column central.appointments.unidade_id is
  'unidade_id do TiTa (280 = Realengo nos syncs atuais).';
comment on column central.appointments.tita_paciente_id is
  'Paciente do TiTa que ocupará a vaga. Nullable: em triagem de lead novo o paciente ainda não existe no TiTa.';

-- ============================================================================
-- CHECK: central.appointments.status
--
-- A coluna nasceu como text livre com default 'scheduled' e os valores válidos
-- só existiam no comentário da migration. Sem constraint, um typo ('confirmed '
-- com espaço, 'Confirmado') passa e some do índice parcial abaixo, o que
-- silenciosamente libera a vaga para reserva dupla.
--
-- NOT VALID: a tabela está vazia hoje, mas manter a validação barata e não
-- travar a migration caso ela rode depois de dados legados entrarem.
-- ============================================================================
alter table central.appointments
  drop constraint if exists ck_appointments_status;

alter table central.appointments
  add constraint ck_appointments_status
  check (status in ('scheduled', 'confirmed', 'cancelled', 'completed', 'no_show'))
  not valid;

-- ============================================================================
-- INDEX: uq_appointments_slot_ocupada
--
-- Guarda de reserva dupla no banco, não na aplicação: a mesma vaga
-- (profissional + data + hora) não pode ter dois agendamentos que a ocupem.
--
-- O predicado inclui apenas os status que de fato OCUPAM a vaga:
--   scheduled / confirmed → ocupam
--   cancelled / no_show   → liberam a vaga (o horário volta a ser oferecível)
--   completed             → passado, não disputa vaga futura
--
-- Isso é o que permite cancelar e reagendar para o mesmo horário sem
-- colidir com o registro cancelado.
--
-- profissional_id is not null: agendamentos administrativos (reunião com
-- responsável, followup) não consomem vaga de grade e ficam fora da guarda.
-- ============================================================================
create unique index if not exists uq_appointments_slot_ocupada
  on central.appointments (profissional_id, date, "time")
  where profissional_id is not null
    and status in ('scheduled', 'confirmed');

-- ============================================================================
-- INDEX: idx_appointments_org_profissional
--
-- Consulta "quais vagas deste profissional já estão reservadas na janela X"
-- roda a cada oferta de horário feita pelo agente. Sem este índice ela vira
-- seq scan em appointments a cada mensagem do WhatsApp.
-- ============================================================================
create index if not exists idx_appointments_org_profissional
  on central.appointments (organization_id, profissional_id, date)
  where profissional_id is not null;

-- ============================================================================
-- 20260810100100_central_vagas_disponiveis.sql
-- ============================================================================
-- Central de Atendimento — Motor de disponibilidade
-- Depends on:
--   20260810100000_central_appointments_slot_identity.sql (colunas de vaga em appointments)
--   public.vw_grade_base (20260806* — leitura única da grade)
--
-- POR QUE ISSO É UMA FUNÇÃO NO BANCO E NÃO CÓDIGO NO FRONTEND
--
-- A disponibilidade é a subtração de duas fontes que vivem em schemas diferentes:
--   public.vw_grade_base       → a vaga existe na grade do TiTa (status 'Livre')
--   central.appointments       → a vaga já foi prometida por nós a alguém
--
-- PostgREST não faz join entre schemas, então fazer isso no cliente exigiria
-- duas requisições e a subtração em memória — e, pior, cada consumidor
-- (a página de Agendamentos e o agente de WhatsApp) reimplementaria a regra,
-- que é exatamente como as duas telas passam a divergir. Uma função só,
-- consumida pelos dois, mantém a regra em um lugar.
--
-- SECURITY INVOKER (padrão, não DEFINER):
--   O chamador precisa de SELECT em public.vw_grade_base e em
--   central.appointments por direito próprio. A RLS de appointments continua
--   valendo — não há escalonamento de privilégio por aqui.
--
-- ROLLBACK:
--   drop function if exists central.listar_vagas_disponiveis(date, date, bigint, bigint, bigint, integer);
--   drop function if exists central.vaga_esta_disponivel(bigint, date, time);

-- ============================================================================
-- FUNCTION: central.listar_vagas_disponiveis
--
-- Uma "vaga" é a tupla (profissional_id, data, hora_inicial). Medido em
-- 2026-08-10: 619 vagas livres na base, 619 tuplas distintas — a tupla é chave
-- natural, o que também é o que a unique index uq_appointments_slot_ocupada
-- presume.
--
-- Filtro de passado (p_data_inicio default = hoje em São Paulo):
--   Oferecer horário que já passou é o erro mais visível que um atendente
--   automático pode cometer. No dia corrente a comparação é por hora, não só
--   por data — às 14h não se oferece a vaga das 09h20.
--
-- p_terapia_id filtra por terapia_id, nunca por terapia_nome:
--   34 das 619 vagas trazem terapia_nome como lista separada por vírgula
--   ("Aplicador ABA (PS), Psicopedagogia") porque o profissional atende mais de
--   uma especialidade naquele horário. O nome é texto de exibição; só o id é
--   chave confiável de filtro.
--
-- Janela default de 30 dias: a grade só é populada algumas semanas à frente
-- (em 2026-08-10 o horizonte ia até 2026-08-19). Pedir mais que isso não
-- devolve mais vaga, só custa scan.
-- ============================================================================
create or replace function central.listar_vagas_disponiveis(
  p_data_inicio     date    default null,
  p_data_fim        date    default null,
  p_terapia_id      bigint  default null,
  p_profissional_id bigint  default null,
  p_unidade_id      bigint  default null,
  p_limite          integer default 50
)
returns table (
  data              date,
  dia_semana        text,
  hora_inicial      time,
  hora_final        time,
  profissional_id   bigint,
  profissional_nome text,
  terapia_id        bigint,
  terapia_nome      text,
  unidade_id        bigint,
  unidade_nome      text,
  sala_nome         text
)
language sql
stable
set search_path = public, central
as $$
  with agora as (
    select (now() at time zone 'America/Sao_Paulo') as ts
  ),
  janela as (
    select
      coalesce(p_data_inicio, (select ts::date from agora))                as inicio,
      coalesce(p_data_fim,    (select ts::date from agora) + interval '30 days') as fim
  )
  select
    g.data,
    g.dia_semana,
    g.hora_inicial,
    g.hora_final,
    g.profissional_id,
    g.profissional_nome,
    g.terapia_id,
    g.terapia_nome,
    g.unidade_id,
    g.unidade_nome,
    g.sala_nome
  from public.vw_grade_base g
  cross join agora a
  cross join janela j
  where g.status_agendamento = 'Livre'
    and g.profissional_id is not null
    and g.hora_inicial     is not null
    and g.data >= j.inicio
    and g.data <= j.fim::date
    -- No dia corrente, descarta vaga cujo horário já passou
    and (g.data > a.ts::date or g.hora_inicial > a.ts::time)
    and (p_terapia_id      is null or g.terapia_id      = p_terapia_id)
    and (p_profissional_id is null or g.profissional_id = p_profissional_id)
    and (p_unidade_id      is null or g.unidade_id      = p_unidade_id)
    -- A vaga não pode já ter sido prometida por nós
    and not exists (
      select 1
      from central.appointments ap
      where ap.profissional_id = g.profissional_id
        and ap.date            = g.data
        and ap.time            = g.hora_inicial
        and ap.status in ('scheduled', 'confirmed')
    )
  order by g.data, g.hora_inicial, g.profissional_nome
  limit greatest(1, least(coalesce(p_limite, 50), 500));
$$;

comment on function central.listar_vagas_disponiveis(date, date, bigint, bigint, bigint, integer) is
  'Vagas ofertáveis: grade do TiTa com status_agendamento = Livre, menos as vagas já prometidas em central.appointments, menos o passado. Fonte única para a página de Agendamentos e para o agente de WhatsApp.';

grant execute on function central.listar_vagas_disponiveis(date, date, bigint, bigint, bigint, integer)
  to authenticated, service_role;

-- ============================================================================
-- FUNCTION: central.vaga_esta_disponivel
--
-- Checagem pontual de uma vaga específica, para o instante da reserva.
--
-- Por que existe além da unique index: a index rejeita a reserva dupla, mas com
-- erro 23505 genérico, e não distingue "essa vaga nunca existiu na grade" de
-- "essa vaga existia e alguém pegou primeiro". O agente precisa dessa diferença
-- para responder ao paciente com a frase certa. A index continua sendo a
-- garantia real contra corrida — esta função é a checagem amigável.
-- ============================================================================
create or replace function central.vaga_esta_disponivel(
  p_profissional_id bigint,
  p_data            date,
  p_hora            time
)
returns table (
  existe_na_grade boolean,
  ja_reservada    boolean,
  no_passado      boolean
)
language sql
stable
set search_path = public, central
as $$
  select
    exists (
      select 1 from public.vw_grade_base g
      where g.profissional_id   = p_profissional_id
        and g.data              = p_data
        and g.hora_inicial      = p_hora
        and g.status_agendamento = 'Livre'
    ) as existe_na_grade,
    exists (
      select 1 from central.appointments ap
      where ap.profissional_id = p_profissional_id
        and ap.date            = p_data
        and ap.time            = p_hora
        and ap.status in ('scheduled', 'confirmed')
    ) as ja_reservada,
    (p_data + p_hora) <= (now() at time zone 'America/Sao_Paulo') as no_passado;
$$;

comment on function central.vaga_esta_disponivel(bigint, date, time) is
  'Diagnóstico de uma vaga específica no instante da reserva: existe na grade, já foi reservada, ou está no passado. Separa os três motivos de recusa para o agente responder com precisão.';

grant execute on function central.vaga_esta_disponivel(bigint, date, time)
  to authenticated, service_role;

-- ============================================================================
-- 20260810110000_central_agent_settings_tts.sql
-- ============================================================================
-- ============================================================================
-- central.agent_settings — completar os parâmetros de voz da ElevenLabs
--
-- Por que existe:
--   A tela de configuração herdada do Nina (components/nina/settings/ApiSettings)
--   edita sete parâmetros de voz. A tabela criada em 20260701010000 tem cinco:
--   faltam `style` e `use_speaker_boost`, que a API da ElevenLabs aceita dentro
--   de voice_settings. Sem as colunas, o que o usuário ajusta na tela não tem
--   onde ser gravado e o áudio sai com um timbre diferente do que ele ouviu no
--   teste.
--
--   A tela também tinha um campo `audio_response_enabled`. Não é criado aqui:
--   é o mesmo conceito de `tts_enabled`, que já existe. Duas colunas para a
--   mesma decisão viram divergência silenciosa — a tela passa a ler tts_enabled.
--
-- Sobre a chave em texto puro:
--   `elevenlabs_api_key` continua em texto puro, como a migration original
--   documentou. O que esta migration garante é que ela nunca sai do banco pela
--   API: a view `agent_settings_public` (recriada abaixo) não a lista, e a rota
--   /api/central/agent-settings devolve apenas os quatro últimos caracteres.
--   Migrar para Supabase Vault segue como pendência aberta.
-- ============================================================================

alter table central.agent_settings
  add column if not exists elevenlabs_style         numeric(3,2) default 0.30,
  add column if not exists elevenlabs_speaker_boost boolean      not null default true;

comment on column central.agent_settings.elevenlabs_style is
  'voice_settings.style da ElevenLabs (0–1). Acima de ~0.5 a dicção fica instável.';
comment on column central.agent_settings.elevenlabs_speaker_boost is
  'voice_settings.use_speaker_boost. Aproxima o timbre da voz original ao custo de latência.';

-- ----------------------------------------------------------------------------
-- Recria a view pública incluindo os dois parâmetros novos.
--
-- DROP antes do CREATE, e não `create or replace`: o replace exige a mesma lista
-- de colunas na mesma ordem, e aqui elevenlabs_style entra no meio do bloco de
-- voz (ficar ao lado de similarity_boost é o que torna a view legível). Com
-- replace o Postgres recusa — "cannot change name of view column".
--
-- Nada depende desta view: ela nasceu na 20260701010300 e a UI passou a ler pela
-- rota /api/central/agent-settings. Se algum dia houver dependente, o DROP
-- falha em vez de derrubá-lo em silêncio (sem CASCADE, de propósito).
--
-- Os campos de credencial (elevenlabs_api_key, openai_assistant_id) seguem
-- omitidos de propósito: é isso que permite exibir a configuração de voz sem
-- expor a chave. `security_invoker` mantém a RLS de agent_settings valendo.
-- ----------------------------------------------------------------------------
drop view if exists central.agent_settings_public;

create view central.agent_settings_public
  with (security_invoker = true)
as
select
  id,
  organization_id,
  inbox_id,
  ai_model_mode,
  system_prompt,
  auto_response_enabled,
  response_delay_min,
  response_delay_max,
  message_breaking_enabled,
  -- openai_assistant_id omitido
  -- elevenlabs_api_key omitido
  elevenlabs_voice_id,
  elevenlabs_model,
  elevenlabs_stability,
  elevenlabs_similarity_boost,
  elevenlabs_style,
  elevenlabs_speed,
  elevenlabs_speaker_boost,
  tts_enabled,
  created_at,
  updated_at
from central.agent_settings;

comment on view central.agent_settings_public is
  'agent_settings sem colunas de credencial. Use esta view em qualquer leitura que chegue ao browser.';

-- ============================================================================
-- 20260810120000_central_filas_lease.sql
-- ============================================================================
-- ============================================================================
-- Filas da Central: lease de reivindicação e fila morta que não é apagada
--
-- PROBLEMA 1 — item travado em 'processing' nunca volta.
--   claim_message_grouping_batch e claim_send_queue_batch (20260701010400)
--   selecionavam apenas `status = 'pending'`. Um worker que morre no meio do
--   processamento deixa a linha em 'processing' para sempre: nenhum claim
--   futuro a alcança, e cleanup_processed_queues não a toca (só apagava
--   completed/failed/cancelled). O responsável nunca recebe resposta e nada
--   avisa. Com a fila vazia o defeito é invisível; com paciente do outro lado
--   é uma mensagem perdida em silêncio.
--
--   Correção: reivindicação com prazo (lease). O claim passa a alcançar também
--   itens 'processing' cujo `claimed_at` é mais antigo que o prazo, contando
--   `attempts`. Ao estourar `max_attempts` o item vira 'failed' com o motivo
--   escrito — nunca reivindicação infinita, nunca item esquecido.
--
-- PROBLEMA 2 — cleanup_processed_queues apagava 'failed'.
--   Passados 7 dias, o único registro de que uma resposta era devida e não
--   saiu era destruído, junto com o error_message que explicaria o porquê.
--   Correção: só 'completed' e 'cancelled' são apagados. 'failed' permanece
--   até alguém decidir o que fazer com ele.
--
-- Por que `attempts` e não reusar `retry_count`:
--   são dois fenômenos distintos. `retry_count` conta retentativa de negócio
--   (a Meta recusou, tenta de novo mais tarde). `attempts` conta quantas vezes
--   o item foi reivindicado por um worker. Um item com retry_count alto indica
--   provider instável; um item com attempts alto indica WORKER instável —
--   somar os dois num contador esconde o segundo diagnóstico.
-- ============================================================================

alter table central.message_grouping_queue
  add column if not exists claimed_at   timestamptz,
  add column if not exists attempts     integer not null default 0,
  add column if not exists max_attempts integer not null default 5;

alter table central.send_queue
  add column if not exists claimed_at   timestamptz,
  add column if not exists attempts     integer not null default 0,
  add column if not exists max_attempts integer not null default 5;

comment on column central.message_grouping_queue.claimed_at is
  'Instante da última reivindicação. Base do lease: passado o prazo, o item é reivindicável de novo.';
comment on column central.message_grouping_queue.attempts is
  'Quantas vezes um worker reivindicou este item. Alto = worker instável (distinto de retry_count).';
comment on column central.send_queue.claimed_at is
  'Instante da última reivindicação. Base do lease: passado o prazo, o item é reivindicável de novo.';
comment on column central.send_queue.attempts is
  'Quantas vezes um worker reivindicou este item. Alto = worker instável (distinto de retry_count).';

-- Índice que o claim usa: entra pelo status e ordena pelo instante devido.
create index if not exists idx_grouping_claim
  on central.message_grouping_queue (organization_id, status, process_after)
  where status in ('pending', 'processing');

create index if not exists idx_send_claim
  on central.send_queue (organization_id, status, scheduled_at)
  where status in ('pending', 'processing');

-- ----------------------------------------------------------------------------
-- DROP antes de recriar, e não `create or replace`.
--
-- As funções ganham um terceiro parâmetro (p_lease). O `create or replace`
-- casa por nome + tipos dos argumentos, então a versão de 2 argumentos
-- CONTINUARIA existindo como sobrecarga — e toda chamada com 2 argumentos
-- resolveria para ela, isto é, para a versão com o defeito. O drop explícito
-- é o que garante que a versão antiga morre.
-- ----------------------------------------------------------------------------
drop function if exists central.claim_message_grouping_batch(uuid, integer);
drop function if exists central.claim_send_queue_batch(uuid, integer);

-- ----------------------------------------------------------------------------
-- claim_message_grouping_batch
--
-- Duas etapas num só corpo, de propósito: quem reivindica também sepulta. Se o
-- sepultamento morasse numa função separada, dependeria de alguém se lembrar de
-- chamá-la — e o item esgotado voltaria a ser exatamente o que esta migration
-- corrige: linha em 'processing' que ninguém alcança.
-- ----------------------------------------------------------------------------
create function central.claim_message_grouping_batch(
  p_organization_id uuid,
  p_batch_size      integer  default 10,
  p_lease           interval default '2 minutes'
)
returns setof central.message_grouping_queue
language plpgsql
security definer
set search_path = central, public
as $$
begin
  -- 1. Sepulta o que estourou o teto: lease vencido E sem tentativa restante.
  update central.message_grouping_queue
  set
    status        = 'failed',
    error_message = coalesce(error_message || ' | ', '')
                    || format('esgotou max_attempts=%s apos %s reivindicacao(oes); ultima em %s',
                              max_attempts, attempts, claimed_at),
    updated_at    = now()
  where
    organization_id = p_organization_id
    and status      = 'processing'
    and claimed_at  < now() - p_lease
    and attempts   >= max_attempts;

  -- 2. Reivindica: pendente no prazo, ou em processamento com lease vencido.
  return query
  update central.message_grouping_queue q
  set
    status     = 'processing',
    claimed_at = now(),
    attempts   = q.attempts + 1,
    updated_at = now()
  where q.id in (
    select id
    from central.message_grouping_queue
    where
      organization_id   = p_organization_id
      and process_after <= now()
      and attempts       < max_attempts
      and (
        status = 'pending'
        or (status = 'processing' and claimed_at < now() - p_lease)
      )
    order by process_after asc
    limit p_batch_size
    for update skip locked
  )
  returning q.*;
end;
$$;

comment on function central.claim_message_grouping_batch(uuid, integer, interval) is
  'Reivindica itens da fila de agrupamento com lease. Recupera item de worker morto e sepulta o que estourou max_attempts.';

-- ----------------------------------------------------------------------------
-- claim_send_queue_batch — mesma mecânica, ordenada por scheduled_at.
--
-- A simetria é deliberada: o worker de envio e o de agrupamento têm a mesma
-- garantia de recuperação. Não foi fatorado numa função só porque as duas
-- tabelas têm colunas de agendamento diferentes (process_after vs scheduled_at)
-- e unificar exigiria SQL dinâmico — troca ruim para ganhar seis linhas.
-- ----------------------------------------------------------------------------
create function central.claim_send_queue_batch(
  p_organization_id uuid,
  p_batch_size      integer  default 10,
  p_lease           interval default '2 minutes'
)
returns setof central.send_queue
language plpgsql
security definer
set search_path = central, public
as $$
begin
  update central.send_queue
  set
    status        = 'failed',
    error_message = coalesce(error_message || ' | ', '')
                    || format('esgotou max_attempts=%s apos %s reivindicacao(oes); ultima em %s',
                              max_attempts, attempts, claimed_at),
    updated_at    = now()
  where
    organization_id = p_organization_id
    and status      = 'processing'
    and claimed_at  < now() - p_lease
    and attempts   >= max_attempts;

  return query
  update central.send_queue q
  set
    status     = 'processing',
    claimed_at = now(),
    attempts   = q.attempts + 1,
    updated_at = now()
  where q.id in (
    select id
    from central.send_queue
    where
      organization_id  = p_organization_id
      and scheduled_at <= now()
      and attempts      < max_attempts
      and (
        status = 'pending'
        or (status = 'processing' and claimed_at < now() - p_lease)
      )
    order by scheduled_at asc
    limit p_batch_size
    for update skip locked
  )
  returning q.*;
end;
$$;

comment on function central.claim_send_queue_batch(uuid, integer, interval) is
  'Reivindica itens da fila de envio com lease. Recupera item de worker morto e sepulta o que estourou max_attempts.';

-- ----------------------------------------------------------------------------
-- cleanup_processed_queues — 'failed' deixa de ser apagado.
--
-- Apagar item 'completed' é seguro: a mensagem correspondente vive em
-- central.messages, que é o registro real. Apagar item 'failed' destrói a única
-- evidência de que havia uma resposta a dar e ela não saiu.
-- ----------------------------------------------------------------------------
create or replace function central.cleanup_processed_queues(p_older_than_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = central, public
as $$
declare
  v_cutoff   timestamptz;
  v_grouping integer;
  v_send     integer;
begin
  v_cutoff := now() - (p_older_than_days || ' days')::interval;

  -- 'failed' fora da lista de propósito — ver comentário acima.
  delete from central.message_grouping_queue
  where
    status in ('completed', 'cancelled')
    and updated_at < v_cutoff;
  get diagnostics v_grouping = row_count;

  delete from central.send_queue
  where
    status in ('completed', 'cancelled')
    and updated_at < v_cutoff;
  get diagnostics v_send = row_count;

  return v_grouping + v_send;
end;
$$;

comment on function central.cleanup_processed_queues(integer) is
  'Apaga itens completed e cancelled antigos. NUNCA apaga failed: é o registro de resposta devida e não entregue.';

-- ----------------------------------------------------------------------------
-- Fila morta visível.
--
-- Contraparte de pending_queue_overview (20260701010300), que só mostra
-- pending/processing. Sem uma visão do que falhou, "nenhum registro se perde"
-- é intenção e não garantia: o registro existiria no banco e ninguém saberia.
--
-- security_invoker mantém a RLS das tabelas base valendo (select para
-- admin e director) — a view não escalona privilégio.
-- ----------------------------------------------------------------------------
create or replace view central.queue_dead_letter_overview
  with (security_invoker = true)
as
select
  'grouping'::text as queue_type,
  q.id             as item_id,
  q.organization_id,
  q.attempts,
  q.max_attempts,
  q.retry_count,
  q.error_message,
  q.created_at,
  q.updated_at     as failed_at,
  extract(epoch from now() - q.created_at)::integer as age_seconds
from central.message_grouping_queue q
where q.status = 'failed'

union all

select
  'send'::text,
  s.id,
  s.organization_id,
  s.attempts,
  s.max_attempts,
  s.retry_count,
  s.error_message,
  s.created_at,
  s.updated_at,
  extract(epoch from now() - s.created_at)::integer
from central.send_queue s
where s.status = 'failed';

comment on view central.queue_dead_letter_overview is
  'Itens de fila que falharam definitivamente. Nada aqui é apagado automaticamente — exige decisão humana.';

grant select on central.queue_dead_letter_overview to authenticated;

-- ============================================================================
-- 20260810120100_central_filas_idempotencia.sql
-- ============================================================================
-- ============================================================================
-- Filas da Central: idempotência na entrada e na saída
--
-- Os dois lados do mesmo problema — mensagem duplicada. Perder registro é ruim;
-- duplicar registro numa conversa com responsável de paciente também é, porque
-- a duplicata sai como mensagem de verdade no WhatsApp dele.
--
-- ENTRADA — a Meta reentrega webhook.
--   Quando o endpoint demora ou responde 5xx, a Cloud API reenvia o mesmo
--   evento. central.messages já se protege com uq_messages_ext_id, mas a FILA
--   não tinha proteção nenhuma: a mesma mensagem entrava duas vezes em
--   message_grouping_queue, era agrupada duas vezes e gerava duas respostas do
--   agente. O paciente recebia resposta dobrada.
--
-- SAÍDA — retry após aceite do provider.
--   send_queue não guardava o id que a Meta devolve. Um worker que morre entre
--   "a Meta aceitou" e "gravei em central.messages" fazia o reclaim reenviar a
--   mensagem: o responsável recebia o mesmo texto duas vezes, e o histórico
--   registrava uma. Guardando o id na própria linha da fila, o reclaim sabe
--   que o envio já ocorreu e só termina a persistência.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Entrada: um evento do provider ocupa no máximo uma linha de fila.
--
-- Índice total, não parcial: whatsapp_message_id é NOT NULL e a garantia vale
-- para qualquer status. Isso inclui itens já 'completed' — reentrega tardia da
-- Meta (horas depois) não pode reprocessar um recado já respondido.
--
-- Consequência operacional deliberada: reprocessar um item que falhou é
-- devolvê-lo para 'pending' (com attempts = 0), não inserir linha nova.
-- ----------------------------------------------------------------------------
create unique index if not exists uq_grouping_wa_msg
  on central.message_grouping_queue (organization_id, whatsapp_message_id);

comment on index central.uq_grouping_wa_msg is
  'Um evento do provider = uma linha de fila. Absorve a reentrega de webhook da Meta.';

-- ----------------------------------------------------------------------------
-- Saída: a linha da fila carrega o id que o provider devolveu.
--
-- Preenchido ANTES de persistir em central.messages, e é o que o worker
-- consulta ao reivindicar um item que já esteve em processamento: com id
-- presente, o envio não se repete.
-- ----------------------------------------------------------------------------
alter table central.send_queue
  add column if not exists external_message_id text;

comment on column central.send_queue.external_message_id is
  'Id devolvido pelo provider, gravado antes de persistir a mensagem. Presente = já enviado: o reclaim não reenvia.';

-- ============================================================================
-- 20260810120200_central_send_queue_fk_restrict.sql
-- ============================================================================
-- ============================================================================
-- send_queue: apagar contato não pode apagar mensagem que não saiu
--
-- As duas FKs vinham com ON DELETE CASCADE:
--   send_queue.contact_id      → contacts
--   send_queue.conversation_id → conversations
--
-- O efeito é silencioso e do tipo pior: apagar um contato remove, sem erro e
-- sem rastro, mensagens que ainda estavam na fila para sair. Ninguém descobre —
-- não há linha em 'failed', não há erro, a fila simplesmente encurta.
--
-- CASCADE faz sentido para o que é PARTE do registro pai (identificadores de um
-- contato, anexos de uma mensagem — esses ficam como estão). Uma mensagem
-- pendente de envio não é parte do contato: é um compromisso nosso com ele.
--
-- Com RESTRICT o DELETE falha e a exclusão passa a exigir decisão explícita:
-- cancelar os envios pendentes primeiro. Na prática não deve acontecer, porque
-- central.contacts usa exclusão lógica (deleted_at) — o que torna o CASCADE
-- ainda mais gratuito como risco.
--
-- Itens antigos não travam exclusão para sempre: cleanup_processed_queues
-- remove 'completed' e 'cancelled' passados N dias. Só 'failed' e pendências
-- reais seguram, e é exatamente o que se quer que segure.
-- ============================================================================

alter table central.send_queue
  drop constraint if exists send_queue_contact_id_fkey,
  drop constraint if exists send_queue_conversation_id_fkey;

alter table central.send_queue
  add constraint send_queue_contact_id_fkey
    foreign key (contact_id) references central.contacts(id)
    on delete restrict,
  add constraint send_queue_conversation_id_fkey
    foreign key (conversation_id) references central.conversations(id)
    on delete restrict;

-- ============================================================================
-- 20260810120300_central_grants_credenciais.sql
-- ============================================================================
-- ============================================================================
-- Central: reduzir privilégio ao que a RLS já permite, e tornar credencial
-- gravável mas não legível pelo browser
--
-- Situação anterior: `authenticated` tinha SELECT + INSERT + UPDATE + DELETE nas
-- 22 tabelas e views do schema central. A RLS impedia o abuso, mas era defesa
-- única — e várias tabelas têm uma policy só (apenas SELECT), de modo que os
-- grants de escrita existiam sem nenhuma policy que os autorizasse: privilégio
-- concedido sem uso, que só serve para o dia em que uma policy for afrouxada
-- por engano.
--
-- Duas mudanças, com propósitos diferentes:
--
-- 1. Filas e trilha de auditoria: só leitura para `authenticated`. Quem escreve
--    nelas é worker com service role. Auditoria que o próprio usuário pode
--    alterar não é auditoria.
--
-- 2. Colunas de credencial: privilégio de ESCRITA sem privilégio de LEITURA.
--    É o formato exato do que se quer — o admin cola a chave pela tela (precisa
--    gravar) e nunca a lê de volta (o servidor lê com service role). Sem isso,
--    um admin com a chave anônima e o schema exposto faz
--    `GET /rest/v1/agent_settings?select=elevenlabs_api_key` e leva a chave.
--
-- ATENÇÃO ao comportamento de privilégio por coluna (já documentado neste
-- projeto): REVOKE de coluna NÃO subtrai um grant de tabela. É preciso revogar
-- a tabela inteira e então conceder coluna por coluna. E sob privilégio por
-- coluna, `select('*')` passa a responder 403 — por isso as leituras destas
-- duas tabelas listam colunas explicitamente (ver COLUNAS_SEGURAS em
-- modules/atendimento/repositories/agent-settings.repository.ts).
--
-- CONSEQUÊNCIA DELIBERADA: coluna nova adicionada a estas tabelas nasce SEM
-- grant de leitura para `authenticated`. Falha fechada — uma credencial futura
-- não vaza por esquecimento. O preço é que coluna nova e inofensiva precisa ser
-- concedida explicitamente aqui.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Filas e auditoria: leitura apenas
-- ----------------------------------------------------------------------------
revoke insert, update, delete on central.message_grouping_queue from authenticated;
revoke insert, update, delete on central.send_queue             from authenticated;
revoke insert, update, delete on central.conversation_states    from authenticated;
revoke insert, update, delete on central.conversation_events    from authenticated;

-- Views nunca deveriam ter tido escrita — não há caso de uso, e uma view
-- atualizável sobre tabela com credencial é caminho de escrita não auditado.
revoke insert, update, delete on central.agent_settings_public  from authenticated;
revoke insert, update, delete on central.contacts_with_stats    from authenticated;
revoke insert, update, delete on central.pending_queue_overview from authenticated;

-- ----------------------------------------------------------------------------
-- 2. central.agent_settings — elevenlabs_api_key deixa de ser legível
--
-- SELECT: todas as colunas MENOS elevenlabs_api_key.
-- INSERT/UPDATE: todas, inclusive a chave — é assim que a tela grava.
--
-- openai_assistant_id continua legível: é identificador, não segredo. A chave
-- da OpenAI não mora no banco (é variável de runtime), justamente para não
-- existir aqui uma segunda credencial a proteger.
-- ----------------------------------------------------------------------------
revoke all on central.agent_settings from authenticated;

grant select (
  id, organization_id, inbox_id,
  ai_model_mode, system_prompt, auto_response_enabled,
  response_delay_min, response_delay_max, message_breaking_enabled,
  openai_assistant_id,
  elevenlabs_voice_id, elevenlabs_model,
  elevenlabs_stability, elevenlabs_similarity_boost,
  elevenlabs_style, elevenlabs_speed, elevenlabs_speaker_boost,
  tts_enabled, created_at, updated_at
) on central.agent_settings to authenticated;

grant insert (
  id, organization_id, inbox_id,
  ai_model_mode, system_prompt, auto_response_enabled,
  response_delay_min, response_delay_max, message_breaking_enabled,
  openai_assistant_id,
  elevenlabs_api_key,
  elevenlabs_voice_id, elevenlabs_model,
  elevenlabs_stability, elevenlabs_similarity_boost,
  elevenlabs_style, elevenlabs_speed, elevenlabs_speaker_boost,
  tts_enabled
) on central.agent_settings to authenticated;

grant update (
  inbox_id,
  ai_model_mode, system_prompt, auto_response_enabled,
  response_delay_min, response_delay_max, message_breaking_enabled,
  openai_assistant_id,
  elevenlabs_api_key,
  elevenlabs_voice_id, elevenlabs_model,
  elevenlabs_stability, elevenlabs_similarity_boost,
  elevenlabs_style, elevenlabs_speed, elevenlabs_speaker_boost,
  tts_enabled, updated_at
) on central.agent_settings to authenticated;

-- ----------------------------------------------------------------------------
-- 3. central.channel_connections — provider_metadata deixa de ser legível
--
-- É onde o access token do WhatsApp e o phone_number_id vão morar. A policy de
-- SELECT permite a qualquer admin ler a linha; sem privilégio por coluna, ler a
-- linha é ler o token.
--
-- Nenhum código lê esta tabela hoje, então o privilégio por coluna entra sem
-- quebrar nada — e entra ANTES de existir credencial nela, que é a única ordem
-- em que esse tipo de proteção é barata.
-- ----------------------------------------------------------------------------
revoke all on central.channel_connections from authenticated;

grant select (
  id, organization_id, channel_id,
  external_id, provider_instance_id, provider_account_id,
  connection_status, last_sync_at, created_at, updated_at
) on central.channel_connections to authenticated;

grant insert (
  id, organization_id, channel_id,
  external_id, provider_instance_id, provider_account_id,
  provider_metadata,
  connection_status, last_sync_at
) on central.channel_connections to authenticated;

grant update (
  external_id, provider_instance_id, provider_account_id,
  provider_metadata,
  connection_status, last_sync_at, updated_at
) on central.channel_connections to authenticated;

-- ----------------------------------------------------------------------------
-- 4. View sem a credencial, para leitura de tela
--
-- Contraparte de agent_settings_public. security_invoker mantém a RLS da tabela
-- base valendo (SELECT só para admin) — a view não escalona privilégio, só
-- garante que a coluna de credencial não é listável por descuido.
-- ----------------------------------------------------------------------------
create or replace view central.channel_connections_public
  with (security_invoker = true)
as
select
  id,
  organization_id,
  channel_id,
  external_id,
  provider_instance_id,
  provider_account_id,
  -- provider_metadata omitido: guarda access token do provider
  connection_status,
  last_sync_at,
  created_at,
  updated_at
from central.channel_connections;

comment on view central.channel_connections_public is
  'channel_connections sem provider_metadata. Use em qualquer leitura que chegue ao browser.';

grant select on central.channel_connections_public to authenticated;

-- ============================================================================
-- 20260810120400_central_criar_mensagem_com_anexos.sql
-- ============================================================================
-- ============================================================================
-- central.criar_mensagem_com_anexos — mensagem e anexos numa transação só
--
-- MessageRepository.createWithAttachments fazia duas viagens ao banco: insere a
-- mensagem, depois insere os anexos um a um. Sem transação, falha no segundo
-- passo deixa a mensagem gravada SEM o anexo — e é o pior estado possível para
-- áudio de WhatsApp, porque `body` de mensagem de áudio é vazio: o orquestrador
-- recebe uma mensagem sem texto e sem áudio, não tem o que responder, e o
-- responsável fica achando que mandou um áudio que a clínica ignorou.
--
-- Uma função plpgsql roda numa transação implícita: ou a mensagem e todos os
-- anexos existem, ou nada existe.
--
-- SECURITY INVOKER (o padrão, não declarado) de propósito: os privilégios do
-- chamador continuam valendo. O worker de webhook usa service role e passa; um
-- operador humano passa pela RLS de messages_insert. Marcar SECURITY DEFINER
-- aqui abriria uma porta de INSERT sem RLS para qualquer `authenticated`.
--
-- Entrada em jsonb em vez de 20 parâmetros: o repositório já monta objetos, e
-- assinatura de função com 20 argumentos posicionais é onde se trocam dois
-- campos de texto sem ninguém perceber.
-- ============================================================================

create or replace function central.criar_mensagem_com_anexos(
  p_mensagem jsonb,
  p_anexos   jsonb default '[]'::jsonb
)
returns central.messages
language plpgsql
set search_path = central, public
as $$
declare
  v_msg central.messages;
begin
  if p_mensagem is null then
    raise exception 'p_mensagem é obrigatório';
  end if;

  insert into central.messages (
    organization_id,
    conversation_id,
    external_message_id,
    direction,
    message_type,
    body,
    provider,
    sent_by_user_id,
    sent_by_ai,
    reply_to_message_id,
    status,
    sent_at
  )
  values (
    (p_mensagem->>'organization_id')::uuid,
    (p_mensagem->>'conversation_id')::uuid,
    -- nullif em toda coluna opcional: o cliente manda '' onde queria null, e ''
    -- em external_message_id escaparia do índice parcial uq_messages_ext_id
    -- (que só cobre valor não-nulo) — duas mensagens com '' passariam.
    nullif(p_mensagem->>'external_message_id', ''),
    p_mensagem->>'direction',
    coalesce(nullif(p_mensagem->>'message_type', ''), 'text'),
    p_mensagem->>'body',
    nullif(p_mensagem->>'provider', '')::central.provider_type,
    nullif(p_mensagem->>'sent_by_user_id', '')::uuid,
    coalesce((p_mensagem->>'sent_by_ai')::boolean, false),
    nullif(p_mensagem->>'reply_to_message_id', '')::uuid,
    coalesce(nullif(p_mensagem->>'status', ''), 'pending'),
    nullif(p_mensagem->>'sent_at', '')::timestamptz
  )
  returning * into v_msg;

  -- Um único INSERT ... SELECT para todos os anexos. organization_id e
  -- message_id vêm da mensagem recém-criada, nunca do payload: assim um
  -- payload malformado não consegue pendurar anexo em mensagem de outra
  -- organização.
  insert into central.message_attachments (
    organization_id,
    message_id,
    file_name,
    file_type,
    file_size,
    external_url,
    storage_status,
    duration_secs
  )
  select
    v_msg.organization_id,
    v_msg.id,
    nullif(a->>'file_name', ''),
    nullif(a->>'file_type', ''),
    nullif(a->>'file_size', '')::bigint,
    nullif(a->>'external_url', ''),
    coalesce(nullif(a->>'storage_status', ''), 'pending'),
    nullif(a->>'duration_secs', '')::integer
  from jsonb_array_elements(coalesce(p_anexos, '[]'::jsonb)) as a;

  return v_msg;
end;
$$;

comment on function central.criar_mensagem_com_anexos(jsonb, jsonb) is
  'Insere mensagem e seus anexos atomicamente. Mensagem de áudio sem anexo é indistinguível de mensagem vazia — daí a transação.';

grant execute on function central.criar_mensagem_com_anexos(jsonb, jsonb) to authenticated;

-- ============================================================================
-- Livro-caixa das migrations
-- ============================================================================
insert into supabase_migrations.schema_migrations (version, name) values
  ('20260701010000','central_nina_tables'),
  ('20260701010100','central_nina_indexes'),
  ('20260701010200','central_nina_rls'),
  ('20260701010300','central_nina_views'),
  ('20260701010400','central_nina_functions'),
  ('20260701010500','central_nina_seed'),
  ('20260810100000','central_appointments_slot_identity'),
  ('20260810100100','central_vagas_disponiveis'),
  ('20260810110000','central_agent_settings_tts'),
  ('20260810120000','central_filas_lease'),
  ('20260810120100','central_filas_idempotencia'),
  ('20260810120200','central_send_queue_fk_restrict'),
  ('20260810120300','central_grants_credenciais'),
  ('20260810120400','central_criar_mensagem_com_anexos')
on conflict (version) do nothing;

commit;
