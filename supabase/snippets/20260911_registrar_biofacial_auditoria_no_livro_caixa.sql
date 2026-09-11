-- =============================================================================
-- Livro-caixa — registrar 20260911120000 (biofacial na auditoria diária)
-- =============================================================================
-- CONTEXTO: a migration foi aplicada à mão no SQL Editor. Só o INSERT em
-- supabase_migrations.schema_migrations fica para trás.
--
-- POR QUE IMPORTA: enquanto a versão estiver ausente do livro-caixa, qualquer
-- `supabase db push` futuro a considera PENDENTE — e o push empurra o pendente
-- INTEIRO, não só ela (reference_db_push_blast_radius).
--
-- Este snippet NÃO reaplica nada. Só registra o que já está no ar.
-- Idempotente: `on conflict do nothing`.

insert into supabase_migrations.schema_migrations (version, name)
values ('20260911120000', 'biofacial_na_auditoria_diaria')
on conflict (version) do nothing;

-- ---------------------------------------------------------------------------
-- Conferência (só lê) — esperado: a versão de hoje presente
-- ---------------------------------------------------------------------------
select version, name
from supabase_migrations.schema_migrations
where version in ('20260903000000', '20260903010000', '20260910130000', '20260911120000')
order by version;
