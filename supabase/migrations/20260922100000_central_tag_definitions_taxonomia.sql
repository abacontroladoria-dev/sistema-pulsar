-- Tags automáticas da Maia — metadados de grupo/cardinalidade/quem aplica.
--
-- `central.tag_definitions` (20260701010000) nasceu como catálogo achatado
-- (key/label/color/category) para tags aplicadas manualmente por humano. A
-- taxonomia da Maia (144 tags em 13 grupos — aba "Taxonomia" do documento
-- comercial_configuracao-crm-maia_2026-09-21_v4.xlsx, replicada em
-- frontend/app/central-atendimento/maia-tags/maia_tags_catalog.json) precisa
-- de mais do que isso: cardinalidade por grupo (single/multi — aba "Regras",
-- item 2) e quem tem permissão de aplicar cada tag (Maia, sistema, humano).
--
-- `category` continua existindo e guardando o rótulo do grupo (ex.:
-- "1. ORIGEM") para não quebrar a tela que já lê essa coluna
-- (usePainelDetalhamento.ts). `grupo_key` é o identificador estável novo —
-- lógica de código (merge por grupo, geração de enum da ferramenta) usa esta
-- coluna, nunca `category`, porque um rótulo pode mudar de texto sem quebrar
-- nada, e uma chave de grupo não deveria.

alter table central.tag_definitions
  add column if not exists grupo_key           text,
  add column if not exists grupo_ordem         smallint,
  add column if not exists cardinalidade       text,
  add column if not exists maia_pode_aplicar   boolean not null default false,
  add column if not exists automatico_sistema  boolean not null default false,
  add column if not exists requer_humano       boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'central.tag_definitions'::regclass
      and conname = 'ck_tag_definitions_cardinalidade'
  ) then
    alter table central.tag_definitions
      add constraint ck_tag_definitions_cardinalidade
      check (cardinalidade is null or cardinalidade in ('single', 'multi'));
  end if;
end $$;

comment on column central.tag_definitions.grupo_key is
  'Chave estável do grupo da taxonomia da Maia (ex.: origem, tipo_de_contato, pagamento). NULL para tags fora dessa taxonomia (seed genérico de 20260701010500). Fonte: maia_tags_catalog.json.';
comment on column central.tag_definitions.grupo_ordem is
  'Ordem de exibição do grupo (1 a 13), espelha a numeração da aba Taxonomia.';
comment on column central.tag_definitions.cardinalidade is
  'single: no máximo uma tag deste grupo por conversa/contato. multi: várias. Aba Regras, item 2.';
comment on column central.tag_definitions.maia_pode_aplicar is
  'A Maia (LLM) pode gravar esta tag via ferramenta de classificação. false = só sistema ou humano.';
comment on column central.tag_definitions.automatico_sistema is
  'Aplicada por lógica determinística do sistema (matcher de campanha, cálculo de status do paciente), não por decisão da Maia nem de um humano.';
comment on column central.tag_definitions.requer_humano is
  'Só um humano pode aplicar esta tag (grupo Jurídico e demais linhas "Humano" da aba Taxonomia).';

create index if not exists idx_tag_definitions_grupo
  on central.tag_definitions (organization_id, grupo_key)
  where grupo_key is not null and is_active = true;
