-- ============================================================================
-- APLICAR EM PRODUÇÃO — Descrição da Evolução na grade da TiTa
--
-- Empacota a migration 20260909160000_grade_descricao_da_evolucao.sql para ser
-- colada de uma vez no SQL Editor. Não é uma migration: o arquivo canônico vive
-- em supabase/migrations/ e este aqui é só o registro do que entrou em produção.
--
-- Contexto: a API csv_grade_profissionais passou a devolver uma 43ª coluna,
-- "Descrição da Evolução" — o texto que o profissional escreve depois de atender.
-- O sync a descartava em silêncio (o parser procura coluna por NOME; o que não
-- está na lista não é lido). Conferido contra a API em 2026-09-09, janela 20–21/08:
-- 43 colunas, a nova em último lugar, 704 de 1.547 linhas preenchidas — as mesmas
-- 704 que têm "Vínculo da Evolução".
--
-- Três blocos, todos obrigatórios:
--   1. a coluna;
--   2. 'descricao_evolucao' em v_mutaveis do trg_congelar_grade_passada — sem
--      isto o UPDATE é RECUSADO em toda sessão de data passada, que é justamente
--      a que recebe evolução: falharia em 100% dos casos reais;
--   3. a coluna no SET e no jsonb_to_recordset de fn_aplicar_execucao_grade.
--
-- ⚠ ORDEM: aplicar este SQL ANTES de `supabase functions deploy sync-grade-csv`.
--   Se a Edge Function subir primeiro, o modo "execucao" manda descricao_evolucao
--   para uma RPC que ainda não tem esse parâmetro e a rodada falha.
--
-- NÃO projeta a coluna em vw_grade_base de propósito: é texto clínico do paciente
-- e a view é legível por qualquer `authenticated`. Fica só na tabela, como o
-- profissional_cpf. NÃO faz backfill: a janela de 45 dias do modo "execucao"
-- preenche o recente e tudo daqui em diante.
--
-- Reexecutável: add column if not exists + create or replace nas duas funções.
-- ============================================================================

begin;

-- ─── 1. A coluna ────────────────────────────────────────────────────────────

alter table public.csv_grades_profissionais
  add column if not exists descricao_evolucao text;

comment on column public.csv_grades_profissionais.descricao_evolucao is
  'Texto da evolução escrita pelo profissional após a sessão. Origem: coluna "Descrição da Evolução" (43ª) da API csv_grade_profissionais da TiTa. Preenchida SÓ pelo modo "execucao" do sync-grade-csv, porque a evolução é escrita depois da sessão — no modo "grade" a sessão ainda é futura e não tem evolução. NULL = ainda não evoluída ou fora da janela de 45 dias do sync. Dado clínico: de propósito NÃO é projetada em vw_grade_base.';

-- ─── 2. Trigger: mais um fato de execução ───────────────────────────────────
--
-- Reproduz a versão vigente (20260807120100) acrescentando 'descricao_evolucao'
-- a v_mutaveis. O trigger não precisa ser recriado: aponta para a função pelo
-- nome, e create or replace preserva o vínculo.

create or replace function public.fn_bloquear_alteracao_grade_passada()
returns trigger
language plpgsql
as $$
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

-- ─── 3. RPC de aplicação em lote ────────────────────────────────────────────

create or replace function public.fn_aplicar_execucao_grade(p_linhas jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

comment on function public.fn_aplicar_execucao_grade(jsonb) is
  'Aplica em lote as colunas de execução de csv_grades_profissionais (status_execucao, justificativa, tratativa_*, tratativas, tratativas_distintas, evolucao_vinculo, descricao_evolucao, criado_em_tita, excluido_em_tita), casando por id. Chamada pela Edge Function sync-grade-csv em modo "execucao". Não insere, não inativa e não toca em coluna de identidade — o trigger trg_congelar_grade_passada recusaria.';

revoke all on function public.fn_aplicar_execucao_grade(jsonb) from public;
revoke all on function public.fn_aplicar_execucao_grade(jsonb) from anon, authenticated;
grant execute on function public.fn_aplicar_execucao_grade(jsonb) to service_role;

-- ─── Livro-caixa ────────────────────────────────────────────────────────────

insert into supabase_migrations.schema_migrations (version, name)
values ('20260909160000','grade_descricao_da_evolucao')
on conflict (version) do nothing;

commit;

notify pgrst, 'reload schema';

-- ============================================================================
-- CONFERÊNCIA — rodar DEPOIS do commit, fora da transação
-- ============================================================================
--
-- 1. A coluna existe e o livro-caixa registrou:
--
-- select
--   (select count(*) from information_schema.columns
--     where table_schema='public' and table_name='csv_grades_profissionais'
--       and column_name='descricao_evolucao')                        as tem_coluna,   -- 1
--   (select count(*) from supabase_migrations.schema_migrations
--     where version='20260909160000')                                as no_livro,     -- 1
--   (select count(*) from pg_get_functiondef(
--      'public.fn_bloquear_alteracao_grade_passada()'::regprocedure) f
--     where f like '%descricao_evolucao%')                           as trigger_ok,   -- 1
--   (select count(*) from pg_get_functiondef(
--      'public.fn_aplicar_execucao_grade(jsonb)'::regprocedure) f
--     where f like '%descricao_evolucao%')                           as rpc_ok;       -- 1
--
-- 2. O trigger aceita a coluna nova em data PASSADA. É a prova de que o bloco 2
--    era necessário — antes desta migration o mesmo UPDATE levantava exceção.
--    Escolhe uma linha passada, grava e desfaz na mesma transação:
--
-- begin;
--   update public.csv_grades_profissionais
--      set descricao_evolucao = '__teste__'
--    where id = (select id from public.csv_grades_profissionais
--                 where data < current_date and ativo limit 1);
-- rollback;   -- rollback de propósito: é só para ver se o trigger deixa passar
--
-- 3. DEPOIS do deploy da Edge Function e da primeira rodada do modo "execucao":
--
-- select count(*) filter (where descricao_evolucao is not null) as com_evolucao,
--        count(*) filter (where evolucao_vinculo  is not null) as com_vinculo,
--        count(*)                                              as total
--   from public.csv_grades_profissionais
--  where data between current_date - 45 and current_date and ativo;
--
--    com_evolucao deve ficar próximo de com_vinculo (na amostra da API foram
--    idênticos: 704/704). Rodar o sync DUAS vezes seguidas — a segunda deve
--    atualizar ~0 linhas; se reescrever tudo, mudouExecucao está acusando
--    diferença falsa e o custo de WAL que o desenho evita voltou.
-- ============================================================================
