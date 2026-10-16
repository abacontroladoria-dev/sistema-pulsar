-- ENSAIO de 20261016190000_consulta_medica_presenca — NÃO grava nada.
-- Roda a migration e termina em RAISE EXCEPTION com o relatório: o Postgres
-- desfaz tudo. O "erro" no fim É o resultado esperado; ler a mensagem RELATORIO.
-- Dias = até 6 com consulta médica (2695) nos últimos 60 e próximos 7.
-- Esperado: ganhos = só cards com 'Psiquiatra/Neurologista', fluxo 'presenca';
-- perdidos_ou_alterados = 0.

set statement_timeout = '90s';

create temp table _dias as
select distinct data_atendimento as dia
from public.agenda_tita
where ativo and terapia_id = 2695 and terapia_exibicao_id = 2695
  and paciente_nome not in ('Horário Administrativo','Notificação Prévia')
  and data_atendimento between current_date - 60 and current_date + 7
order by 1 desc limit 6;

create temp table _antes as
select d.dia, r.*
from _dias d cross join lateral public.listar_central_autorizacoes(d.dia) r;

create temp table _kpis_antes as select * from public.vw_kpis_auditoria_assim;

-- ── a migration ──────────────────────────────────────────────────────────────
set lock_timeout = '5s';

DO $migr$
DECLARE
  v_def  text;
  v_n    int;
  v_alvo text := '((a.terapia_id = 2279) AND (a.terapia_exibicao_id = 2279))';
  v_novo text := '((a.terapia_id = 2279) AND (a.terapia_exibicao_id = 2279)) OR ((a.terapia_id = 2695) AND (a.terapia_exibicao_id = 2695))';
BEGIN
  v_def := pg_get_viewdef('public.agenda_tita_autorizacao'::regclass);
  IF position('2695' in v_def) > 0 THEN
    RAISE NOTICE 'agenda_tita_autorizacao já deixa passar a consulta médica';
    RETURN;
  END IF;
  v_n := (length(v_def) - length(replace(v_def, v_alvo, ''))) / length(v_alvo);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'agenda_tita_autorizacao: trecho esperado 1x, achei %: %. Reveja à mão.', v_n, v_alvo;
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.agenda_tita_autorizacao AS '
          || replace(v_def, v_alvo, v_novo);
  EXECUTE 'ALTER VIEW public.agenda_tita_autorizacao SET (security_invoker = true)';
END
$migr$;

DO $t$
DECLARE r jsonb;
BEGIN
  create temp table _depois as
  select d.dia, x.*
  from _dias d cross join lateral public.listar_central_autorizacoes(d.dia) x;

  select jsonb_build_object(
    'dias', (select jsonb_agg(dia order by dia) from _dias),
    'ganhos', (select jsonb_agg(jsonb_build_object('dia', dia, 'hora', horario,
                 'terapias', terapias, 'conv', convenio_nome, 'fluxo', tipo_fluxo, 'tela', mostrar_na_tela))
               from (select * from _depois except select * from _antes) g),
    'perdidos_ou_alterados', (select count(*) from (select * from _antes except select * from _depois) p),
    'kpis_antes', (select to_jsonb(k) from _kpis_antes k limit 1),
    'kpis_depois', (select to_jsonb(k) from public.vw_kpis_auditoria_assim k limit 1),
    'blocos_assim_2695', (select count(*) from public.vw_blocos_autorizaveis_assim b
                           where b.terapias::text ilike '%Psiquiatra/Neurologista%'),
    'sec_invoker', (select reloptions from pg_class where oid = 'public.agenda_tita_autorizacao'::regclass)
  ) into r;
  RAISE EXCEPTION 'RELATORIO: %', r;
END $t$;
