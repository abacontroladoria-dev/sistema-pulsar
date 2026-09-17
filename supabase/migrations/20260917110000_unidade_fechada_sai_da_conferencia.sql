-- `unidade_fechada` deixa de ser cobrada como "Retorno não confirmado".
--
-- JÁ APLICADO EM PRODUÇÃO em 2026-09-17, pelo SQL Editor. Medido na aplicação,
-- sobre 07/09/2026 (Independência):
--   - Conferência do Davi Lucas: 4 linhas RETORNO_NAO_CONFIRMADO -> 0
--   - get_faltas_auditoria_assim: 0 linhas -> as 4, com motivo e justificativa
--   - o dia inteiro: 336 sessões saíram da Conferência e 336 entraram nas faltas
--     (nenhuma se perdeu entre as duas RPCs)
--   - contar_faltas_do_paciente('11579', setembro) = 2, inalterado: o feriado
--     nunca entrou na assiduidade e continua fora
--
-- POR QUE
-- Em 07/09/2026 (Independência) a recepção lançou falta de unidade no dia
-- inteiro: 336 linhas com `tipo_falta = 'unidade_fechada'`. Todas as 336
-- apareceram na Conferência da gestora como RETORNO_NAO_CONFIRMADO, pedindo
-- tratativa de um dia em que a clínica não abriu.
--
-- A causa é a mesma que o TODO de 20260908100200:113-132 já registrou para
-- `vw_central_pacientes`: quando `'unidade'` entrou na coluna, os predicados que
-- ENUMERAM tipos de falta não foram revisitados. São três, e os três só
-- reconhecem paciente e terapeuta:
--
--   1. `agenda_sem_falta` (get_auditoria_assim_periodo) — o anti-join que tira a
--      sessão faltosa da agenda.
--   2. `fila_ordenada` (idem) — o gêmeo do anterior, do lado da fila.
--   3. o WHERE de `get_faltas_auditoria_assim` — a RPC dos cartões de falta.
--
-- `unidade_fechada` não casa em nenhum dos três. Efeito combinado: a linha
-- escapa do anti-join, entra na Conferência sem autorização nem resposta da
-- ASSIM, e o CASE de `situacao` a despeja no último degrau
-- (RETORNO_NAO_CONFIRMADO) — e ao mesmo tempo NÃO aparece entre as faltas,
-- porque (3) também a rejeita. A sessão existia no lugar errado e em lugar
-- nenhum ao mesmo tempo.
--
-- O primeiro ramo dos anti-joins (`status_assim LIKE '%FALTA%'`) não a salva:
-- `registrar_falta_em_lote` grava `status` e `tipo_falta` e nunca toca em
-- `status_assim`. Medido em produção: as 336 linhas de 07/09 têm `status_assim`
-- nulo, sem exceção.
--
-- POR QUE ELA VOLTA COMO FALTA, E NÃO SOME
-- Sumir seria mais simples, mas a gestora perderia a informação de que o dia foi
-- neutralizado de propósito — um dia vazio é indistinguível de um dia que
-- ninguém auditou (é o mesmo argumento que `feriadosDoPeriodo` já carrega para
-- o gráfico da visão gerencial). Voltando por (3), ela reaparece como cartão com
-- estado próprio "Unidade fechada", fora da régua de autorização, ao lado das
-- outras duas espécies de falta. `tipo_falta` já viaja nessa RPC, então o
-- frontend distingue as três sem coluna nova.
--
-- Isto NÃO a coloca na assiduidade: `contar_faltas_do_paciente` filtra
-- `tipo_falta = 'paciente'` e continua intocada (20260908100200:99).
--
-- POR QUE POR pg_get_functiondef, E NÃO RECRIANDO O CORPO
-- `get_auditoria_assim_periodo` tem ~430 linhas e só DOIS predicados mudam.
-- Colar o corpo inteiro aqui o duplicaria e criaria divergência silenciosa com
-- 20260916130100 — exatamente o acidente que o wrapper de 20260917100000 acabou
-- de custar. Mesma técnica de 20260914180000:133-161, pelo mesmo motivo, e com o
-- mesmo cuidado: se o texto procurado não estiver lá, a migration FALHA em vez
-- de seguir em silêncio.
--
-- Sem DROP: a assinatura de retorno não muda, então `CREATE OR REPLACE` basta e
-- os GRANTs sobrevivem (ao contrário de 20260917100000, que precisou reemiti-los).
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

  -- Já aplicado (reexecução da migration): nada a fazer.
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
  'como ja acontecia com as faltas de paciente e de terapeuta. Devolve as '
  'observacoes escritas por gente: motivo_falta, justificativa_falta e os quatro '
  'campos de sessao adiantada, ao lado dos metadados da reclassificacao.';

-- ---------------------------------------------------------------------------
-- 2. get_faltas_auditoria_assim — o canal por onde ela volta
-- ---------------------------------------------------------------------------
-- Aqui o corpo é curto e o predicado é um só, então vale a mesma técnica pela
-- consistência, mas com margem menor de erro. `tipo_falta` já sai na projeção
-- (20260916130100:491), então o frontend recebe o que precisa para separar as
-- três espécies sem coluna nova.

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
  'Cartoes de falta da Conferencia. Desde 20260917110000 inclui tipo_falta '
  '''unidade_fechada'' (a clinica nao abriu) alem de paciente e terapeuta -- as '
  'tres saem de get_auditoria_assim_periodo e voltam por aqui. NAO confundir com '
  'assiduidade: contar_faltas_do_paciente segue contando so ''paciente''.';

-- ---------------------------------------------------------------------------
-- 3. O resumo diario (cron) — o mesmo `else` de dois ramos
-- ---------------------------------------------------------------------------
-- `refresh_auditoria_assim_resumo` sintetiza a situacao da falta com o MESMO
-- CASE de duas pernas que o frontend tinha (20260824050000:177-178):
--
--     CASE WHEN tipo_falta ILIKE '%terapeuta%' THEN 'FALTA_TERAPEUTA'
--          ELSE 'FALTA' END
--
-- Com a etapa 2 acima, `get_faltas_auditoria_assim` passa a devolver tambem as
-- linhas de unidade — e esse ELSE as carimbaria 'FALTA', ou seja, feriado
-- contado como falta DO PACIENTE na visao gerencial da gestora. Um ELSE que
-- significa "o outro" nao sobrevive a um terceiro caso; aqui ele vira EXATO.
--
-- Sem esta etapa o conserto ficaria pela metade: a tela diaria acertaria e o
-- grafico do periodo mentiria, que e exatamente a divergencia entre duas pontas
-- que kpisAuditoria.ts existe para impedir.

DO $migr$
DECLARE
  v_def text;
  -- Casa só o FIM do CASE, não a linha inteira: a quebra de linha e a indentação
  -- entre `ILIKE '%terapeuta%'` e `THEN` são formatação, e formatação é o que o
  -- pg_get_functiondef pode devolver diferente do arquivo. Este fragmento é
  -- único na função e não depende de nenhum espaço em branco entre as pernas.
  v_old text := 'THEN ''FALTA_TERAPEUTA'' ELSE ''FALTA'' END';
  v_new text := 'THEN ''FALTA_TERAPEUTA'' '
             || 'WHEN f.tipo_falta ILIKE ''%unidade%'' THEN ''UNIDADE_FECHADA'' '
             || 'ELSE ''FALTA'' END';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'refresh_auditoria_assim_resumo';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'refresh_auditoria_assim_resumo não existe';
  END IF;

  IF v_def LIKE '%UNIDADE_FECHADA%' THEN
    RAISE NOTICE 'resumo diário já reconhece unidade_fechada';
    RETURN;
  END IF;

  IF position(v_old in v_def) = 0 THEN
    RAISE EXCEPTION
      'CASE de tipo_falta não encontrado em refresh_auditoria_assim_resumo (a formatação pode ter mudado); extraia com pg_get_functiondef e reveja à mão.';
  END IF;

  -- Esta é a única das três que é SECURITY DEFINER e carrega proconfig
  -- (`search_path` e `statement_timeout = '20min'`). pg_get_functiondef emite os
  -- dois QUANDO eles estão no catálogo — mas se tiverem sido postos por ALTER
  -- FUNCTION depois, some tudo em silêncio e o cron volta ao timeout padrão: o
  -- modo de falha do incidente do pool (24/08). Ver
  -- reference_create_or_replace_perde_proconfig. Conferido ANTES de executar,
  -- para abortar em vez de degradar.
  IF v_def NOT LIKE '%statement_timeout%' OR v_def NOT LIKE '%search_path%' THEN
    RAISE EXCEPTION
      'a definição extraída de refresh_auditoria_assim_resumo perdeu search_path/statement_timeout; recriar por aqui degradaria o cron. Reaplique-os com ALTER FUNCTION e rode de novo.';
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
  RAISE NOTICE 'resumo diário: unidade_fechada deixa de ser contada como falta do paciente';
END
$migr$;

-- O resumo JÁ GRAVADO continua com o carimbo antigo: o cron reescreve o dia a
-- cada rodada, mas dias fechados do passado (07/09) só se corrigem reprocessando.
-- Não é feito aqui de propósito — 20260824050000 documenta que o reprocesso é
-- caro e deliberado. Para refazer um dia:
--     select public.refresh_auditoria_assim_resumo('2026-09-07'::date, '2026-09-07'::date);
