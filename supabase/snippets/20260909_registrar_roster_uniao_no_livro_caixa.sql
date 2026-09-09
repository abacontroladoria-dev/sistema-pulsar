-- =============================================================================
-- Livro-caixa — registrar 20260909120000 (roster unido aos dois pipelines TiTa)
-- =============================================================================
-- CONTEXTO: a migration foi aplicada à mão no SQL Editor em 2026-09-09
-- (roster_uniao_dois_pipelines_tita.sql). Só o INSERT em
-- supabase_migrations.schema_migrations ficou para trás.
--
-- POR QUE IMPORTA: enquanto a versão estiver ausente do livro-caixa, qualquer
-- `supabase db push` futuro a considera PENDENTE — e o push empurra o pendente
-- INTEIRO, não só ela (reference_db_push_blast_radius). No caso desta migration
-- reaplicar seria inócuo (é CREATE OR REPLACE VIEW, idempotente), mas o push
-- levaria de carona toda outra migration pendente, e essa é a parte perigosa.
--
-- Este snippet NÃO reaplica nada. Só registra o que já está no ar.
-- Idempotente: `on conflict do nothing`.

insert into supabase_migrations.schema_migrations (version, name)
values ('20260909120000', 'roster_uniao_dois_pipelines_tita')
on conflict (version) do nothing;

-- ---------------------------------------------------------------------------
-- Conferência 1 (só lê) — esperado: a versão presente
-- ---------------------------------------------------------------------------
select version, name
from supabase_migrations.schema_migrations
where version = '20260909120000';

-- ---------------------------------------------------------------------------
-- Conferência 2 (só lê) — a view no ar bate com o que foi validado?
-- Esperado, medido em produção em 2026-09-09 depois da aplicação:
--   total = 122 · com_pedro = 1 · inativos = 0 · terapia_null = 0
-- ---------------------------------------------------------------------------
select
  count(*)                                                        as total,
  count(*) filter (where profissional_nome like 'Pedro Lucas%')   as com_pedro,
  count(*) filter (where profissional_nome ilike '%INATIVO%')     as inativos,
  count(*) filter (where terapia_principal is null)               as terapia_null
from public.vw_remuneracao_profissionais_roster;
