-- ============================================================================
-- Grade da TiTa: guardar a descrição da evolução
--
-- A API csv_grade_profissionais passou a devolver uma 43ª coluna, "Descrição da
-- Evolução" — o texto que o profissional escreve sobre a sessão depois de
-- atendê-la. Até agora o sync a descartava em silêncio: o parser procura as
-- colunas pelo NOME do cabeçalho, e o que não está na lista simplesmente não é
-- lido. Nenhum erro, nenhum alerta; a informação chegava e era jogada fora.
--
-- Medido contra a API em 2026-09-09, janela 20–21/08 (1.547 linhas): 43 colunas,
-- a nova em último lugar, 704 linhas preenchidas — exatamente as mesmas 704 que
-- têm "Vínculo da Evolução". Texto de 27 a 2.862 caracteres, daí `text` e não
-- varchar. Nenhuma quebra de linha embutida nas 704 amostras, o que é o que
-- permite manter o parser por linha do sync intacto.
--
-- ─── Por que é coluna de EXECUÇÃO, e o que isso obriga ─────────────────────
--
-- A evolução é escrita bem depois da sessão. Isso a coloca junto de
-- status_execucao, possui_tratativa e tratativa_* — fatos aprendidos depois,
-- não identidade da sessão. Três consequências, todas obrigatórias:
--
--   1. Só o modo "execucao" do sync-grade-csv a captura (janela de 45 dias para
--      trás, cron sync-grade-execucao-daily). O modo "grade" tem piso em hoje, e
--      sessão futura ainda não tem evolução.
--
--   2. NÃO entra em CAMPOS_CONTEUDO na Edge Function. Se entrasse, cada evolução
--      escrita inativaria a sessão como 'alterado' e criaria uma versão
--      duplicada da linha no histórico.
--
--   3. PRECISA entrar em v_mutaveis do trg_congelar_grade_passada. É justamente
--      a sessão de data passada que recebe a evolução; sem este passo o trigger
--      recusaria o UPDATE com exceção, em 100% dos casos reais.
--
-- Mesma forma da 20260807120100, que adicionou tratativas/tratativas_distintas.
--
-- ─── O que este arquivo deliberadamente NÃO faz ────────────────────────────
--
-- Não projeta a coluna em vw_grade_base. É texto clínico sobre o paciente, e a
-- view é legível por qualquer `authenticated`; fica só na tabela, como já
-- acontece com profissional_cpf. Quem precisar lê a tabela direto. É reversível:
-- dá para projetar depois, quando houver uma tela que justifique.
--
-- Não faz backfill. A janela de 45 dias preenche o recente e tudo daqui em
-- diante; sessão mais antiga fica NULL.
--
-- Depends on: 20260807120100_grade_contagem_de_tratativas.sql
-- ============================================================================

-- ─── A coluna ───────────────────────────────────────────────────────────────

ALTER TABLE public.csv_grades_profissionais
  ADD COLUMN IF NOT EXISTS descricao_evolucao text;

COMMENT ON COLUMN public.csv_grades_profissionais.descricao_evolucao IS
  'Texto da evolução escrita pelo profissional após a sessão. Origem: coluna "Descrição da Evolução" (43ª) da API csv_grade_profissionais da TiTa. Preenchida SÓ pelo modo "execucao" do sync-grade-csv, porque a evolução é escrita depois da sessão — no modo "grade" a sessão ainda é futura e não tem evolução. NULL = ainda não evoluída ou fora da janela de 45 dias do sync. Dado clínico: de propósito NÃO é projetada em vw_grade_base.';

-- ─── Trigger: mais um fato de execução ──────────────────────────────────────
--
-- Reproduz a versão vigente (20260807120100) acrescentando 'descricao_evolucao'
-- a v_mutaveis. O trigger não precisa ser recriado: aponta para a função pelo
-- nome, e CREATE OR REPLACE preserva o vínculo.

CREATE OR REPLACE FUNCTION public.fn_bloquear_alteracao_grade_passada()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  v_mutaveis constant text[] := ARRAY[
    'status_execucao',
    'justificativa',
    'possui_tratativa',
    'tratativa_profissional_id',
    'tratativa_profissional_nome',
    'tratativa_criada_em',
    'tratativa_origem',
    'tratativas',
    'tratativas_distintas',
    'evolucao_vinculo',
    'descricao_evolucao',
    'criado_em_tita',
    'excluido_em_tita',
    'visto_em',
    'inativado_em',
    'ausencia_confirmada_em',
    'updated_at'
  ];

  -- Liberadas SÓ quando a linha está sendo reativada. Fora desse caso continuam
  -- congeladas: é o que impede a baixa retroativa.
  v_da_reativacao constant text[] := ARRAY['ativo', 'motivo_inativacao'];

  v_permitidas text[];
  v_antes jsonb;
  v_depois jsonb;
  v_alteradas text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.data < v_hoje THEN
      RAISE EXCEPTION
        'csv_grades_profissionais: DELETE bloqueado em data passada (% < %). O histórico é imutável; para retirar uma sessão da grade use ativo = false.',
        OLD.data, v_hoje;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.data >= v_hoje AND NEW.data >= v_hoje THEN
    RETURN NEW;
  END IF;

  v_permitidas := v_mutaveis;
  IF OLD.ativo IS NOT TRUE AND NEW.ativo IS TRUE THEN
    v_permitidas := v_mutaveis || v_da_reativacao;
  END IF;

  v_antes  := to_jsonb(OLD) - v_permitidas;
  v_depois := to_jsonb(NEW) - v_permitidas;

  IF v_antes IS DISTINCT FROM v_depois THEN
    SELECT string_agg(o.key, ', ' ORDER BY o.key)
      INTO v_alteradas
      FROM jsonb_each(v_antes) o
     WHERE o.value IS DISTINCT FROM v_depois -> o.key;

    RAISE EXCEPTION
      'csv_grades_profissionais: UPDATE bloqueado em data passada (% -> %, hoje %). A identidade da sessão é imutável; só colunas de execução podem avançar (e ativo apenas de false para true). Colunas recusadas: %.',
      OLD.data, NEW.data, v_hoje, COALESCE(v_alteradas, '(estrutura)');
  END IF;

  RETURN NEW;
END;
$$;

-- ─── RPC de aplicação em lote ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_aplicar_execucao_grade(p_linhas jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_afetadas integer;
BEGIN
  IF p_linhas IS NULL OR jsonb_array_length(p_linhas) = 0 THEN
    RETURN 0;
  END IF;

  UPDATE public.csv_grades_profissionais g
     SET status_execucao             = e.status_execucao,
         justificativa               = e.justificativa,
         possui_tratativa            = e.possui_tratativa,
         tratativa_profissional_id   = e.tratativa_profissional_id,
         tratativa_profissional_nome = e.tratativa_profissional_nome,
         tratativa_criada_em         = e.tratativa_criada_em,
         tratativa_origem            = e.tratativa_origem,
         tratativas                  = e.tratativas,
         tratativas_distintas        = e.tratativas_distintas,
         evolucao_vinculo            = e.evolucao_vinculo,
         descricao_evolucao          = e.descricao_evolucao,
         criado_em_tita              = e.criado_em_tita,
         excluido_em_tita            = e.excluido_em_tita,
         visto_em                    = now()
    FROM jsonb_to_recordset(p_linhas) AS e(
           id                          uuid,
           status_execucao             text,
           justificativa               text,
           possui_tratativa            boolean,
           tratativa_profissional_id   bigint,
           tratativa_profissional_nome text,
           tratativa_criada_em         timestamptz,
           tratativa_origem            text,
           tratativas                  smallint,
           tratativas_distintas        smallint,
           evolucao_vinculo            text,
           descricao_evolucao          text,
           criado_em_tita              timestamptz,
           excluido_em_tita            timestamptz
         )
   WHERE g.id = e.id;

  GET DIAGNOSTICS v_afetadas = ROW_COUNT;
  RETURN v_afetadas;
END;
$$;

COMMENT ON FUNCTION public.fn_aplicar_execucao_grade(jsonb) IS
  'Aplica em lote as colunas de execução de csv_grades_profissionais (status_execucao, justificativa, tratativa_*, tratativas, tratativas_distintas, evolucao_vinculo, descricao_evolucao, criado_em_tita, excluido_em_tita), casando por id. Chamada pela Edge Function sync-grade-csv em modo "execucao". Não insere, não inativa e não toca em coluna de identidade — o trigger trg_congelar_grade_passada recusaria.';

REVOKE ALL ON FUNCTION public.fn_aplicar_execucao_grade(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_aplicar_execucao_grade(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_aplicar_execucao_grade(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
