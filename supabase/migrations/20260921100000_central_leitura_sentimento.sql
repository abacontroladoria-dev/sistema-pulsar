-- Central de Atendimento — Leitura de sentimento do contato
--
-- Depends on:
--   20260701000000_create_ca_schema.sql        (schema central, grants, default privileges)
--   20260701000400_create_ca_contacts.sql      (central.contacts)
--   20260701000700_create_ca_rls_helpers.sql   (current_organization_id, ca_current_role)
--
-- O bloco "Leitura da IA" do painel de detalhamento do inbox: para que lado a
-- pessoa está inclinada, olhando os últimos 30 dias do que ela escreveu.
--
-- POR QUE POR CONTATO, E NÃO POR CONVERSA
--
-- `central.conversations` já tem as colunas `sentiment` e `intent` desde
-- 20260701000500, e NENHUM código jamais escreveu nelas. A tentação é usá-las.
-- Não servem aqui, por duas razões independentes:
--
--   1. ESCOPO. Uma conversa é resolvida e outra nasce quando a pessoa volta —
--      é o que o índice uq_conversations_active_per_contact_channel garante.
--      Uma janela de 30 dias atravessa várias. Amarrar a leitura à conversa
--      faria a reclamação da semana passada desaparecer junto com o
--      atendimento que a encerrou, que é exatamente quando ela mais importa.
--
--   2. TIPO. São `text` livre. A leitura aqui é enumerada, e coluna livre não
--      protege leitura nenhuma — o consumidor precisa tratar um valor fora do
--      vocabulário que o banco aceitou sem reclamar.
--
-- As duas colunas ficam como estão. Mexer nelas é outro assunto.
--
-- ============================================================================
-- ROLLBACK REFERENCE (execute em ordem inversa para desfazer):
--
--   drop table if exists central.contact_sentiment_readings;
--   drop type  if exists central.sentiment_label;
-- ============================================================================

-- ============================================================================
-- TYPE: central.sentiment_label
--
-- Enum, e não text com CHECK, porque o valor é lido por um componente que
-- ramifica em três casos e precisa de um `default` seguro. O enum faz o banco
-- recusar um quarto valor no INSERT — que é o ponto, já que quem escreve aqui é
-- um modelo de linguagem e não um formulário.
--
-- Em português para casar com o vocabulário do módulo `atendimento` e com o que
-- o modelo devolve no tool call. Traduzir na fronteira criaria um de-para que
-- alguém acabaria aplicando ao contrário.
-- ============================================================================
create type central.sentiment_label as enum ('positivo', 'neutro', 'negativo');

-- ============================================================================
-- TABLE: central.contact_sentiment_readings
--
-- APPEND-ONLY. A linha nasce e nunca é atualizada, e é isso que permite dizer
-- "negativo, piorando desde 12/09". Um upsert de uma linha por contato — que é
-- como a referência que inspirou esta feature faz — só sabe responder "como
-- está agora", e "para que lado pende" é uma pergunta sobre MOVIMENTO. Sem duas
-- leituras não há tendência, e a tendência é metade do que o atendente precisa
-- para decidir a conduta.
--
-- Não há trigger `set_updated_at` e não há coluna `updated_at`: elas descreveriam
-- uma atualização que não pode acontecer.
--
-- Modelagem:
--
--   contact_id — `on delete cascade`. Leitura de sentimento de uma pessoa
--     apagada não é histórico, é dado pessoal órfão.
--
--   confidence — quanto o modelo confia na própria classificação. Fica visível
--     na interface de propósito: uma leitura "negativo, 41%" merece outra
--     reação do atendente que "negativo, 95%", e esconder isso transformaria um
--     palpite em veredito.
--
--   headline / reasoning — separados porque cumprem funções diferentes na tela.
--     `headline` é o que se lê de relance; `reasoning` é o que justifica, e
--     precisa citar o que a pessoa de fato disse. Um campo só forçaria a
--     escolher entre ser escaneável e ser verificável.
--
--   recommendations jsonb — o que fazer na próxima resposta. Array de 1 a 3
--     strings. jsonb e não text[] pela mesma razão que central.contacts usa
--     jsonb em ai_memory: o conteúdo vem de um modelo e pode ganhar estrutura
--     depois sem migration.
--
--   last_message_at — A MARCA D'ÁGUA, e a coluna menos óbvia da tabela.
--     É o `sent_at` da mensagem mais recente que entrou NESTA leitura, e é
--     contra ela que o gatilho automático conta quantas mensagens novas
--     chegaram. Contar contra `created_at` da própria linha (como a referência
--     faz) erra sempre que a análise demora: as mensagens que chegam DURANTE a
--     chamada ao modelo entram na leitura e depois são contadas de novo como
--     novas, disparando uma segunda análise que lê quase o mesmo material e
--     cobra outra vez.
--
--   triggered_by — 'auto' ou 'manual'. Existe para responder "por que esta
--     leitura foi feita", que é a primeira pergunta de quem investiga custo.
-- ============================================================================
create table central.contact_sentiment_readings (
  id                 uuid                     primary key default gen_random_uuid(),
  organization_id    uuid                     not null references central.organizations(id),
  contact_id         uuid                     not null references central.contacts(id) on delete cascade,

  sentiment          central.sentiment_label  not null,
  confidence         numeric(3,2)             not null,
  headline           text                     not null,
  reasoning          text                     not null,
  recommendations    jsonb                    not null default '[]'::jsonb,

  messages_analyzed  integer                  not null default 0,
  window_start       timestamptz              not null,
  window_end         timestamptz              not null,
  last_message_at    timestamptz,

  -- Modelo que RESPONDEU, não o que foi pedido: a OpenAI resolve alias para
  -- versão datada, e é a versão que define o preço. Mesma escolha de LlmUso.
  model              text                     not null,
  triggered_by       text                     not null,
  created_at         timestamptz              not null default now(),

  constraint ck_csr_confidence
    check (confidence >= 0 and confidence <= 1),

  constraint ck_csr_triggered_by
    check (triggered_by in ('auto', 'manual')),

  -- Janela invertida produziria "analisou de amanhã até ontem" — impossível de
  -- notar na tela e suficiente para tornar qualquer contagem de período falsa.
  constraint ck_csr_janela
    check (window_end >= window_start),

  -- Um array vazio passaria pelo `default` e chegaria ao painel como um bloco
  -- "o que fazer" sem nada dentro. Se não há recomendação, não houve leitura
  -- útil. O teto de 3 é o do prompt, repetido aqui porque o prompt é uma
  -- instrução e isto é uma garantia.
  constraint ck_csr_recomendacoes
    check (
      jsonb_typeof(recommendations) = 'array'
      and jsonb_array_length(recommendations) between 1 and 3
    ),

  constraint ck_csr_textos_nao_vazios
    check (length(btrim(headline)) > 0 and length(btrim(reasoning)) > 0)
);

-- A consulta é sempre "as duas últimas leituras desta pessoa" (a atual e a
-- anterior, para a tendência). Liderado por organization_id como o resto do
-- schema, porque toda consulta é dentro de uma organização pela RLS.
create index idx_csr_contato_recente
  on central.contact_sentiment_readings (organization_id, contact_id, created_at desc);

-- ============================================================================
-- RLS
--
-- ATENÇÃO — esta linha NÃO é opcional e NÃO é redundante.
--
-- O event trigger public.rls_auto_enable, que liga RLS em toda tabela nova,
-- filtra `cmd.schema_name IN ('public')` (20260518131652_remote_schema.sql) e
-- portanto IGNORA o schema `central`. Ao mesmo tempo, o ALTER DEFAULT
-- PRIVILEGES de 20260701000000 já concedeu select/insert/update/delete a
-- `authenticated` para tabelas futuras deste schema.
--
-- Some-se as duas coisas: sem o comando abaixo, esta tabela nasce LEGÍVEL por
-- qualquer usuário autenticado da instância, inclusive de outra organização — e
-- o que ela guarda é um julgamento sobre o estado emocional de uma pessoa
-- identificada. É o inverso do que acontece em `public`, e por isso é fácil
-- esquecer.
-- ============================================================================
alter table central.contact_sentiment_readings enable row level security;

create policy csr_select
  on central.contact_sentiment_readings
  for select
  to authenticated
  using (
    organization_id = central.current_organization_id()
    and central.ca_current_role() in ('admin', 'director')
  );

-- INSERT existe para o botão "Reanalisar" do painel, que roda com a sessão do
-- atendente. O gatilho automático escreve com service_role, que bypassa RLS.
create policy csr_insert
  on central.contact_sentiment_readings
  for insert
  to authenticated
  with check (
    organization_id = central.current_organization_id()
    and central.ca_current_role() in ('admin', 'director')
  );

-- Sem policy de UPDATE e sem policy de DELETE, de propósito: a tabela é
-- append-only e `authenticated` não tem por que reescrever um histórico cuja
-- utilidade inteira depende de ele ser fiel. A ausência da policy é o que impõe
-- isso — os privilégios de tabela já foram concedidos pelo ALTER DEFAULT
-- PRIVILEGES do schema, então RLS é a única camada que resta aqui.

comment on table central.contact_sentiment_readings is
  'Leituras de sentimento do contato feitas por IA sobre uma janela de dias. Append-only: a sequência de linhas é o que permite mostrar tendência. Alimenta o bloco Leitura da IA do painel de detalhamento do inbox.';
comment on column central.contact_sentiment_readings.last_message_at is
  'sent_at da mensagem mais recente incluída nesta leitura. Marca d''água do gatilho automático: é contra ela que se conta quantas mensagens novas chegaram desde a última análise. Usar created_at da linha contaria em dobro o que chegou durante a chamada ao modelo.';
comment on column central.contact_sentiment_readings.confidence is
  'Confiança do modelo na própria classificação, 0 a 1. Exibida na interface: "negativo a 41%" pede outra reação que "negativo a 95%".';
comment on column central.contact_sentiment_readings.triggered_by is
  'auto (worker tick, a cada N mensagens novas) ou manual (botão Reanalisar). Responde "por que esta leitura foi feita", que é a primeira pergunta de quem investiga custo.';

notify pgrst, 'reload schema';
