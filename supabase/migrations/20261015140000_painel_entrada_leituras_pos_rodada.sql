-- =============================================================================
-- Painel de Entrada de Pacientes: leituras extras às 9h25 e 13h55
-- =============================================================================
-- Na primeira rodada real (15/10/2026) a tarefa agendada da Ana Carolina, que
-- começa às 7h40, só gravou o Doc às 9h03: depois da leitura das 8h25. O painel
-- ficaria com a rodada anterior até as 12h55. Com rodadas de ~1h20, uma leitura
-- 1h45 depois de cada início (9h25 e 13h55) pega a rodada no mesmo período.
--
-- Mesma função de disparo (fn_painel_entrada_convenio_disparar, de
-- 20261013100000). Conteúdo repetido não vira cópia nova (hash), então cada
-- leitura extra custa um GET no ClickUp. Os jobs de 20261013100000 continuam.
--
-- Cron do Supabase roda em UTC; São Paulo é UTC-3 fixo:
--   painel-entrada-convenio-manha  12:25 UTC = 9h25
--   painel-entrada-convenio-tarde  16:55 UTC = 13h55
-- =============================================================================

do $cron$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'painel-entrada-convenio-manha') then
      perform cron.unschedule('painel-entrada-convenio-manha');
    end if;
    if exists (select 1 from cron.job where jobname = 'painel-entrada-convenio-tarde') then
      perform cron.unschedule('painel-entrada-convenio-tarde');
    end if;

    perform cron.schedule('painel-entrada-convenio-manha', '25 12 * * 1-5',
      $cmd$select public.fn_painel_entrada_convenio_disparar()$cmd$);
    perform cron.schedule('painel-entrada-convenio-tarde', '55 16 * * 1-5',
      $cmd$select public.fn_painel_entrada_convenio_disparar()$cmd$);
  end if;
end
$cron$;

-- Conferência (rode à parte; devem aparecer 4 jobs: painel-entrada-convenio,
-- -repique, -manha e -tarde):
--   select jobname, schedule, active from cron.job
--    where jobname like 'painel-entrada-convenio%' order by jobname;
