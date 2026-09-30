-- =============================================================================
-- DIAGNÓSTICO (só leitura) — `3-BENEFICIARIO SEM CELULAR` gera filipeta
-- =============================================================================
-- Rodar INTEIRO no SQL Editor, ANTES de aplicar
-- 20260930100000_filipeta_beneficiario_sem_celular.sql.
--
-- Não altera nada em produção: a versão nova de get_tokens_mensal é criada
-- como CÓPIA em pg_temp (some quando a conexão fecha) e comparada com a
-- vigente, mês a mês, linha a linha (to_jsonb da linha inteira).
--
-- O QUE TEM DE SAIR
--   comparacao / perdidas_ou_alteradas  -> 0 em todos os meses (a trava:
--                                          nada que aparece hoje some ou muda)
--   comparacao / novas                  -> o que a regra nova acrescenta
--   tempo / ms                          -> vigente vs nova, na mesma sessão
--   volume / ...                        -> quantos `3-` e "sem celular" existem
--   maria_clara / ...                   -> de qual fonte vem o caso de 23/09
-- =============================================================================

-- As 5 trocas, idênticas às da migration. Cada trecho tem de existir 1x.
CREATE OR REPLACE FUNCTION pg_temp.patch_sem_celular(p_def text)
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_def  text := p_def;
  v_par  text[];
  v_n    int;
  trocas text[][] := ARRAY[
    ARRAY[$a$OR split_part(btrim(COALESCE(aa.biofacial, '')), '-', 1) = '8'$a$,
          $a$OR split_part(btrim(COALESCE(aa.biofacial, '')), '-', 1) IN ('3', '8')$a$],
    ARRAY[$a$WHERE split_part(btrim(COALESCE(biofacial, '')), '-', 1) = '8'$a$,
          $a$WHERE split_part(btrim(COALESCE(biofacial, '')), '-', 1) IN ('3', '8')$a$],
    ARRAY[$a$OR split_part(btrim(COALESCE(vin.biofacial, mt.biofacial, '')), '-', 1) = '8'$a$,
          $a$OR split_part(btrim(COALESCE(vin.biofacial, mt.biofacial, '')), '-', 1) IN ('3', '8')$a$],
    ARRAY[$a$AND f.forma_autorizacao ILIKE '%reconhecimento facial%'$a$,
          $a$AND (f.forma_autorizacao ILIKE '%reconhecimento facial%' OR f.forma_autorizacao ILIKE '%sem celular%')$a$],
    ARRAY[$a$fo.forma_autorizacao ILIKE '%reconhecimento facial%'$a$,
          $a$(fo.forma_autorizacao ILIKE '%reconhecimento facial%' OR fo.forma_autorizacao ILIKE '%sem celular%')$a$]
  ];
BEGIN
  -- Conta TODAS antes de trocar qualquer uma: a troca 4 não pode criar
  -- ocorrência da 5, nem o contrário.
  FOREACH v_par SLICE 1 IN ARRAY trocas LOOP
    v_n := (length(v_def) - length(replace(v_def, v_par[1], ''))) / length(v_par[1]);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'get_tokens_mensal: trecho esperado 1x, achei %: %', v_n, v_par[1];
    END IF;
  END LOOP;
  FOREACH v_par SLICE 1 IN ARRAY trocas LOOP
    v_def := replace(v_def, v_par[1], v_par[2]);
  END LOOP;
  RETURN v_def;
END
$fn$;

DO $d$
DECLARE
  v_def text;
  v_cab text := 'FUNCTION public.get_tokens_mensal(';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'get_tokens_mensal'
     AND pg_get_function_identity_arguments(p.oid) = 'p_mes date';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'get_tokens_mensal(date) não existe';
  END IF;
  IF position('%sem celular%' in v_def) > 0 THEN
    RAISE EXCEPTION 'get_tokens_mensal JÁ tem a regra de sem celular — nada a diagnosticar';
  END IF;
  IF position(v_cab in v_def) = 0 THEN
    RAISE EXCEPTION 'cabeçalho inesperado em pg_get_functiondef';
  END IF;

  v_def := pg_temp.patch_sem_celular(v_def);
  v_def := replace(v_def, v_cab, 'FUNCTION pg_temp.get_tokens_mensal_novo(');
  EXECUTE v_def;
END
$d$;

CREATE TEMP TABLE diag_resultado (secao text, detalhe text, valor text);
CREATE TEMP TABLE diag_antes  (linha jsonb);
CREATE TEMP TABLE diag_depois (linha jsonb);

-- Comparação e tempo, mês a mês.
DO $d$
DECLARE
  v_mes   date;
  v_t0    timestamptz;
  v_perd  int;
  v_novas int;
BEGIN
  FOREACH v_mes IN ARRAY ARRAY['2026-07-01', '2026-08-01', '2026-09-01']::date[] LOOP
    v_t0 := clock_timestamp();
    TRUNCATE diag_antes;
    INSERT INTO diag_antes SELECT to_jsonb(t) FROM public.get_tokens_mensal(v_mes) t;
    INSERT INTO diag_resultado VALUES ('tempo', v_mes || ' vigente',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000) || ' ms');

    v_t0 := clock_timestamp();
    TRUNCATE diag_depois;
    INSERT INTO diag_depois SELECT to_jsonb(t) FROM pg_temp.get_tokens_mensal_novo(v_mes) t;
    INSERT INTO diag_resultado VALUES ('tempo', v_mes || ' nova',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000) || ' ms');

    SELECT count(*) INTO v_perd  FROM (SELECT linha FROM diag_antes  EXCEPT ALL SELECT linha FROM diag_depois) x;
    SELECT count(*) INTO v_novas FROM (SELECT linha FROM diag_depois EXCEPT ALL SELECT linha FROM diag_antes)  x;

    INSERT INTO diag_resultado VALUES
      ('comparacao', v_mes || ' linhas hoje',            (SELECT count(*) FROM diag_antes)::text),
      ('comparacao', v_mes || ' perdidas_ou_alteradas',  v_perd::text),
      ('comparacao', v_mes || ' novas',                  v_novas::text);

    INSERT INTO diag_resultado
    SELECT 'nova_linha', v_mes || ' ' || coalesce(linha->>'data_atendimento', '?') || ' '
             || coalesce(left(linha->>'hora_inicial', 5), '?'),
           concat_ws(' | ', linha->>'paciente_nome', linha->>'terapias',
                     'guia ' || coalesce(linha->>'guia', '—'), linha->>'forma_autorizacao')
      FROM (SELECT linha FROM diag_depois EXCEPT ALL SELECT linha FROM diag_antes) x;
  END LOOP;
END
$d$;

-- Volume nas duas fontes.
INSERT INTO diag_resultado
SELECT 'volume', 'relatorio 3- ' || to_char(date(aa.data_execucao), 'YYYY-MM')
         || CASE WHEN aa.teve_token THEN ' com token' ELSE ' sem token' END,
       count(*)::text
  FROM public.autorizacoes_assim aa
 WHERE split_part(btrim(COALESCE(aa.biofacial, '')), '-', 1) = '3'
 GROUP BY 2;

INSERT INTO diag_resultado
SELECT 'volume', 'fila sem celular ' || to_char(f.data_atendimento, 'YYYY-MM'),
       count(*)::text
  FROM public.fila_autorizacoes f
 WHERE f.data_atendimento >= '2026-07-01'
   AND f.forma_autorizacao ILIKE '%sem celular%'
 GROUP BY 2;

-- O caso de 23/09 16:03, nas duas fontes.
INSERT INTO diag_resultado
SELECT 'maria_clara', 'fila ' || f.data_atendimento || ' ' || left(f.horario::text, 5),
       concat_ws(' | ', f.paciente_nome, f.tuss, 'status ' || f.status,
                 'assim ' || coalesce(f.status_assim, '—'),
                 'guia ' || coalesce(f.numero_autorizacao, '—'),
                 'forma ' || coalesce(f.forma_autorizacao, '—'),
                 'biofacial ' || coalesce(f.biofacial_assim, '—'))
  FROM public.fila_autorizacoes f
 WHERE f.paciente_nome ILIKE 'MARIA CLARA BERT%'
   AND f.data_atendimento = '2026-09-23';

INSERT INTO diag_resultado
SELECT 'maria_clara', 'relatorio ' || to_char(aa.data_execucao, 'DD/MM HH24:MI'),
       concat_ws(' | ', aa.paciente_nome, aa.codigo_tuss, 'guia ' || aa.guia,
                 'status ' || coalesce(aa.status, '—'),
                 'token ' || coalesce(aa.token, '—'),
                 'biofacial ' || coalesce(aa.biofacial, '—'))
  FROM public.autorizacoes_assim aa
 WHERE aa.paciente_nome ILIKE 'MARIA CLARA BERT%'
   AND date(aa.data_execucao) BETWEEN '2026-09-22' AND '2026-09-24';

SELECT * FROM diag_resultado
 ORDER BY CASE secao WHEN 'comparacao' THEN 1 WHEN 'tempo' THEN 2 WHEN 'volume' THEN 3
                     WHEN 'maria_clara' THEN 4 ELSE 5 END,
          detalhe;
