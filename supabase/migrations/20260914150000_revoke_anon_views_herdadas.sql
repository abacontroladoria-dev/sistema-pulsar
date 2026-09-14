-- Fecha o `anon` nas 3 views que a Fase 1 de 2026-08-17 não alcançou.
--
-- Achadas pela auditoria de 2026-09-14 (supabase/snippets/
-- 20260914_auditoria_reloptions_todas_as_views.sql, bloco 2), varrendo TODAS as
-- views do schema em vez das 17 nominais do mutirão:
--
--   agenda_classificada                    invoker=on    anon lê
--   vw_cronograma_profissionais_salas      invoker=true  anon lê
--   vw_remuneracao_profissionais_roster    invoker=true  anon lê
--
-- POR QUE O ADVISOR NUNCA ACUSOU: as três são SECURITY INVOKER, e o lint
-- security_definer_view só olha DEFINER. Uma view invoker legível pelo anon não
-- é ERROR para ele — ainda que seja exposição, porque quem decide o que sai é a
-- RLS das bases, e basta uma base com policy ampla para vazar.
--
-- POR QUE ELAS TÊM `anon`: herança, não decisão. Nenhuma migration concede anon
-- a elas — 20260707180000:16 concede `TO authenticated` e só. As três nasceram
-- ANTES do `alter default privileges in schema public revoke all on tables from
-- anon` aplicado na Fase 1 (20260817_advisors_fix_fase1_revoke_anon.sql:52), e o
-- default antigo da Supabase concedia SELECT ao anon em toda view nova. A Fase 1
-- revogou as 17 NOMINALMENTE e barrou as futuras; estas ficaram no vão, porque
-- ninguém as listou.
--
-- Risco real, para calibrar: menor que o da vw_central_pacientes de hoje. Sendo
-- invoker, a RLS das bases já filtra. `vw_remuneracao_profissionais_roster`
-- assusta pelo nome mas projeta só profissional_nome + terapia base — o
-- "remuneracao" é do módulo, não do conteúdo. Ainda assim: nenhuma tela anônima
-- usa nenhuma das três (a única sem login é /tv, que lê por /api/tv/* com
-- service_role), então não há motivo para o grant existir.

begin;

revoke all on public.agenda_classificada                 from anon;
revoke all on public.vw_cronograma_profissionais_salas   from anon;
revoke all on public.vw_remuneracao_profissionais_roster from anon;

commit;

-- ===== CONFERÊNCIA (mesmo script; o SQL Editor devolve só o último statement) =====
select c.relname,
       coalesce((select option_value from pg_options_to_table(c.reloptions)
                  where option_name = 'security_invoker'), '(DEFINER)') as security_invoker,
       has_table_privilege('anon',          c.oid, 'SELECT') as anon_pode_ler,
       has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_pode_ler
  from pg_class c
 where c.relnamespace = 'public'::regnamespace
   and c.relkind = 'v'
   and c.relname in ('agenda_classificada',
                     'vw_cronograma_profissionais_salas',
                     'vw_remuneracao_profissionais_roster');
-- Esperado: anon_pode_ler = false nas 3, authenticated_pode_ler = true nas 3.
-- Se authenticated virar false em alguma, o REVOKE pegou demais — reverta com
-- `grant select on <view> to authenticated`.

-- VALIDAR na tela, como usuário NÃO-admin:
--   [ ] Config → Capacidade do profissional lista os profissionais
--       (vw_remuneracao_profissionais_roster)
--   [ ] cronograma de profissionais/salas carrega
--       (vw_cronograma_profissionais_salas)
