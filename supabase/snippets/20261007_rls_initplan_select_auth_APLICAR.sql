-- Rodar no SQL Editor (produção). Espelha a migration 20261007180000.
-- Ensaiado em 2026-10-07 com rollback: zera as ocorrências sem (select ...).

-- =============================================================================
-- RLS: auth.uid()/auth.role() embrulhados em (select ...) — lint 0003
-- =============================================================================
-- Security Advisor (auth_rls_initplan, PERFORMANCE) em 2026-10-07: ~70 policies
-- em public/cco/central chamam auth.uid() ou auth.role() direto, e o Postgres
-- reavalia a função POR LINHA. Com `(select auth.uid())` vira InitPlan,
-- avaliado uma vez por consulta. Semântica idêntica: a função é estável dentro
-- do statement, só muda quantas vezes roda.
--
-- Feito por reescrita mecânica do texto da policy (pg_policies) em vez de
-- recriar uma a uma: ALTER POLICY troca só USING/WITH CHECK e preserva nome,
-- comando, papéis e permissive/restrictive. O lookbehind `(?<!SELECT )` pula
-- ocorrências já embrulhadas — rodar duas vezes não embrulha de novo.
-- Um bloco DO só: ou reescreve todas, ou nenhuma.
-- =============================================================================

do $$
declare
  r record;
  re constant text := '(?<!SELECT )auth\.(uid|role)\(\)';
  novo_qual text;
  novo_check text;
  n int := 0;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where schemaname in ('public', 'cco', 'central', 'crm')
       and coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ re
  loop
    novo_qual  := regexp_replace(r.qual,       re, '(select auth.\1())', 'g');
    novo_check := regexp_replace(r.with_check, re, '(select auth.\1())', 'g');

    if r.qual is not null then
      execute format('alter policy %I on %I.%I using (%s)',
                     r.policyname, r.schemaname, r.tablename, novo_qual);
    end if;
    if r.with_check is not null then
      execute format('alter policy %I on %I.%I with check (%s)',
                     r.policyname, r.schemaname, r.tablename, novo_check);
    end if;
    n := n + 1;
  end loop;

  raise notice 'policies reescritas: %', n;
end $$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261007180000', 'rls_initplan_select_auth')
on conflict (version) do nothing;

-- Conferência: deve dar 0
select count(*) restantes from pg_policies
 where schemaname in ('public','cco','central','crm')
   and coalesce(qual,'')||' '||coalesce(with_check,'') ~ '(?<!SELECT )auth\.(uid|role)\(\)';
