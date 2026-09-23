-- A sessão com substituto sumiu das DUAS fontes.
--
-- Reportado da tela (modal da reconciliação, João Lucas Pereira Da Silva, 21/09):
-- "1 intercorrência" e a sessão das 09:20 não aparece em lugar nenhum.
--
-- DOIS DEFEITOS EM SÉRIE, os dois medidos antes de escrever isto.
--
-- 1. O SLOT MORRIA NO ANTI-JOIN
--
-- A Conferência é construída A PARTIR DA AGENDA: `agenda_sem_falta` é a CTE
-- raiz e a fila entra depois. Seus dois anti-joins removem da agenda todo slot
-- com linha de falta na fila, olhando só `tipo_falta` e `status_assim` -- nunca
-- `autorizacoes_vinculos`. O slot das 09:20 era descartado ANTES de chegar ao
-- LATERAL `vin` que 20260922220000 ensinou a reconhecer `substituicao`: aquele
-- conserto está numa etapa POSTERIOR à que joga a linha fora.
--
-- Somado a 20260922230000, que tirou a mesma sessão de get_faltas_auditoria_assim
-- de propósito, ela sumiu das duas fontes que alimentam a semana do modal
-- (useAnaliseReincidencia une listarAuditoriaAssim + listarFaltasAuditoria).
-- Tirei de um lado e não coloquei no outro.
--
-- 2. O `vin` NÃO ACHAVA O VÍNCULO
--
-- Com o slot de volta, a sessão veio RETORNO_NAO_CONFIRMADO e guia nula: o
-- LATERAL casa por `v.bloco_id = b.bloco_id`, e o vínculo de substituição nasce
-- com o bloco_id SINTÉTICO da falta, de formato diferente do bloco real:
--
--   vínculo:  falta_11635_2026-09-21_09:20:00_22070397
--   sessão:         11635_2026-09-21_22070397_09:20:00
--
-- Prefixo `falta_` e TUSS/hora invertidos. Nunca casa. O vínculo também guarda
-- `fila_id`, e é por ele que a ponte se faz.
--
-- O CONSERTO
--
-- Bloco 1: os dois anti-joins passam a preservar o slot cuja falta foi triada
-- como `substituicao` -- o mesmo predicado que 20260922230000 usa na função de
-- faltas, na direção oposta (lá TIRA o cartão, aqui DEVOLVE o slot). Falta de
-- paciente, de unidade e `falta_terapeuta` sem substituto seguem saindo daqui.
--
-- Bloco 2: o `vin` aceita o vínculo por `bloco_id` OU pela linha da fila que
-- corresponde ao slot (paciente + data + horário + tuss).
--
-- Resultado medido: 09:20 volta LIBERADA. A coluna `guia` fica nula porque ela
-- é a da captura direta (`mt.guia`) e a 321907 chegou pelo vínculo -- igual a
-- qualquer sessão coberta por triagem. Quem decide a situação é `vin.guia`.
--
-- A falta do titular continua registrada em fila_autorizacoes. Nada aqui a
-- desfaz -- ver 20260922210000.
--
-- POR QUE POR TEXTO, E NÃO CREATE OR REPLACE
--
-- Recriar o corpo foi o que quebrou o feriado duas vezes hoje (20260922240000).
-- Estes são os MESMOS anti-joins que a migration de feriado edita. Editar por
-- texto preserva o que veio antes sem eu precisar saber o que é.
--
-- SOBRE AS ASPAS, que custaram cinco padrões casando zero: `quote_literal`
-- DOBRA as aspas para produzir um literal, e ler sua saída como texto cru leva
-- a dobrá-las de novo. O texto tem UMA aspa por posição. Aqui elas vêm de
-- `chr(39)`, que não passa por camada de escape nenhuma. O separador de linha
-- é CRLF, então `\s+` -- nunca `\n`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Os dois anti-joins preservam o slot com substituto
-- ---------------------------------------------------------------------------

DO $migr$
DECLARE
  v_def  text;
  v_novo text;
  q      text := chr(39);
  v_pat  text;
  v_rep  text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
    FROM pg_proc
   WHERE proname = 'get_auditoria_assim_periodo'
     AND pronamespace = 'public'::regnamespace;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'get_auditoria_assim_periodo nao existe';
  END IF;

  IF position('vs.tipo' in v_def) > 0 THEN
    RAISE NOTICE 'anti-joins ja deixam a substituicao atravessar';
    RETURN;
  END IF;

  -- Âncora no predicado de UNIDADE porque ele é o ÚLTIMO termo do OR nos dois
  -- anti-joins, então o `)` seguinte fecha o grupo. Depende de 20260922240000.
  v_pat := 'LIKE ' || q || '%UNIDADE%' || q || '\s+\)';

  v_rep := 'LIKE ' || q || '%UNIDADE%' || q || chr(10) ||
           '          )' || chr(10) ||
           '          AND NOT EXISTS (' || chr(10) ||
           '            SELECT 1 FROM public.autorizacoes_vinculos vs' || chr(10) ||
           '            WHERE vs.fila_id = f.id AND vs.desfeito_em IS NULL' || chr(10) ||
           '              AND vs.tipo = ' || q || 'substituicao' || q || chr(10) ||
           '          )';

  -- Alias `vs`, e não `v`: a função já tem um `v` no filtro das avulsas, e
  -- verificar por `v.` daria falso positivo nele. Custou uma rodada.
  IF (SELECT count(*) FROM regexp_matches(v_def, v_pat, 'g')) <> 2 THEN
    RAISE EXCEPTION 'esperava 2 ancoras de UNIDADE, achei %; aplique 20260922240000 antes desta',
      (SELECT count(*) FROM regexp_matches(v_def, v_pat, 'g'));
  END IF;

  v_novo := regexp_replace(v_def, v_pat, v_rep, 'g');

  IF (SELECT count(*) FROM regexp_matches(v_novo, 'vs\.tipo', 'g')) <> 2 THEN
    RAISE EXCEPTION 'a injecao nao produziu 2 predicados';
  END IF;

  EXECUTE v_novo;
  RAISE NOTICE 'anti-joins: a substituicao atravessa os 2';
END
$migr$;

-- ---------------------------------------------------------------------------
-- 2. O `vin` acha o vínculo pela linha da fila
-- ---------------------------------------------------------------------------

DO $migr$
DECLARE
  v_def  text;
  v_novo text;
  v_pat  text;
  v_rep  text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
    FROM pg_proc
   WHERE proname = 'get_auditoria_assim_periodo'
     AND pronamespace = 'public'::regnamespace;

  IF position('vs_fila' in v_def) > 0 THEN
    RAISE NOTICE 'vin ja acha o vinculo pela fila';
    RETURN;
  END IF;

  v_pat := 'WHERE v\.bloco_id = b\.bloco_id';

  -- O bloco_id sintético da falta nunca casa com o real (ver cabeçalho), então
  -- o segundo caminho é a linha da fila que corresponde ao slot. A marca
  -- `/*vs_fila*/` é o que torna este bloco idempotente.
  v_rep := 'WHERE (v.bloco_id = b.bloco_id OR v.fila_id IN ('
        || 'SELECT f2.id FROM public.fila_autorizacoes f2 /*vs_fila*/ '
        || 'WHERE f2.paciente_id::bigint = b.paciente_id::bigint '
        || 'AND f2.data_atendimento = b.data_atendimento '
        || 'AND f2.horario = b.hora_inicial AND f2.tuss = b.codigo_tuss))';

  IF (SELECT count(*) FROM regexp_matches(v_def, v_pat, 'g')) <> 1 THEN
    RAISE EXCEPTION 'esperava 1 ocorrencia de `WHERE v.bloco_id = b.bloco_id`, achei %',
      (SELECT count(*) FROM regexp_matches(v_def, v_pat, 'g'));
  END IF;

  v_novo := regexp_replace(v_def, v_pat, v_rep, 'g');
  EXECUTE v_novo;
  RAISE NOTICE 'vin: acha o vinculo por bloco_id OU por fila_id';
END
$migr$;

comment on function public.get_auditoria_assim_periodo(date, date) is
  'Conferencia ASSIM por periodo. A falta de PACIENTE, de TERAPEUTA e de UNIDADE '
  'sai daqui e volta por get_faltas_auditoria_assim -- exceto a triada como '
  '''substituicao'' (20260922250000), que permanece: o titular faltou, mas alguem '
  'assumiu e a sessao aconteceu. O LATERAL `vin` acha o vinculo por bloco_id OU '
  'pela linha da fila, porque o vinculo de substituicao nasce com o bloco_id '
  'sintetico da falta, de formato diferente do bloco real. Devolve as observacoes '
  'escritas por gente: motivo_falta, justificativa_falta e os quatro campos de '
  'sessao adiantada, ao lado dos metadados da reclassificacao.';

-- =============================================================================
-- VERIFICAÇÃO — as tres correcoes coexistindo
-- =============================================================================
DO $verif$
DECLARE
  v_def text;
  v_falhas int := 0;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
    FROM pg_proc
   WHERE proname = 'get_auditoria_assim_periodo'
     AND pronamespace = 'public'::regnamespace;

  -- ILIKE porque `unidade` aparece em caixas diferentes conforme a funcao
  -- (ver 20260922240000).
  IF v_def NOT ILIKE '%unidade%'      THEN RAISE WARNING 'SEM feriado';           v_falhas := v_falhas + 1; END IF;
  IF v_def NOT ILIKE '%substituicao%' THEN RAISE WARNING 'SEM substituicao';      v_falhas := v_falhas + 1; END IF;
  IF position('vs_fila' in v_def) = 0 THEN RAISE WARNING 'vin nao le a fila';     v_falhas := v_falhas + 1; END IF;

  IF (SELECT count(*) FROM regexp_matches(v_def, 'vs\.tipo', 'g')) <> 2 THEN
    RAISE WARNING 'o anti-join de substituicao nao esta nos DOIS lugares';
    v_falhas := v_falhas + 1;
  END IF;

  IF v_falhas > 0 THEN
    RAISE EXCEPTION '% verificacoes falharam', v_falhas;
  END IF;

  RAISE NOTICE 'OK: feriado, substituicao nos 2 anti-joins, e vin lendo a fila';
END
$verif$;
