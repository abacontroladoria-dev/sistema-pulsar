-- =============================================================================
-- Falta revertida não esconde mais a sessão da Conferência / Reconciliação.
--
-- CASO: John Lucas Borges De Araujo (11641), 14/09/2026, Fonoaudiologia 16:20.
-- A recepção lançou falta, reverteu (`falta_revertida_em` preenchido), o robô
-- autorizou (guia 211303, `status = 'concluido'`) — mas `status_assim` ficou
-- 'falta'. O anti-join de falta olha `status_assim LIKE '%FALTA%'` e nada mais,
-- então a sessão sumiu da agenda da auditoria e a guia dela apareceu no modal
-- da Reconciliação como autorização a mais. A grade TiTa diz Realizado.
--
-- POR QUE `status_assim` FICA: a reversão individual
-- (central-pacientes/page.tsx) e a em lote (reverter_falta_em_lote) limpam
-- `tipo_falta`, `motivo_falta` etc. e nunca tocaram em `status_assim`. A
-- reversão individual passa a limpá-lo no mesmo commit desta migration; esta
-- aqui faz o predicado parar de depender disso — `falta_revertida_em` é o
-- registro estruturado de "não é falta" e já é lido por 6 consumidores
-- (ver 20260916120000).
--
-- ALCANCE MEDIDO (set/2026): 118 linhas `concluido` com `status_assim` falta.
-- 117 são faltas de verdade concluídas pelo robô (guia 'N/A', nunca revertidas)
-- e CONTINUAM fora — a guarda só solta linha com `falta_revertida_em`. A única
-- que volta é a do John.
--
-- SÓ O RAMO DE `status_assim` ganha a guarda. Os ramos de `tipo_falta` não
-- precisam: as duas reversões zeram `tipo_falta`.
--
-- TÉCNICA: edição por texto sobre `pg_get_functiondef`, com contagem exata e
-- RAISE se o alvo não bater (reference_migration_edita_por_texto). As três
-- funções são LANGUAGE sql sem proconfig próprio no texto de produção
-- (20260925100000, extraído de pg_get_functiondef em 25/09).
--
-- PARIDADE: get_auditoria_assim_periodo e fn_blocos_assim mudam JUNTAS (se
-- divergirem a tela oferece o que a gravação recusa); get_tokens_mensal
-- compartilha a janela de pareamento e acompanha.
-- =============================================================================

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. get_auditoria_assim_periodo — agenda_sem_falta e fila_operacional
-- ---------------------------------------------------------------------------
DO $migr$
DECLARE
  v_def    text;
  -- Idêntico nos dois anti-joins; o `)` final prende o fragmento ao ramo de
  -- status_assim (fecha o parêntese do `status IS DISTINCT FROM 'glosa'`).
  v_old    text := 'AND upper(COALESCE(f.status_assim, '''')) LIKE ''%FALTA%'')';
  v_new    text := 'AND upper(COALESCE(f.status_assim, '''')) LIKE ''%FALTA%'''
               || E'\n             AND f.falta_revertida_em IS NULL)';
  v_trocas int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'get_auditoria_assim_periodo'
     AND pg_get_function_identity_arguments(p.oid) = 'p_data_inicio date, p_data_fim date';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'get_auditoria_assim_periodo(date,date) não existe';
  END IF;

  IF v_def LIKE '%falta_revertida_em IS NULL%' THEN
    RAISE NOTICE 'get_auditoria_assim_periodo já ignora falta revertida';
    RETURN;
  END IF;

  v_trocas := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_trocas <> 2 THEN
    RAISE EXCEPTION
      'get_auditoria_assim_periodo: esperava 2 ocorrências do ramo de status_assim, achei %. Extraia com pg_get_functiondef e reveja à mão.',
      v_trocas;
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
  RAISE NOTICE 'get_auditoria_assim_periodo: falta revertida não esconde sessão (2 anti-joins)';
END
$migr$;

-- ---------------------------------------------------------------------------
-- 2. fn_blocos_assim — a cópia de agenda_sem_falta (escrita em minúsculas)
-- ---------------------------------------------------------------------------
DO $migr$
DECLARE
  v_def    text;
  v_old    text := 'and upper(coalesce(f.status_assim, '''')) like ''%FALTA%'')';
  v_new    text := 'and upper(coalesce(f.status_assim, '''')) like ''%FALTA%'''
               || E'\n           and f.falta_revertida_em is null)';
  v_trocas int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'fn_blocos_assim'
     AND pg_get_function_identity_arguments(p.oid) = 'p_de date, p_ate date';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'fn_blocos_assim(date,date) não existe';
  END IF;

  IF v_def ILIKE '%falta_revertida_em is null%' THEN
    RAISE NOTICE 'fn_blocos_assim já ignora falta revertida';
    RETURN;
  END IF;

  v_trocas := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_trocas <> 1 THEN
    RAISE EXCEPTION
      'fn_blocos_assim: esperava 1 ocorrência do ramo de status_assim, achei %. Extraia com pg_get_functiondef e reveja à mão.',
      v_trocas;
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
  RAISE NOTICE 'fn_blocos_assim: falta revertida não esconde sessão';
END
$migr$;

-- ---------------------------------------------------------------------------
-- 3. get_tokens_mensal — mesmos dois anti-joins, sem a guarda de glosa
-- ---------------------------------------------------------------------------
DO $migr$
DECLARE
  v_def    text;
  v_old    text := 'upper(COALESCE(f.status_assim, '''')) LIKE ''%FALTA%''';
  v_new    text := '(upper(COALESCE(f.status_assim, '''')) LIKE ''%FALTA%'''
               || ' AND f.falta_revertida_em IS NULL)';
  v_trocas int;
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

  IF v_def LIKE '%falta_revertida_em IS NULL%' THEN
    RAISE NOTICE 'get_tokens_mensal já ignora falta revertida';
    RETURN;
  END IF;

  v_trocas := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_trocas <> 2 THEN
    RAISE EXCEPTION
      'get_tokens_mensal: esperava 2 ocorrências do ramo de status_assim, achei %. Extraia com pg_get_functiondef e reveja à mão.',
      v_trocas;
  END IF;

  -- pg_get_functiondef emite o proconfig do catálogo (SET ...), então um
  -- statement_timeout posto por ALTER sobrevive ao EXECUTE.
  EXECUTE replace(v_def, v_old, v_new);
  RAISE NOTICE 'get_tokens_mensal: falta revertida não esconde sessão (2 anti-joins)';
END
$migr$;
