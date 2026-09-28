-- =============================================================================
-- As recusas por falta de observação passam a DIZER que falta comentário.
--
-- Depois de 20260925130000 (TUSS diferente) e 20260925140100 (sessão posterior
-- na mesma semana), as duas regras só passam com observação. Mas as mensagens
-- ainda descreviam a regra e deixavam o "precisa de comentário" no fim — ou, na
-- janela, misturavam "fora da janela" com "sem observação" numa frase só. A
-- recepção tentou vincular a 334308 (Miguel, seg 21/09) à glosa de qui 24/09,
-- leu "fora da janela" e achou que o vínculo era impossível.
--
-- Agora:
--   - sessão posterior, na semana, SEM observação → erro próprio, que começa por
--     "Comentário obrigatório";
--   - fora da janela de verdade → a mensagem de janela, sem falar em observação;
--   - TUSS diferente sem observação → começa por "Comentário obrigatório".
--
-- Edição por regex sobre pg_get_functiondef (corpo pode ter \r\n), contagem
-- exata, idempotente pela marca 20260925150100.
-- =============================================================================

set lock_timeout = '5s';

CREATE OR REPLACE FUNCTION pg_temp.trocar(p_nome text, p_args text, p_trocas text[][])
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_def text;
  v_n   int;
  i     int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = p_nome
     AND pg_get_function_identity_arguments(p.oid) = p_args;

  IF v_def IS NULL THEN
    RAISE EXCEPTION '%(%) não existe', p_nome, p_args;
  END IF;
  IF position('20260925150100' in v_def) > 0 THEN
    RAISE NOTICE '% já tem as mensagens novas', p_nome;
    RETURN;
  END IF;

  FOR i IN 1 .. array_length(p_trocas, 1) LOOP
    v_n := (SELECT count(*) FROM regexp_matches(v_def, p_trocas[i][1], 'g'));
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: troca % esperava 1 ocorrência, achei %. Reveja à mão (as migrations 20260925130000 e 20260925140100 foram aplicadas?).',
        p_nome, i, v_n;
    END IF;
    v_def := regexp_replace(v_def, p_trocas[i][1], p_trocas[i][2]);
  END LOOP;

  EXECUTE v_def;
  RAISE NOTICE '%: mensagens de comentário obrigatório', p_nome;
END
$f$;

-- 1. vincular_autorizacao: guarda própria para "posterior sem comentário",
--    ANTES da de janela; a de janela volta a falar só de janela.
SELECT pg_temp.trocar(
  'vincular_autorizacao',
  'p_guia text, p_bloco_id text, p_fila_id uuid, p_observacao text, p_janela_dias integer',
  ARRAY[
    ARRAY[
      '''TUSS diferente \(guia % é %, sessão é %\): escreva na observação por que esta guia cobre a sessão''',
      '''Comentário obrigatório: a guia % é do TUSS % e a sessão é do TUSS %. Escreva na observação por que esta guia cobre a sessão.'''],
    ARRAY[
      'if /\* 20260925140100 \*/',
      'if /* 20260925150100 */ v_efetiva > date(v_g.data_execucao)'
      || ' and v_efetiva <= date_trunc(''week'', v_g.data_execucao)::date + 6'
      || ' and nullif(btrim(p_observacao), '''') is null then'
      || ' raise exception ''Comentário obrigatório: a sessão (%) é posterior à guia (%). Escreva na observação de onde a guia saiu.'','
      || ' v_efetiva, date(v_g.data_execucao) using errcode = ''22023'';'
      || ' end if;' || chr(10) || '  if /* 20260925140100 */'],
    ARRAY[
      '''Sessão de % fora da janela: até % dias antes da autorização \(%\), ou depois dela na mesma semana com observação''',
      '''Sessão de % fora da janela: só vale até % dias antes da autorização (%) ou depois dela até o domingo da mesma semana.''']
  ]
);

-- 2 e 3. vincular_autorizacao_falta / _substituicao: só o texto do TUSS.
SELECT pg_temp.trocar(
  f.nome,
  'p_guia text, p_fila_id uuid, p_observacao text, p_janela_dias integer',
  ARRAY[
    ARRAY[
      '''TUSS diferente \(guia % é %, falta é %\): escreva na observação por que esta guia corresponde a este horário''',
      -- A marca fica FORA da string, como comentário SQL: dentro dela apareceria
      -- na mensagem para o usuário.
      '''Comentário obrigatório: a guia % é do TUSS % e a falta é do TUSS %. Escreva na observação por que esta guia corresponde a este horário.'' /* 20260925150100 */']
  ]
)
FROM (VALUES ('vincular_autorizacao_falta'), ('vincular_autorizacao_substituicao')) AS f(nome);
