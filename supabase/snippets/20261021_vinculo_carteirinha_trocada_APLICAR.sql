-- APLICAR 20261021120000_vinculo_aceita_carteirinha_trocada em produção (rodar o _ENSAIO antes).
-- Rodar: supabase db query --linked -f supabase/snippets/20261021_vinculo_carteirinha_trocada_APLICAR.sql -o json

begin;

-- =============================================================================
-- Vínculo entre carteirinhas diferentes do MESMO paciente — só com comentário.
--
-- Caso: Miguel Medeiros Jardim Leone, sex 16/10 15:40 (Psicologia ABA). O
-- agendamento do TiTa (3712869, criado em 29/09) ainda levava a carteirinha
-- antiga (994293.0560586.03); a ASSIM recusou ("Os dados inseridos não estão
-- corretos!") e a recepção tirou a guia 263281 às 15:57 com a carteirinha certa
-- (000000.0768094.00). A sessão nem aparecia como candidata: as duas funções
-- casavam sessão e guia SÓ por empresa.matrícula.dep. Justo a refação de uma
-- recusa por carteirinha ficava impossível de vincular.
--
-- Agora, quando a carteirinha diverge mas `autorizacoes_assim.paciente_id` é o
-- paciente da sessão:
--   - get_candidatas_vinculo oferece a sessão;
--   - vincular_autorizacao aceita, desde que haja observação (mesmo padrão de
--     TUSS diferente e sessão posterior). O comentário é a trava contra o
--     paciente_id antigo que misturava pessoas — desde 20260925120100 ele fica
--     NULL quando é ambíguo, e com NULL nada muda.
-- Nenhuma outra regra muda.
--
-- Edição por regex sobre pg_get_functiondef (corpo pode ter \r\n), contagem
-- exata, idempotente pela marca 20261021120000.
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
  IF position('20261021120000' in v_def) > 0 THEN
    RAISE NOTICE '% já aceita carteirinha trocada', p_nome;
    RETURN;
  END IF;

  FOR i IN 1 .. array_length(p_trocas, 1) LOOP
    v_n := (SELECT count(*) FROM regexp_matches(v_def, p_trocas[i][1], 'g'));
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: troca % esperava 1 ocorrência, achei %. Reveja à mão.',
        p_nome, i, v_n;
    END IF;
    v_def := regexp_replace(v_def, p_trocas[i][1], p_trocas[i][2]);
  END LOOP;

  EXECUTE v_def;
  RAISE NOTICE '%: carteirinha trocada do mesmo paciente', p_nome;
END
$f$;

-- 1. get_candidatas_vinculo: a sessão entra pela carteirinha OU pelo paciente
--    da guia. A ordem e a elegibilidade não mudam.
SELECT pg_temp.trocar(
  'get_candidatas_vinculo',
  'p_guia text, p_janela_dias integer',
  ARRAY[
    ARRAY[
      'where a\.empresa\s+= v_empresa\s+and a\.matricula\s+= v_matric\s+and a\.dep\s+= v_dep',
      'where /* 20261021120000 */ ((a.empresa = v_empresa and a.matricula = v_matric and a.dep = v_dep)'
      || ' or (v_g.paciente_id is not null and a.paciente_id = v_g.paciente_id::text))']
  ]
);

-- 2. vincular_autorizacao: lê o paciente da guia; "Beneficiário divergente" só
--    quando o paciente também diverge (ou é desconhecido); com o mesmo paciente,
--    exige observação.
SELECT pg_temp.trocar(
  'vincular_autorizacao',
  'p_guia text, p_bloco_id text, p_fila_id uuid, p_observacao text, p_janela_dias integer',
  ARRAY[
    ARRAY[
      'aa\.codigo_tuss, aa\.status\s+into v_g',
      'aa.codigo_tuss, aa.status, aa.paciente_id /* 20261021120000 */' || chr(10) || '    into v_g'],
    ARRAY[
      'or v_b\.dep\s+is distinct from split_part\(v_g\.matricula, ''\.'', 3\) then',
      'or v_b.dep       is distinct from split_part(v_g.matricula, ''.'', 3))'
      || ' and (v_g.paciente_id is null or v_g.paciente_id is distinct from v_pac) then'],
    ARRAY[
      'if v_b\.empresa\s+is distinct from split_part\(v_g\.matricula, ''\.'', 1\)',
      'if (v_b.empresa   is distinct from split_part(v_g.matricula, ''.'', 1)'],
    ARRAY[
      '-- 5\) mesmo TUSS',
      '-- 4b) carteirinha trocada, mesmo paciente: passa só com comentário.' || chr(10)
      || '  if (v_b.empresa   is distinct from split_part(v_g.matricula, ''.'', 1)' || chr(10)
      || '   or v_b.matricula is distinct from split_part(v_g.matricula, ''.'', 2)' || chr(10)
      || '   or v_b.dep       is distinct from split_part(v_g.matricula, ''.'', 3))' || chr(10)
      || '  and nullif(btrim(p_observacao), '''') is null then' || chr(10)
      || '    raise exception ''Comentário obrigatório: a guia % saiu com a carteirinha % e a sessão foi pedida com %.%.%. Escreva na observação por que esta guia cobre a sessão.'',' || chr(10)
      || '      p_guia, v_g.matricula, v_b.empresa, v_b.matricula, v_b.dep using errcode = ''22023'';' || chr(10)
      || '  end if;' || chr(10) || chr(10)
      || '  -- 5) mesmo TUSS']
  ]
);

insert into supabase_migrations.schema_migrations (version, name)
values ('20261021120000', 'vinculo_aceita_carteirinha_trocada')
on conflict (version) do nothing;

commit;

-- Conferência
select pg_get_functiondef('public.get_candidatas_vinculo(text,integer)'::regprocedure) like '%20261021120000%' as candidatas_ok,
       pg_get_functiondef('public.vincular_autorizacao(text,text,uuid,text,integer)'::regprocedure) like '%4b) carteirinha trocada%' as vincular_ok,
       exists (select 1 from public.get_candidatas_vinculo('263281', 7) c
                where c.bloco_id = '14278_2026-10-16_22070384_15:40:00' and c.elegivel) as miguel_1540_elegivel,
       exists (select 1 from supabase_migrations.schema_migrations where version = '20261021120000') as registrada;
