-- =============================================================================
-- Livro-caixa — registrar 20260914140000 (fluxo_slots_cache + cron fixo)
-- =============================================================================
-- Aplicada à mão pelo SQL Editor em 2026-09-14 e conferida na mesma sessão:
--
--   20260914140000_fluxo_slots_cache_e_cron_horarios_fixos.sql
--     cron refresh-dashboard-kpis -> '30 11,13,15,17,19 * * 1-5'
--       (08:30/10:30/12:30/14:30/16:30 BRT; era */30 9-23 * * *)
--     tabela public.fluxo_slots_cache  (RLS on, sem policy)
--     refresh_dashboard_kpis()  -> passa a gravar tambem os slots do dia
--     get_fluxo_slots()         -> novo, GRANT a anon+authenticated
--     (conferido: get_fluxo_slots devolveu 17 horarios / 355 atendimentos,
--      batendo com a grade do dia)
--
-- POR QUE REGISTRAR: sem a versão em supabase_migrations.schema_migrations,
-- qualquer `supabase db push` futuro considera esta PENDENTE. Reaplicar seria
-- inofensivo aqui (é CREATE IF NOT EXISTS / OR REPLACE / unschedule+schedule),
-- mas `db push` empurra o PENDENTE INTEIRO — o risco não é o que esta faz, é o
-- que vem junto na leva.
--
-- ✅ JÁ RODADO em 2026-09-14 — conferido em produção:
--   livro-caixa                 -> 20260914140000
--   cron refresh-dashboard-kpis -> 30 11,13,15,17,19 * * 1-5
--   fluxo_slots_cache           -> 17 linhas, refresh 12:10:59+00
-- Mantido aqui como registro. Rodar de novo é inofensivo (só lê e faz
-- `on conflict do nothing`).
--
-- ATENÇÃO à numeração: esta migration trocou de número duas vezes (nasceu
-- 120000, virou 130000) porque colidiu com as dos advisors ERRORS do mesmo dia.
-- 20260914140000 é a versão FINAL e é a que está no banco — o arquivo em
-- supabase/migrations/ foi alinhado a ela, e o revoke_anon_views_herdadas foi
-- empurrado para 150000. A chave do livro-caixa é a versão, não o nome: dois
-- arquivos com o mesmo número fazem o segundo sumir do registro em silêncio.
--
-- Este snippet NÃO reaplica nada. Só registra o que já está no ar.
-- Idempotente: `on conflict do nothing`.

begin;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260914140000', 'fluxo_slots_cache_e_cron_horarios_fixos')
on conflict (version) do nothing;

commit;

-- ---------------------------------------------------------------------------
-- Conferência (só lê)
-- ---------------------------------------------------------------------------
-- Esperado:
--   livro-caixa   -> 20260914140000
--   cron          -> 30 11,13,15,17,19 * * 1-5
--   slots na cache-> 13+ linhas, refreshed_at de hoje
select 'livro-caixa' as o_que,
       coalesce(string_agg(version, ', '), '(NENHUMA — o insert não pegou)') as valor
  from supabase_migrations.schema_migrations
 where version = '20260914140000'
union all
select 'cron refresh-dashboard-kpis',
       coalesce(string_agg(schedule, ', '), '(job não existe)')
  from cron.job
 where jobname = 'refresh-dashboard-kpis'
union all
select 'fluxo_slots_cache',
       count(*)::text || ' linhas, refresh mais recente: ' ||
       coalesce(max(refreshed_at)::text, '(vazia)')
  from public.fluxo_slots_cache;
