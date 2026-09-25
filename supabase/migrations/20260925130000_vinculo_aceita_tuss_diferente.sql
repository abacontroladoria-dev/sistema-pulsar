-- =============================================================================
-- O vínculo aceita guia de TUSS diferente do da sessão, com observação obrigatória.
--
-- CASO: Miguel Rodrigues De Queiroz (11692), 24/09/2026. Coordenador de Caso das
-- 14:20 (TUSS 22070384) glosada por reincidência (1601, guia 411906) — o 22070384
-- já tinha sido usado às 13:00 no mesmo dia. A refação saiu às 17:18 como avulsa
-- de Terapia Ocupacional (22070427, guia 422932). A Reconciliação não oferecia a
-- sessão como candidata e `vincular_autorizacao` recusava: "TUSS divergente".
--
-- DECISÃO DO USUÁRIO (25/09): aceitar TUSS diferente SEMPRE, não só na avulsa.
-- A única trava que fica é a observação: com TUSS diferente, o vínculo exige
-- texto dizendo por quê — é o único lugar onde fica registrado que uma guia de
-- TO cobre uma sessão de Psicologia.
--
-- O QUE MUDA
--   - vincular_autorizacao, vincular_autorizacao_falta,
--     vincular_autorizacao_substituicao: a guarda de TUSS vira "TUSS diferente
--     exige observação" (mesma posição, mesmo errcode 22023);
--   - get_candidatas_vinculo: deixa de filtrar por TUSS (sessões E faltas) e
--     passa a ORDENAR mesmo TUSS primeiro — senão a sessão certa se perde entre
--     todas as do beneficiário na semana.
--
-- O QUE NÃO MUDA: beneficiário (carteirinha inteira), janela retroativa,
-- unicidade de cobertura. A cota passa a ser contada no TUSS da sessão coberta
-- (frontend, `tussDasGuiasVinculadas` em reconciliacao/contagem.ts).
--
-- TÉCNICA: edição por texto sobre pg_get_functiondef com contagem exata
-- (reference_migration_edita_por_texto). pg_get_functiondef devolve os SET de
-- proconfig (statement_timeout, search_path), então eles sobrevivem.
-- Sem DROP: assinaturas iguais, os GRANTs ficam.
-- =============================================================================

set lock_timeout = '5s';

CREATE OR REPLACE FUNCTION pg_temp.editar_funcao(
  p_nome   text,
  p_args   text,
  p_trocas text[][],   -- {{antigo, novo, ocorrencias_esperadas}, ...}
  p_marca  text        -- texto que só existe depois de aplicada (idempotência)
) RETURNS void
LANGUAGE plpgsql AS $f$
DECLARE
  v_def text;
  v_n   int;
  i     int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = p_nome
     AND pg_get_function_identity_arguments(p.oid) = p_args;

  IF v_def IS NULL THEN
    RAISE EXCEPTION '%(%) não existe', p_nome, p_args;
  END IF;

  IF position(p_marca in v_def) > 0 THEN
    RAISE NOTICE '% já aceita TUSS diferente', p_nome;
    RETURN;
  END IF;

  FOR i IN 1 .. array_length(p_trocas, 1) LOOP
    v_n := (length(v_def) - length(replace(v_def, p_trocas[i][1], ''))) / length(p_trocas[i][1]);
    IF v_n <> p_trocas[i][3]::int THEN
      RAISE EXCEPTION '%: troca % esperava % ocorrência(s), achei %. Extraia com pg_get_functiondef e reveja à mão.',
        p_nome, i, p_trocas[i][3], v_n;
    END IF;
    v_def := replace(v_def, p_trocas[i][1], p_trocas[i][2]);
  END LOOP;

  EXECUTE v_def;
  RAISE NOTICE '%: TUSS diferente aceito com observação', p_nome;
END
$f$;

-- ---------------------------------------------------------------------------
-- 1. vincular_autorizacao (sessão)
-- ---------------------------------------------------------------------------
SELECT pg_temp.editar_funcao(
  'vincular_autorizacao',
  'p_guia text, p_bloco_id text, p_fila_id uuid, p_observacao text, p_janela_dias integer',
  ARRAY[
    ARRAY[
      'if v_b.codigo_tuss is distinct from v_g.codigo_tuss then',
      'if v_b.codigo_tuss is distinct from v_g.codigo_tuss and nullif(btrim(p_observacao), '''') is null then',
      '1'],
    ARRAY[
      'raise exception ''TUSS divergente: guia % é %, bloco é %'',',
      'raise exception ''TUSS diferente (guia % é %, sessão é %): escreva na observação por que esta guia cobre a sessão'',',
      '1']
  ],
  -- A marca é a CONDIÇÃO, não a mensagem: 20260925150100 reescreve a mensagem.
  'is distinct from v_g.codigo_tuss and nullif(btrim(p_observacao)'
);

-- ---------------------------------------------------------------------------
-- 2. vincular_autorizacao_falta e 3. vincular_autorizacao_substituicao (falta)
-- ---------------------------------------------------------------------------
SELECT pg_temp.editar_funcao(
  f.nome,
  'p_guia text, p_fila_id uuid, p_observacao text, p_janela_dias integer',
  ARRAY[
    ARRAY[
      'if v_f.tuss is distinct from v_g.codigo_tuss then',
      'if v_f.tuss is distinct from v_g.codigo_tuss and nullif(btrim(p_observacao), '''') is null then',
      '1'],
    ARRAY[
      'raise exception ''TUSS divergente: guia % é %, falta é %'',',
      'raise exception ''TUSS diferente (guia % é %, falta é %): escreva na observação por que esta guia corresponde a este horário'',',
      '1']
  ],
  'v_f.tuss is distinct from v_g.codigo_tuss and nullif(btrim(p_observacao)'
)
FROM (VALUES ('vincular_autorizacao_falta'), ('vincular_autorizacao_substituicao')) AS f(nome);

-- ---------------------------------------------------------------------------
-- 4. get_candidatas_vinculo — sem filtro de TUSS, mesmo TUSS primeiro
-- ---------------------------------------------------------------------------
-- Por REGEX e não por texto literal: esta função foi colada no SQL Editor a
-- partir de arquivo com quebra de linha do Windows, e o corpo em produção tem
-- `\r\n` — um alvo de várias linhas escrito com `\n` não casa (primeira tentativa
-- de aplicar esta migration, 25/09). `\s+` aceita qualquer espaço e quebra.
DO $migr$
DECLARE
  v_def text;
  v_n   int;
  re_sessao text := '\s+and\s+a\.codigo_tuss\s*=\s*v_g\.codigo_tuss';
  re_falta  text := '\s+and\s+f\.tuss\s*=\s*v_g\.codigo_tuss';
  re_ordem  text := '(from\s+todas\s+t\s+order\s+by)';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'get_candidatas_vinculo'
     AND pg_get_function_identity_arguments(p.oid) = 'p_guia text, p_janela_dias integer';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'get_candidatas_vinculo(text,integer) não existe';
  END IF;

  IF position('20260925130000' in v_def) > 0 THEN
    RAISE NOTICE 'get_candidatas_vinculo já aceita TUSS diferente';
    RETURN;
  END IF;

  v_n := (SELECT count(*) FROM regexp_matches(v_def, re_sessao, 'g'));
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'get_candidatas_vinculo: filtro de TUSS das sessões esperado 1x, achei %', v_n;
  END IF;
  v_n := (SELECT count(*) FROM regexp_matches(v_def, re_falta, 'g'));
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'get_candidatas_vinculo: filtro de TUSS das faltas esperado 1x, achei %', v_n;
  END IF;
  v_n := (SELECT count(*) FROM regexp_matches(v_def, re_ordem, 'gi'));
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'get_candidatas_vinculo: "from todas t order by" esperado 1x, achei %', v_n;
  END IF;

  v_def := regexp_replace(v_def, re_sessao, '');
  v_def := regexp_replace(v_def, re_falta, '');
  v_def := regexp_replace(v_def, re_ordem,
    E'\\1\n    -- 20260925130000: TUSS diferente é aceito, mas o mesmo TUSS vem antes.\n    (t.codigo_tuss is distinct from v_g.codigo_tuss),', 'i');

  EXECUTE v_def;
  RAISE NOTICE 'get_candidatas_vinculo: sem filtro de TUSS, mesmo TUSS primeiro';
END
$migr$;

COMMENT ON FUNCTION public.get_candidatas_vinculo(text, integer) IS
  'Candidatas de uma guia órfã: sessões do mesmo beneficiário na janela retroativa (default 7 dias) medida sobre coalesce(data_atendimento_real, data_atendimento), MAIS as faltas de TERAPEUTA da mesma janela. Desde 20260925130000 não filtra por TUSS (o vínculo aceita TUSS diferente com observação) e ordena o mesmo TUSS primeiro. Varre um dia a mais para alcançar sessões adiantadas. Nunca vincula — só ordena por relevância.';

COMMENT ON FUNCTION public.vincular_autorizacao(text, text, uuid, text, integer) IS
  'Vincula uma guia ASSIM órfã à sessão que ela cobre. Valida beneficiário, janela e unicidade no servidor. TUSS diferente é aceito desde 20260925130000, com observação obrigatória. A janela é retroativa e medida sobre coalesce(data_atendimento_real, data_atendimento). Não escreve em fila_autorizacoes nem em autorizacoes_assim.';
