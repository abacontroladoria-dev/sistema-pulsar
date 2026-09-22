-- Tags automáticas da Maia — campos de campanha/objeção e matcher da Regra 5.
--
-- campanha e objecao são CAMPOS, não tags (aba Regras, itens 5 e 8): não
-- entram em conversations.tags, vivem em colunas próprias.

alter table central.conversations
  add column if not exists campanha text,
  add column if not exists objecao  text;

comment on column central.conversations.campanha is
  'Preenchido só pelo matcher de campanha (central.campaign_phrases), nunca pela Maia — ela sempre devolve null aqui (aba Regras, item 5). Texto livre, não tag: ex. "Plano de Saúde | FUSEX".';
comment on column central.conversations.objecao is
  'Frase curta do motivo de recuo da família, quando houver (ex.: "achou caro"). Campo, não tag (aba Regras, item 8).';

-- ============================================================================
-- TABLE: central.campaign_phrases
--
-- Matcher da Regra 5: frase exata pré-preenchida por um anúncio → aplica a
-- tag de ORIGEM (origem_tag) e grava o nome da campanha no campo
-- conversations.campanha, sem custo de LLM. Mantida pelo marketing — nesta
-- primeira entrega, por migration/SQL direto; tela de administração fica
-- para depois.
--
-- pronta_para_match = false: campanha cadastrada mas frase ainda não
-- definida (placeholder "(preencher)" da aba Frases de campanha). O matcher
-- pula essas — não há o que comparar.
-- ============================================================================
create table if not exists central.campaign_phrases (
  id                uuid        primary key default gen_random_uuid(),
  organization_id   uuid        not null references central.organizations(id),
  origem_tag        text        not null,
  frase_exata       text,
  campanha          text        not null,
  plataforma        text,
  formato           text,
  pronta_para_match boolean     not null default false,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

drop trigger if exists set_updated_at on central.campaign_phrases;
create trigger set_updated_at
  before update on central.campaign_phrases
  for each row execute function public.set_updated_at();

-- Frase exata é única por organização quando presente — evita duas linhas
-- prontas_para_match casando a mesma mensagem com origens diferentes.
create unique index if not exists uq_campaign_phrases_frase
  on central.campaign_phrases (organization_id, frase_exata)
  where frase_exata is not null;

alter table central.campaign_phrases enable row level security;

-- Mesmo padrão de central.tag_definitions (20260701010200): admin gerencia,
-- director só lê. O matcher em si (Passo 6) roda como service_role, que
-- não passa por RLS.
create policy campaign_phrases_select
  on central.campaign_phrases
  for select
  to authenticated
  using (
    organization_id = central.current_organization_id()
    and central.ca_current_role() in ('admin', 'director')
  );

create policy campaign_phrases_insert_admin
  on central.campaign_phrases
  for insert
  to authenticated
  with check (
    organization_id = central.current_organization_id()
    and central.ca_current_role() = 'admin'
  );

create policy campaign_phrases_update_admin
  on central.campaign_phrases
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

create policy campaign_phrases_delete_admin
  on central.campaign_phrases
  for delete
  to authenticated
  using (
    organization_id = central.current_organization_id()
    and central.ca_current_role() = 'admin'
  );

-- Seed a partir de maia_frases_campanha.json (7 frases prontas + 14
-- placeholders "(preencher)" — pronta_para_match = false para os últimos).
insert into central.campaign_phrases
  (organization_id, origem_tag, frase_exata, campanha, plataforma, formato, pronta_para_match)
values
  ('a0000000-0000-0000-0000-000000000001', 'meta_ads', 'Gostaria de agendar pelo plano ASSIM SAÚDE.', 'Plano de Saúde | ASSIM', 'IG/FB', 'Anúncio', true),
  ('a0000000-0000-0000-0000-000000000001', 'meta_ads', 'Gostaria de agendar pelo plano LEVE SAÚDE.', 'Plano de Saúde | Leve', 'IG/FB', 'Anúncio', true),
  ('a0000000-0000-0000-0000-000000000001', 'meta_ads', 'Gostaria de agendar pelo plano UNIMED.', 'Plano de Saúde | Seguros Unimed', 'IG/FB', 'Anúncio', true),
  ('a0000000-0000-0000-0000-000000000001', 'meta_ads', 'Gostaria de agendar pelo plano FUSEX.', 'Plano de Saúde | FUSEX', 'IG/FB', 'Anúncio', true),
  ('a0000000-0000-0000-0000-000000000001', 'meta_ads', 'Olá! Vim do site e quero saber mais sobre a Terapia Aba.', 'Site | Terapia ABA', 'IG/FB', 'Site', true),
  ('a0000000-0000-0000-0000-000000000001', 'site', 'Olá! Vim do site e quero saber mais sobre a Terapia Aba.', 'Site | Terapia ABA', 'Site', 'Botão', true),
  ('a0000000-0000-0000-0000-000000000001', 'linktree', 'Olá, vim pelo Linktree e desejo falar com um Atendente!', 'Linktree', 'Linktree', 'Botão', true),
  ('a0000000-0000-0000-0000-000000000001', 'meta_ads', null, 'Av. Neuropsicológica | Imagem', 'IG/FB', 'Anúncio', false),
  ('a0000000-0000-0000-0000-000000000001', 'meta_ads', null, 'Av. Neuropsicológica | Vídeo', 'IG/FB', 'Anúncio', false),
  ('a0000000-0000-0000-0000-000000000001', 'meta_ads', null, 'Terapia ABA', 'IG/FB', 'Anúncio', false),
  ('a0000000-0000-0000-0000-000000000001', 'meta_ads', null, 'Fonoaudiologia', 'IG/FB', 'Anúncio', false),
  ('a0000000-0000-0000-0000-000000000001', 'meta_ads', null, 'Psicologia Infantil', 'IG/FB', 'Anúncio', false),
  ('a0000000-0000-0000-0000-000000000001', 'meta_ads', null, 'Especialidades Terapêuticas', 'IG/FB', 'Anúncio', false),
  ('a0000000-0000-0000-0000-000000000001', 'meta_ads', null, 'Médico da Saúde Mental', 'IG/FB', 'Anúncio', false),
  ('a0000000-0000-0000-0000-000000000001', 'meta_ads', null, 'Transtorno', 'IG/FB', 'Anúncio', false),
  ('a0000000-0000-0000-0000-000000000001', 'meta_ads', null, 'Av. Neuropsicológica | Leve', 'IG/FB', 'Impulsionado', false),
  ('a0000000-0000-0000-0000-000000000001', 'google_ads', null, 'Terapia ABA', 'Google', 'Anúncio', false),
  ('a0000000-0000-0000-0000-000000000001', 'google_ads', null, 'Fonoaudiologia', 'Google', 'Anúncio', false),
  ('a0000000-0000-0000-0000-000000000001', 'google_ads', null, 'Psicologia Infantil', 'Google', 'Anúncio', false),
  ('a0000000-0000-0000-0000-000000000001', 'google_ads', null, 'Av. Neuropsicológica', 'Google', 'Anúncio', false),
  ('a0000000-0000-0000-0000-000000000001', 'google_ads', null, 'Médico da Saúde Mental (landing page)', 'Google', 'Landing page', false)
on conflict do nothing;
