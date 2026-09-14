-- =============================================================================
-- Livro-caixa — registrar 20260914120000 e 20260914150000 (advisors ERRORS)
-- =============================================================================
-- As duas foram aplicadas à mão pelo SQL Editor em 2026-09-14 e conferidas na
-- mesma sessão:
--
--   20260914120000_advisors_errors_duas_views_restantes.sql
--     vw_central_pacientes    -> security_invoker = true, anon revogado
--     vw_paciente_laudos_flat -> security_invoker = true
--     (conferido: as duas invoker, anon_pode_ler = false; grants da view =
--      authenticated, postgres, service_role)
--
--   20260914150000_revoke_anon_views_herdadas.sql  (era 130000, depois 140000 — ver CORREÇÃO)
--     anon revogado em agenda_classificada, vw_cronograma_profissionais_salas
--     e vw_remuneracao_profissionais_roster
--     (conferido: anon_pode_ler = false nas 3, authenticated_pode_ler = true
--      nas 3 — o revoke não pegou demais)
--
-- POR QUE REGISTRAR: sem a versão em supabase_migrations.schema_migrations,
-- qualquer `supabase db push` futuro considera as duas PENDENTES e tenta
-- reaplicá-las. Reaplicar estas duas é inofensivo (são ALTER/REVOKE idempotentes,
-- sem DROP VIEW), mas `db push` empurra o PENDENTE INTEIRO — o risco não é o que
-- estas duas fazem, é o que vem junto na leva.
--
-- Este snippet NÃO reaplica nada. Só registra o que já está no ar.
-- Idempotente: `on conflict do nothing`.

-- ⚠️ CORREÇÃO 2026-09-14 — colisão de versão (DUAS vezes). RODAR O BLOCO ABAIXO.
--
-- Duas migrations não podem dividir a mesma versão: a chave de
-- schema_migrations é `version`, então a segunda a ser registrada bate em
-- `on conflict do nothing` e fica FORA do livro-caixa EM SILÊNCIO — e um
-- `db push` futuro tentaria reaplicá-la.
--
-- Aconteceu duas vezes no mesmo dia, com o mesmo par de trabalhos (advisors
-- ERRORS × fluxo_slots_cache, cron dos KPIs da home + gráfico real do Fluxo):
--
--   1ª: a primeira execução deste snippet registrou o revoke como 130000 —
--       número que era do fluxo_slots. O revoke foi renumerado para 140000.
--   2ª: mas 140000 também virou do fluxo_slots, e dessa vez foi o FLUXO_SLOTS
--       que chegou primeiro ao livro-caixa (conferido em produção:
--       20260914140000 = fluxo_slots_cache_e_cron_horarios_fixos).
--
-- Numeração final, disco alinhado ao banco (o banco é o fato consumado):
--   20260914120000  advisors_errors_duas_views_restantes
--   20260914140000  fluxo_slots_cache_e_cron_horarios_fixos   (já registrada)
--   20260914150000  revoke_anon_views_herdadas                 (este snippet)
--
-- Produção não muda: os REVOKEs já estão aplicados, isto é só contabilidade.

begin;

insert into supabase_migrations.schema_migrations (version, name)
values
  ('20260914120000', 'advisors_errors_duas_views_restantes'),
  ('20260914150000', 'revoke_anon_views_herdadas')
on conflict (version) do nothing;

-- Tira os registros errados das duas colisões. O `and name = ...` é a proteção:
-- só apaga a linha se ela for MESMO o revoke ocupando um número que não é dele.
-- Se o número já pertencer a outra migration (140000 = fluxo_slots), o delete
-- não encontra linha e não faz nada.
delete from supabase_migrations.schema_migrations
 where version in ('20260914130000', '20260914140000')
   and name    = 'revoke_anon_views_herdadas';

commit;

-- ---------------------------------------------------------------------------
-- Conferência (só lê)
-- ---------------------------------------------------------------------------
-- Esperado (exatamente 3 linhas, nesta ordem e com estes nomes):
--   20260914120000 advisors_errors_duas_views_restantes
--   20260914140000 fluxo_slots_cache_e_cron_horarios_fixos
--   20260914150000 revoke_anon_views_herdadas
-- SEM 130000, e o 140000 NÃO pode aparecer como revoke_anon_views_herdadas.
--   views com anon lendo   -> 0
select 'livro-caixa' as o_que,
       coalesce(string_agg(version || ' ' || name, ' | ' order by version), '(NENHUMA — o insert não pegou)') as valor
  from supabase_migrations.schema_migrations
 where version in ('20260914120000', '20260914130000', '20260914140000', '20260914150000')
union all
select 'views com anon lendo',
       coalesce(string_agg(c.relname, ', ' order by c.relname), '0 — nenhuma')
  from pg_class c
 where c.relnamespace = 'public'::regnamespace
   and c.relkind = 'v'
   and has_table_privilege('anon', c.oid, 'SELECT');
