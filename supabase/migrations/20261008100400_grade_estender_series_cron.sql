-- Grade (Cronograma) — Parte 5: repetição automática noturna.
--
-- Séries contínuas ficam materializadas até hoje + 182 dias. Todo dia às 03:15
-- de Brasília (06:15 UTC, depois do sync da grade do TiTa às 02:00) o
-- horizonte anda e grade_estender_series() cria as sessões novas, pulando
-- feriado, bloqueio, profissional inativo, paciente de alta e horário lotado.
-- Cada execução que cria ou pula algo grava um evento 'estendido'.
--
-- Rollback: select cron.unschedule('grade-estender-series');
--
-- Depende de 20261008100200. Idempotente.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'grade-estender-series') then
    perform cron.unschedule('grade-estender-series');
  end if;
end $$;

select cron.schedule(
  'grade-estender-series', '15 6 * * *',
  $$ select public.grade_estender_series(); $$
);
