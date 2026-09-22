-- O feriado que meu CREATE OR REPLACE apagou.
--
-- Regressão introduzida por 20260922220000 e 20260922230000, reportada da tela:
-- o cartão de falta sumiu do modal da reconciliação e o feriado de 07/09 voltou
-- a aparecer como "Retorno Não Confirmado" — exatamente o sintoma que
-- 20260917110000 existia para consertar.
--
-- A CAUSA
--
-- 20260917110000 não recria função nenhuma: ela lê `pg_get_functiondef` e
-- injeta o predicado de unidade por `replace` de texto. É uma edição sobre o
-- corpo VIVO, e não deixa rastro em nenhum `CREATE OR REPLACE` do repositório.
--
-- As minhas duas migrations extraíram o corpo de 20260916130100 — a última
-- migration que CRIA cada função — e regravaram por inteiro. Correto quanto à
-- substituição, e cego quanto ao que veio depois: o `CREATE OR REPLACE`
-- sobrescreveu a definição de 17/09 com a de 16/09 e levou o feriado junto.
--
-- Medido antes de escrever esta migration:
--   get_auditoria_assim_periodo → PERDEU O FERIADO / tem substituicao
--   get_faltas_auditoria_assim  → PERDEU O FERIADO / tem substituicao
--
-- Ou seja: as DUAS pontas da mesma ponte. A primeira parou de mandar o feriado
-- embora da Conferência, a segunda parou de recebê-lo de volta como cartão. Por
-- isso os dois sintomas apareceram na mesma tela, no mesmo dia.
--
-- A LIÇÃO, para a próxima vez que alguém for recriar uma função destas
--
-- "a última migration que define a função" NÃO é a última que a ALTERA. Antes
-- de um `CREATE OR REPLACE` sobre função com histórico, o corpo tem que sair de
-- `pg_get_functiondef` no banco vivo, nunca de um arquivo do repo. O repo
-- descreve a intenção acumulada; só o banco sabe o estado.
--
-- O CONSERTO
--
-- Reexecutar os dois blocos de 20260917110000, sem alteração. Eles são
-- idempotentes por construção (saem por `RETURN` se a marca já estiver lá),
-- exigem contagem exata de ocorrências e FALHAM em vez de aplicar meio
-- conserto. Aplicados agora, reinjetam o feriado sobre o corpo que já tem a
-- substituição — as duas correções passam a coexistir, que é como deveriam ter
-- nascido.
--
-- Verificado antes de aplicar: os dois textos-alvo sobreviveram intactos às
-- minhas migrations (2 ocorrências do predicado de TERAPEUTA em
-- 20260922220000; o predicado de `tipo_falta` na forma literal em
-- 20260922230000). Nada aqui toca a substituição.
--
-- Sem DROP: as assinaturas não mudam, `CREATE OR REPLACE` basta e os GRANTs
-- sobrevivem.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. get_auditoria_assim_periodo — os dois anti-joins
-- ---------------------------------------------------------------------------

DO $migr$
DECLARE
  v_def text;
  -- O texto é idêntico nos dois anti-joins (`agenda_sem_falta` e
  -- `fila_ordenada`), então um `replace` sem contador troca os dois de uma vez.
  v_old text := 'OR upper(COALESCE(f.tipo_falta, '''')) LIKE ''%TERAPEUTA%''';
  v_new text := 'OR upper(COALESCE(f.tipo_falta, '''')) LIKE ''%TERAPEUTA%''' || E'\n'
             || '            OR upper(COALESCE(f.tipo_falta, '''')) LIKE ''%UNIDADE%''';
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

  IF v_def LIKE '%LIKE ''%UNIDADE%''%' THEN
    RAISE NOTICE 'get_auditoria_assim_periodo já reconhece unidade_fechada';
    RETURN;
  END IF;

  v_trocas := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);

  -- Dois, e exatamente dois. Um só significa que um dos anti-joins mudou de
  -- forma e ficaria para trás — meio conserto é pior que nenhum, porque a
  -- sessão sumiria de um lado e continuaria cobrada do outro.
  IF v_trocas <> 2 THEN
    RAISE EXCEPTION
      'esperava 2 ocorrências do predicado de TERAPEUTA, achei %. A definição em produção divergiu: extraia com pg_get_functiondef e reveja à mão.',
      v_trocas;
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
  RAISE NOTICE 'get_auditoria_assim_periodo: unidade_fechada sai da Conferência (2 anti-joins)';
END
$migr$;

comment on function public.get_auditoria_assim_periodo(date, date) is
  'Conferencia ASSIM por periodo. Desde 20260917110000 a falta de UNIDADE '
  '(clinica fechada) tambem sai daqui e volta por get_faltas_auditoria_assim, '
  'como ja acontecia com as faltas de paciente e de terapeuta -- reinjetado por '
  '20260922240000, depois que 20260922220000 o sobrescreveu. Desde 20260922220000 '
  'a substituicao cobre o bloco como o vinculo. Devolve as observacoes escritas '
  'por gente: motivo_falta, justificativa_falta e os quatro campos de sessao '
  'adiantada, ao lado dos metadados da reclassificacao.';

-- ---------------------------------------------------------------------------
-- 2. get_faltas_auditoria_assim — o canal por onde ela volta
-- ---------------------------------------------------------------------------

DO $migr$
DECLARE
  v_def text;
  v_old text := '(f.tipo_falta ILIKE ''%paciente%'' OR f.tipo_falta ILIKE ''%terapeuta%'')';
  v_new text := '(f.tipo_falta ILIKE ''%paciente%'' OR f.tipo_falta ILIKE ''%terapeuta%'' OR f.tipo_falta ILIKE ''%unidade%'')';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'get_faltas_auditoria_assim'
     AND pg_get_function_identity_arguments(p.oid) = 'p_data date';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'get_faltas_auditoria_assim(date) não existe';
  END IF;

  IF v_def LIKE '%ILIKE ''%unidade%''%' THEN
    RAISE NOTICE 'get_faltas_auditoria_assim já reconhece unidade_fechada';
    RETURN;
  END IF;

  IF position(v_old in v_def) = 0 THEN
    RAISE EXCEPTION
      'predicado de tipo_falta não encontrado em get_faltas_auditoria_assim; a definição em produção divergiu do repo.';
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
  RAISE NOTICE 'get_faltas_auditoria_assim: unidade_fechada volta como cartão de falta';
END
$migr$;

comment on function public.get_faltas_auditoria_assim(date) is
  'Cartoes de falta da Conferencia. Inclui tipo_falta ''unidade_fechada'' (a '
  'clinica nao abriu) alem de paciente e terapeuta -- reinjetado por '
  '20260922240000, depois que 20260922230000 o sobrescreveu. Desde 20260922230000 '
  'a falta com substituicao sai daqui (o titular faltou, mas alguem assumiu). '
  'NAO confundir com assiduidade: contar_faltas_do_paciente segue contando so '
  '''paciente''.';

-- =============================================================================
-- VERIFICAÇÃO — as duas correções coexistindo
-- =============================================================================
DO $verif$
DECLARE
  r record;
  v_falhas int := 0;
BEGIN
  FOR r IN
    -- ILIKE, e não LIKE: o predicado injetado é '%UNIDADE%' em
    -- get_auditoria_assim_periodo (que compara com `upper(...)`) e '%unidade%'
    -- em get_faltas_auditoria_assim (que usa ILIKE). Um LIKE maiúsculo aqui
    -- reprova a segunda função mesmo com o conserto aplicado -- e, como o SQL
    -- Editor roda o script inteiro em UMA transação, essa reprovação falsa
    -- desfaz os dois replaces junto. Foi o que aconteceu na primeira tentativa.
    SELECT p.proname,
           pg_get_functiondef(p.oid) ILIKE '%unidade%'      AS tem_feriado,
           pg_get_functiondef(p.oid) ILIKE '%substituicao%' AS tem_substituicao
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('get_auditoria_assim_periodo', 'get_faltas_auditoria_assim')
  LOOP
    IF NOT r.tem_feriado THEN
      RAISE WARNING '%: SEM feriado', r.proname;
      v_falhas := v_falhas + 1;
    END IF;
    IF NOT r.tem_substituicao THEN
      RAISE WARNING '%: SEM substituicao', r.proname;
      v_falhas := v_falhas + 1;
    END IF;
  END LOOP;

  IF v_falhas > 0 THEN
    RAISE EXCEPTION '% verificacoes falharam; as duas correcoes NAO estao coexistindo', v_falhas;
  END IF;

  RAISE NOTICE 'OK: feriado e substituicao presentes nas duas funcoes';
END
$verif$;
