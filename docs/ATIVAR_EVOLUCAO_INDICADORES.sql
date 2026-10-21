-- ═════════════════════════════════════════════════════════════════════════════
-- EVOLUÇÃO MENSAL — Ocupação Clínica (A15) e Dashboard de Pacientes (A16)
-- LIGAR AS ROTINAS. SÓ DEPOIS de:
--   1. aplicar as migrations 20261021160000 e 20261021160100;
--   2. o site publicado no Coolify com a rota /api/indicadores/evolucao-snapshot.
-- Rode ESTE arquivo inteiro sozinho. Ele vem TRAVADO (ver abaixo).
-- ═════════════════════════════════════════════════════════════════════════════
--
-- O que liga:
--   • evolucao-indicadores-diario      todo dia 05:15 (Brasília) — recalcula o
--     mês corrente e o seguinte (status "parcial"), depois do sync da grade
--     (02:00), da carga do TiTa (04:00) e do retrato da Previsão (05:10).
--   • evolucao-indicadores-fechamento  dia 5, 05:30 (Brasília) — fecha o mês
--     anterior (status "fechado").
--
-- Usa o MESMO segredo da rotina do TiTa (Vault: carga_tita_segredo; Coolify:
-- CARGA_TITA_SEGREDO) — decisão de 21/10/2026. Nada novo para configurar.
-- O pg_cron trabalha em UTC: 05:15 de Brasília = 08:15 UTC.
--
-- Antes, confira:
--   [ ] As duas tabelas existem (ocupacao_clinica_historico_resumo e
--       pacientes_historico_resumo).
--   [ ] O site publicado responde 401 (e não 404) em
--       POST https://orbitaautomacao.com.br/api/indicadores/evolucao-snapshot/
--       sem o cabeçalho do segredo.
--
-- Troque "if not false" por "if not true" para ligar.

do $$
begin
  if not false then
    raise exception 'Trava ligada: confira o checklist e troque "if not false" por "if not true".';
  end if;
end $$;

create or replace function public.fn_evolucao_indicadores(p_fechamento boolean default false)
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  _segredo text;
  _corpo jsonb;
begin
  select decrypted_secret into _segredo from vault.decrypted_secrets where name = 'carga_tita_segredo';
  if _segredo is null then
    raise exception 'fn_evolucao_indicadores: segredo carga_tita_segredo ausente no Vault.';
  end if;
  if p_fechamento then
    -- Mês anterior, no fuso de Brasília.
    _corpo := jsonb_build_object(
      'competencias', jsonb_build_array(to_char((date_trunc('month', (now() at time zone 'America/Sao_Paulo')) - interval '1 month'), 'YYYY-MM')),
      'fechamento', true);
  else
    _corpo := '{}'::jsonb; -- a rota calcula o mês corrente e o seguinte
  end if;
  -- Barra no fim: sem ela o Next responde 308 e o pg_net não segue redirect.
  -- A rota responde 202 na hora e calcula depois (after()).
  perform net.http_post(
    url := 'https://orbitaautomacao.com.br/api/indicadores/evolucao-snapshot/',
    headers := jsonb_build_object('x-carga-segredo', _segredo, 'Content-Type', 'application/json'),
    body := _corpo,
    timeout_milliseconds := 30000
  );
end $$;
revoke all on function public.fn_evolucao_indicadores(boolean) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'evolucao-indicadores-diario') then
    perform cron.unschedule('evolucao-indicadores-diario');
  end if;
  if exists (select 1 from cron.job where jobname = 'evolucao-indicadores-fechamento') then
    perform cron.unschedule('evolucao-indicadores-fechamento');
  end if;
end $$;

select cron.schedule('evolucao-indicadores-diario', '15 8 * * *', $$select public.fn_evolucao_indicadores(false)$$);
select cron.schedule('evolucao-indicadores-fechamento', '30 8 5 * *', $$select public.fn_evolucao_indicadores(true)$$);

-- Conferência: as duas rotinas aparecem ativas.
select jobname, schedule, active from cron.job where jobname like 'evolucao-indicadores-%' order by jobname;
