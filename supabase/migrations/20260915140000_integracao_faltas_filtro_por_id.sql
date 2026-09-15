-- Consulta pontual por id: `p_agendamento_ids` e `p_paciente_ids`.
--
-- POR QUE
-- Ate aqui o parceiro so tinha o cursor incremental — otimo para "me mande o
-- que mudou", inutil para "esse agendamento faltou?". Sem filtro, responder a
-- segunda pergunta obriga a varrer a carga inteira e procurar do lado de la.
--
-- SEMANTICA: O FILTRO IGNORA O CURSOR
-- Quando qualquer um dos dois arrays vem preenchido, `p_desde`/`p_desde_id` sao
-- DESCARTADOS e a funcao devolve o estado atual daqueles ids, sempre.
--
-- Isso e deliberado. Compor filtro com cursor produz uma armadilha silenciosa:
-- perguntar "o agendamento X faltou?" com um cursor antigo no bolso devolveria
-- `[]` quando X existe mas nao mudou desde o cursor — e vazio, ali, e
-- indistinguivel de "nao faltou". O parceiro concluiria o oposto do verdadeiro.
-- Com o filtro ignorando o cursor, `[]` tem um significado so: nao ha falta
-- para aquele id dentro da data de corte.
--
-- Quem quer sincronizar continua usando o cursor sem passar id nenhum; os dois
-- modos nao se misturam, e e por isso que nenhum dos dois mente.
--
-- OS DOIS FILTROS SAO "E", NAO "OU"
-- Passar os dois juntos restringe (linhas daqueles agendamentos QUE TAMBEM sao
-- daqueles pacientes). E o que `AND` faz e o que a leitura natural espera.
--
-- TETO DE 200 IDS
-- Array maior e recusado com 22023 em vez de truncado em silencio — truncar
-- devolveria uma resposta parcial que o chamador leria como completa, que e o
-- mesmo genero de defeito que o cursor composto corrigiu. 200 cabe folgado num
-- `= ANY` com index scan e limita o custo de uma chamada unica.
--
-- O `p_limite` continua valendo: a resposta e ordenada e paginavel pelos mesmos
-- campos, entao um paciente com mais faltas que o limite ainda pagina pelo
-- cursor — mas ai o chamador precisa repetir os ids junto, ja que o filtro tem
-- precedencia. Com 200 agendamentos o teto de 1000 linhas nao e alcancavel na
-- pratica (cada agendamento e uma linha so); por paciente, e.
--
-- SEM INDICE NOVO, DE PROPOSITO
-- O indice existente (fila_autorizacoes_integracao_faltas_idx) e ordenado por
-- (atualizado_em, tita_agendamento_id) e serve ao cursor, nao ao filtro por id.
-- Medido em producao nesta data: a view tem 1.348 linhas no recorte de
-- 2026-09-01 e 8.121 no universo inteiro. Varrer isso custa milissegundos, e um
-- indice a mais cobra escrita em `fila_autorizacoes`, que e tabela quente num
-- banco com aperto de Disk IO conhecido. Se a view passar de ~100k linhas, ai
-- sim vale um indice parcial por tita_agendamento_id e outro por paciente_id.
--
-- DROP antes: CREATE OR REPLACE nao altera a assinatura.

DROP FUNCTION IF EXISTS public.integracao_faltas(text, timestamptz, bigint, integer);

CREATE FUNCTION public.integracao_faltas(
  p_token           text,
  p_desde           timestamptz DEFAULT NULL,
  p_desde_id        bigint DEFAULT NULL,
  p_limite          integer DEFAULT 500,
  p_agendamento_ids bigint[] DEFAULT NULL,
  p_paciente_ids    bigint[] DEFAULT NULL
)
RETURNS TABLE (
  tita_agendamento_id  bigint,
  paciente_id          bigint,
  profissional_id      bigint,
  data_atendimento     date,
  horario              time without time zone,
  terapia_nome         text,
  tipo_falta           text,
  codigo_justificativa smallint,
  justificativa        text,
  ativa                boolean,
  status               text,
  atualizado_em        timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token  public.integracao_tokens := public.integracao_autenticar(p_token, 'faltas');
  v_limite integer := least(greatest(coalesce(p_limite, 500), 1), 1000);
  -- Array vazio (`?agendamento_id=` sem valor) nao pode virar "filtre por nada
  -- e devolva zero linhas": isso seria uma resposta vazia por acidente de
  -- digitacao. `nullif` o degrada para "sem filtro", que e o comportamento
  -- anterior e visivel.
  v_agend  bigint[] := nullif(p_agendamento_ids, '{}');
  v_pac    bigint[] := nullif(p_paciente_ids, '{}');
  v_por_id boolean  := v_agend IS NOT NULL OR v_pac IS NOT NULL;
BEGIN
  IF coalesce(array_length(v_agend, 1), 0) > 200
     OR coalesce(array_length(v_pac, 1), 0) > 200 THEN
    RAISE EXCEPTION 'no maximo 200 ids por chamada'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
    SELECT
      v.tita_agendamento_id, v.paciente_id, v.profissional_id,
      v.data_atendimento, v.horario, v.terapia_nome,
      v.tipo_falta, v.codigo_justificativa, v.justificativa,
      v.ativa, v.status, v.atualizado_em
    FROM public.vw_integracao_faltas v
   WHERE v.data_atendimento >= v_token.data_corte
     AND (v_agend IS NULL OR v.tita_agendamento_id = ANY (v_agend))
     AND (v_pac   IS NULL OR v.paciente_id         = ANY (v_pac))
     AND (
       -- O cursor so entra quando NAO ha filtro por id. Ver o cabecalho.
       v_por_id
       OR p_desde IS NULL
       -- Cursor composto. Sem isto, um bloco de linhas com `atualizado_em`
       -- identico maior que `p_limite` trava a varredura para sempre.
       OR (v.atualizado_em, v.tita_agendamento_id) > (p_desde, coalesce(p_desde_id, -1))
     )
   ORDER BY v.atualizado_em, v.tita_agendamento_id
   LIMIT v_limite;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  public.integracao_faltas(text, timestamptz, bigint, integer, bigint[], bigint[])
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION
  public.integracao_faltas(text, timestamptz, bigint, integer, bigint[], bigint[]) IS
  'Faltas para parceiro externo. Chave: tita_agendamento_id (o `id` do TiTa). '
  'Dois modos: cursor composto (p_desde, p_desde_id) para sincronizar, ou '
  'p_agendamento_ids/p_paciente_ids (max 200) para consulta pontual — o filtro '
  'por id IGNORA o cursor de proposito, para que [] signifique sempre "nao ha '
  'falta" e nunca "nao mudou". Recorte por integracao_tokens.data_corte.';
