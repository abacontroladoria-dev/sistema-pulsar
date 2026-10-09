-- =============================================================================
-- vw_faltas_pacientes volta a ser security_invoker
-- =============================================================================
-- Security Advisor (0010_security_definer_view) em 2026-10-07. Causa:
-- 20260916120500 recriou a view com CREATE OR REPLACE sem WITH (...). No
-- Postgres, CREATE OR REPLACE VIEW SUBSTITUI as reloptions pelas da cláusula
-- WITH — sem ela, security_invoker some igual ao DROP VIEW.
-- Regra: toda recriação de view leva `with (security_invoker = true)`.
-- =============================================================================

alter view public.vw_faltas_pacientes set (security_invoker = true);
