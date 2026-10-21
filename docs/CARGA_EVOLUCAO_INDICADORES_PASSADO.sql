-- ═════════════════════════════════════════════════════════════════════════════
-- EVOLUÇÃO MENSAL — CARGA DO PASSADO (jan/2026 → set/2026). Rode UMA vez.
-- SÓ DEPOIS de docs/ATIVAR_EVOLUCAO_INDICADORES.sql (precisa da função
-- fn_evolucao_indicadores e do site publicado). Vem TRAVADO.
-- ═════════════════════════════════════════════════════════════════════════════
--
-- • Pacientes: "fechado". É fiel — a grade passada é congelada desde 07/01/2026.
-- • Ocupação: "aproximado". Agenda da época, mas o mapa de salas de HOJE (o
--   mapa não guarda histórico) — o gráfico desenha esses meses tracejados.
-- • Outubro e novembro ficam com a rotina diária.
--
-- O site responde na hora e calcula em segundo plano (~3 min para os 9 meses).
-- Conferência no fim do arquivo (rode de novo só o SELECT depois de uns minutos).
--
-- Troque "if not false" por "if not true" para rodar.

do $$
begin
  if not false then
    raise exception 'Trava ligada: rode antes docs/ATIVAR_EVOLUCAO_INDICADORES.sql e troque "if not false" por "if not true".';
  end if;
end $$;

do $$
declare
  _segredo text;
  _meses jsonb := '["2026-01","2026-02","2026-03","2026-04","2026-05","2026-06","2026-07","2026-08","2026-09"]'::jsonb;
begin
  select decrypted_secret into _segredo from vault.decrypted_secrets where name = 'carga_tita_segredo';
  if _segredo is null then
    raise exception 'Segredo carga_tita_segredo ausente no Vault.';
  end if;
  -- Pacientes: fechado (fiel).
  perform net.http_post(
    url := 'https://orbitaautomacao.com.br/api/indicadores/evolucao-snapshot/',
    headers := jsonb_build_object('x-carga-segredo', _segredo, 'Content-Type', 'application/json'),
    body := jsonb_build_object('competencias', _meses, 'fechamento', true, 'ocupacao', false),
    timeout_milliseconds := 30000);
  -- Ocupação: aproximado (mapa de salas atual).
  perform net.http_post(
    url := 'https://orbitaautomacao.com.br/api/indicadores/evolucao-snapshot/',
    headers := jsonb_build_object('x-carga-segredo', _segredo, 'Content-Type', 'application/json'),
    body := jsonb_build_object('competencias', _meses, 'aproximado', true, 'pacientes', false),
    timeout_milliseconds := 30000);
end $$;

-- Conferência (depois de uns minutos): 9 meses em cada tabela.
select 'ocupacao' as tabela, competencia, status, count(*) as linhas
from public.ocupacao_clinica_historico_resumo group by competencia, status
union all
select 'pacientes', competencia, status, count(*)
from public.pacientes_historico_resumo group by competencia, status
order by 1, 2;
