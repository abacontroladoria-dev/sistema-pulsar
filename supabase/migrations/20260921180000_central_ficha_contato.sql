-- Central de Atendimento — Ficha do paciente coletada na conversa
--
-- Depends on:
--   20260701000000_create_ca_schema.sql        (schema central, grants, default privileges)
--   20260701000400_create_ca_contacts.sql      (central.contacts, contact_patient_links)
--   20260701000700_create_ca_rls_helpers.sql   (current_organization_id, ca_current_role)
--   20260817190000_pacientes_canonica.sql      (public.pacientes.tita_paciente_id)
--
-- O bloco "Ficha do paciente" do painel de detalhamento do inbox, e o lugar
-- onde a Maia grava o que descobre conversando com um responsável novo.
--
-- POR QUE ESTA TABELA NÃO GUARDA A FICHA INTEIRA
--
-- Seis campos aparecem na tela: nome do paciente, nascimento, idade, nome do
-- responsável, turno para terapias e plano de saúde. Quatro deles JÁ EXISTEM
-- em public.pacientes para quem é da clínica, alcançáveis por
-- central.contact_patient_links.tita_paciente_id -> pacientes.tita_paciente_id.
--
-- Esta tabela guarda APENAS o que a conversa revelou, e nunca uma cópia do
-- cadastro. Copiar o TiTa para cá criaria duas verdades sobre o mesmo paciente,
-- e a cópia envelheceria calada: o plano muda no TiTa e o painel continuaria
-- exibindo o de seis meses atrás com cara de dado atual. O merge acontece na
-- leitura (services/ficha.service.ts), onde o cadastro vence campo a campo.
--
-- Nenhuma mudança de RLS é necessária do lado de `public.pacientes`: a policy
-- `pacientes_select` é `using (true)` para `authenticated` e 20260826100500
-- registra que ela não deve ser tocada, porque Cronograma, CCO, Central de
-- Pacientes e listar_central_pacientes() dependem dela. A leitura do cadastro
-- feita aqui é SELECT de colunas nomeadas, e passa por essa policy como as
-- outras telas passam.
--
-- A IDADE NÃO É COLUNA, E ISSO É DELIBERADO
--
-- Idade é função de `birth_date` e do dia de hoje. Gravá-la produziria um
-- número correto no instante da escrita e errado daí em diante — e errado de um
-- jeito que ninguém percebe, porque 6 e 7 são igualmente plausíveis. É calculada
-- na renderização.
--
-- POR QUE UMA LINHA POR CONTATO, E NÃO APPEND-ONLY
--
-- A tabela vizinha (contact_sentiment_readings, 20260921100000) é append-only
-- de propósito: lá a pergunta é sobre MOVIMENTO ("piorando desde 12/09") e sem
-- duas leituras não há tendência. Aqui a pergunta é "o que sabemos agora". Um
-- histórico de fichas parciais — nome preenchido, depois nome + turno, depois
-- os três — não responde nada que justifique o custo de consultá-lo.
--
-- ============================================================================
-- ROLLBACK REFERENCE (execute em ordem inversa para desfazer):
--
--   drop table if exists central.contact_intake;
--   drop type  if exists central.therapy_shift;
-- ============================================================================

-- ============================================================================
-- TYPE: central.therapy_shift
--
-- Enum e não text livre porque quem escreve aqui é um modelo de linguagem.
-- Um responsável diz "de manhãzinha", "só depois do almoço", "tanto faz" — e
-- sem um vocabulário fechado cada turno gravaria uma grafia diferente da mesma
-- coisa, tornando a coluna inútil para qualquer filtro futuro.
--
-- 'indiferente' existe e NÃO é o mesmo que NULL. NULL é "a Maia ainda não
-- perguntou"; 'indiferente' é "perguntou e a pessoa disse que tanto faz". Sem
-- essa distinção a Maia perguntaria de novo a cada turno, porque o campo
-- continuaria parecendo vazio.
--
-- Em português para casar com o vocabulário do módulo `atendimento` e com o que
-- o modelo devolve no tool call, pela mesma razão de central.sentiment_label.
-- 'manha' sem til: valor de enum é identificador, e acento em identificador
-- cobra escaping em todo lugar que o cite.
-- ============================================================================
create type central.therapy_shift as enum ('manha', 'tarde', 'integral', 'indiferente');

-- ============================================================================
-- TABLE: central.contact_intake
--
-- Modelagem:
--
--   contact_id PRIMARY KEY — uma linha por contato, sem id sintético. A chave
--     natural é o contato, e um id próprio só criaria a possibilidade de duas
--     fichas para a mesma pessoa. `on delete cascade` porque ficha de contato
--     apagado não é histórico, é dado pessoal de menor sem dono.
--
--   birth_date date, NÃO text — a Maia vai ouvir "12 de março de 2019", e a
--     normalização precisa falhar NO REGISTRO, onde a ferramenta ainda pode
--     devolver "não entendi a data, pergunte de novo" e o modelo tem como
--     corrigir no mesmo turno. Guardar texto empurraria a falha para a
--     renderização, onde não há mais ninguém para perguntar.
--
--   fontes jsonb — quem disse cada campo: {"patient_name":"ia","shift":"atendente"}.
--     É a coluna que torna o bloco honesto. Sem ela o atendente não distingue o
--     que a Maia ouviu no WhatsApp do que um humano conferiu, e num painel
--     clínico essa diferença decide se o dado pode alimentar uma autorização.
--     jsonb e não colunas separadas porque o conjunto de campos vai crescer, e
--     `fonte_patient_name`, `fonte_birth_date`... dobraria a tabela a cada campo.
--
--   coleta_concluida — derivado, mas materializado de propósito: é o que o
--     montador de contexto consulta a cada turno para decidir se ainda oferece a
--     ferramenta à Maia. Recalcular a partir de seis colunas nulas a cada
--     mensagem recebida é trabalho repetido numa rota quente.
-- ============================================================================
create table central.contact_intake (
  contact_id        uuid                   primary key references central.contacts(id) on delete cascade,
  organization_id   uuid                   not null references central.organizations(id),

  patient_name      text,
  birth_date        date,
  guardian_name     text,
  shift             central.therapy_shift,
  health_plan       text,

  fontes            jsonb                  not null default '{}'::jsonb,
  coleta_concluida  boolean                not null default false,

  created_at        timestamptz            not null default now(),
  updated_at        timestamptz            not null default now(),

  -- Data de nascimento no futuro é sempre erro de leitura do modelo ("12/03/29"
  -- virando 2029). Deixar entrar produziria uma idade negativa na tela.
  constraint ck_cin_nascimento_passado
    check (birth_date is null or birth_date <= current_date),

  -- Teto de idade. Não é sobre proteger o banco de um valor absurdo: é sobre
  -- pegar o ano trocado. A clínica atende crianças, então 1919 é tão errado
  -- quanto 2029 — e sem esta checagem entraria calado, porque uma data de 1919
  -- é uma data perfeitamente válida.
  constraint ck_cin_nascimento_plausivel
    check (birth_date is null or birth_date >= current_date - interval '120 years'),

  -- String vazia não é "não sei": ela preenche o campo na tela e faz a Maia
  -- parar de perguntar. O modelo manda '' com mais frequência do que se espera
  -- quando o schema pede string e ele não tem o dado.
  constraint ck_cin_textos_nao_vazios
    check (
      (patient_name  is null or length(btrim(patient_name))  > 0)
      and (guardian_name is null or length(btrim(guardian_name)) > 0)
      and (health_plan   is null or length(btrim(health_plan))   > 0)
    ),

  constraint ck_cin_fontes_objeto
    check (jsonb_typeof(fontes) = 'object')
);

-- Toda consulta é "a ficha deste contato", e a PK já a serve. O índice por
-- organização existe para a varredura administrativa ("quantas coletas estão
-- incompletas"), que é a única leitura que não parte de um contato conhecido.
create index idx_cin_org_incompleta
  on central.contact_intake (organization_id)
  where coleta_concluida = false;

-- `public.set_updated_at()`, com o schema explícito: é a função que todo o
-- schema `central` usa desde 20260701000000. Não existe `central.set_updated_at`
-- nem `public.handle_updated_at`.
drop trigger if exists set_updated_at on central.contact_intake;
create trigger set_updated_at
  before update on central.contact_intake
  for each row execute function public.set_updated_at();

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
-- Sem o comando abaixo, esta tabela nasce LEGÍVEL por qualquer usuário
-- autenticado da instância, inclusive de outra organização — e o que ela guarda
-- é o nome, a data de nascimento e o plano de saúde de uma CRIANÇA. É o inverso
-- do que acontece em `public`, e por isso é fácil esquecer.
-- ============================================================================
alter table central.contact_intake enable row level security;

-- Leitura mais ampla que a do sentimento, de propósito. Uma leitura de
-- sentimento é um julgamento sobre o estado emocional de alguém e fica restrita
-- a admin/director; isto é a ficha de quem está sendo atendido, e o atendente
-- que responde a conversa precisa dela para atender. Restringi-la produziria um
-- bloco vazio para exatamente quem tem o paciente na tela.
create policy cin_select
  on central.contact_intake
  for select
  to authenticated
  using (organization_id = central.current_organization_id());

-- INSERT e UPDATE existem para a correção manual pelo painel, que roda com a
-- sessão do atendente. A Maia escreve com service_role, que bypassa RLS.
--
-- Corrigir é obrigatório, não conveniência: a Maia vai ouvir "Sofia" e gravar
-- "Sophia", e sem edição o painel vira uma afirmação errada que ninguém pode
-- consertar.
create policy cin_insert
  on central.contact_intake
  for insert
  to authenticated
  with check (organization_id = central.current_organization_id());

create policy cin_update
  on central.contact_intake
  for update
  to authenticated
  using (organization_id = central.current_organization_id())
  with check (organization_id = central.current_organization_id());

-- Sem policy de DELETE: apagar a ficha não é uma operação de atendimento. O
-- caminho de exclusão da LGPD é apagar o contato, e o `on delete cascade` leva
-- esta linha junto.

comment on table central.contact_intake is
  'Dados do paciente coletados na conversa pela Maia, para contatos AINDA NAO vinculados a um paciente do TiTa. Guarda so o que a conversa revelou: quem ja e da clinica tem esses campos em public.pacientes, e o merge acontece na leitura (services/ficha.service.ts), onde o cadastro vence campo a campo.';
comment on column central.contact_intake.fontes is
  'Quem disse cada campo: {"patient_name":"ia","shift":"atendente"}. Torna o painel honesto — o atendente precisa distinguir o que a Maia ouviu no WhatsApp do que um humano conferiu, porque so o segundo pode alimentar uma autorizacao.';
comment on column central.contact_intake.shift is
  'Turno preferido para as terapias. NULL e "ainda nao perguntado"; ''indiferente'' e "perguntou e tanto faz" — sem essa distincao a Maia perguntaria de novo a cada turno. E o unico dos seis campos que NAO existe no TiTa.';
comment on column central.contact_intake.coleta_concluida is
  'Derivado dos campos, materializado porque o montador de contexto do agente o consulta a cada mensagem recebida para decidir se ainda oferece a ferramenta de registro a Maia.';

notify pgrst, 'reload schema';
