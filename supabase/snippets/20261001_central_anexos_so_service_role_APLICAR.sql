-- Central — bucket dos anexos do inbox só de service role
--
-- APLICA a migration 20261001170000 e a registra no livro-caixa. Snippet e não
-- `db push` (histórico de migrations dessincronizado). Reexecutável.
--
-- ⚠️ ORDEM: faça o DEPLOY DO CÓDIGO ANTES de rodar isto. O código antigo opera o
-- bucket com o client do usuário; sem as policies, enviar e abrir anexo no
-- inbox falham até o código novo subir. O código novo funciona com ou sem elas.
--
-- O que muda no banco:
--   • Somem as quatro policies de storage.objects do bucket `central-anexos`
--     (select/insert/update/delete para `authenticated`). Elas isolavam só por
--     organização — e todo usuário do Pulsar tem a organização da Central —,
--     então qualquer usuário logado listava, baixava, sobrescrevia e apagava
--     anexos do inbox pelo navegador.
--   • O bucket é reafirmado como privado.
--
-- Não apaga nem altera nenhum arquivo do bucket.
--
-- ⚠️ storage.objects pertence a `supabase_storage_admin`. Se o SQL Editor
-- recusar com "must be owner of table objects", apague as quatro policies pelo
-- Dashboard (Storage > Policies > central-anexos) — central_anexos_select,
-- central_anexos_insert, central_anexos_update, central_anexos_delete —, comente
-- os quatro `drop policy` abaixo e rode o resto.

begin;
set local lock_timeout = '5s';

-- ============================================================================
-- 20261001170000_central_anexos_so_service_role
-- ============================================================================

drop policy if exists "central_anexos_select" on storage.objects;
drop policy if exists "central_anexos_insert" on storage.objects;
drop policy if exists "central_anexos_update" on storage.objects;
drop policy if exists "central_anexos_delete" on storage.objects;

update storage.buckets
   set public = false
 where id = 'central-anexos';

insert into supabase_migrations.schema_migrations (version, name)
values ('20261001170000', 'central_anexos_so_service_role')
on conflict (version) do nothing;

commit;

-- ============================================================================
-- CONFERÊNCIAS (rodar depois do commit)
-- ============================================================================

-- CONFERÊNCIA 1 — ESPERADO: nenhuma linha. Qualquer policy de storage.objects
-- que ainda mencione o bucket dos anexos reabre o acesso pelo navegador.
select policyname, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'storage'
   and tablename  = 'objects'
   and (policyname like 'central_anexos%'
        or coalesce(qual, '')       like '%central-anexos%'
        or coalesce(with_check, '') like '%central-anexos%');

-- CONFERÊNCIA 2 — ESPERADO: public = false.
select id, public, file_size_limit
  from storage.buckets
 where id = 'central-anexos';

-- CONFERÊNCIA 3 — ESPERADO: uma linha com 20261001170000.
select version, name
  from supabase_migrations.schema_migrations
 where version = '20261001170000';

-- Depois, no inbox (/connect/inbox/), com o código novo no ar: abrir uma
-- conversa com áudio ou imagem e conferir que o anexo carrega, e enviar um
-- arquivo pequeno. Os dois passam pelo servidor com service role.
