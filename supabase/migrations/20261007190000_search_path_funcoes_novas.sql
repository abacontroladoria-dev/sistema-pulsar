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
