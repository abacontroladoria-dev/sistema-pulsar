-- Rodar no SQL Editor (produção). Espelha a migration 20261007190000.

-- =============================================================================
-- search_path fixo nas 10 funções criadas depois do mutirão de 20260817160000
-- =============================================================================
-- Security Advisor (function_search_path_mutable) em 2026-10-07. Mesmo caminho
-- do mutirão: `public, extensions, pg_temp` — unaccent/http/pg_net seguem em
-- public, então nenhuma resolução de nome muda. ALTER FUNCTION ... SET só
-- acrescenta o parâmetro; statement_timeout e afins ficam como estão.
--
-- Custo conhecido: normalizar_nome_terapia e sp_pac_disp_hora são SQL
-- imutáveis e, com SET, deixam de ser inlinadas pelo planner. Nenhum índice
-- depende delas (medido); o efeito é só uma chamada de função por linha.
-- =============================================================================

alter function public.auditoria_criterios_impedir_alteracao()                set search_path = public, extensions, pg_temp;
alter function public.fn_protege_adiantamento()                              set search_path = public, extensions, pg_temp;
alter function public.get_auditoria_assim(date)                              set search_path = public, extensions, pg_temp;
alter function public.get_auditoria_assim_periodo(date, date)                set search_path = public, extensions, pg_temp;
alter function public.get_faltas_auditoria_assim(date)                       set search_path = public, extensions, pg_temp;
alter function public.listar_central_autorizacoes(date)                      set search_path = public, extensions, pg_temp;
alter function public.listar_central_pacientes(date)                         set search_path = public, extensions, pg_temp;
alter function public.normalizar_nome_terapia(text)                          set search_path = public, extensions, pg_temp;
alter function public.sp_pac_disp_hora(jsonb, text)                          set search_path = public, extensions, pg_temp;
alter function public.sp_pac_disp_imutavel()                                 set search_path = public, extensions, pg_temp;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261007190000', 'search_path_funcoes_novas')
on conflict (version) do nothing;

-- Conferência: deve dar 0
select count(*) restantes from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public','cco','central','crm') and p.prokind in ('f','p')
   and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
   and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%');
