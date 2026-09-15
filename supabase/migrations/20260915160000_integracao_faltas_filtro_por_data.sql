-- Filtro por `data_atendimento`: `p_data_de` e `p_data_ate`.
--
-- POR QUE
-- Os ids respondem "esse agendamento faltou?". Nenhum dos dois responde
-- "quais faltas houve em setembro?", que e a pergunta de quem reconcilia uma
-- competencia fechada. Sem isso, o parceiro precisaria varrer a carga inteira.
--
-- O CAMPO E `data_atendimento`, NAO `atualizado_em`
-- E o dia em que a sessao aconteceria — o que "faltas de setembro" significa
-- em portugues, e o eixo que fecha faturamento. `atualizado_em` (quando a linha
-- mudou no Pulsar) ja e o eixo do cursor `p_desde`; filtrar por ele aqui seria
-- duplicar o que existe e confundir os dois conceitos.
--
-- A diferenca e visivel: uma falta de 01/09 corrigida hoje tem
-- data_atendimento = 01/09 e atualizado_em = hoje. Ela entra em
-- `data_de=2026-09-01&data_ate=2026-09-30` e NAO entra num `desde` de hoje-1h
-- se nao tiver mudado de novo.
--
-- SEMANTICA: IGNORA O CURSOR, COMO O FILTRO POR ID (20260915140000)
-- Regra unica do endpoint: qualquer filtro (id ou data) desliga o cursor e a
-- resposta passa a ser "o estado atual do que voce pediu". Duas regras
-- diferentes — id ignorando e data compondo — seria o tipo de assimetria que o
-- chamador descobre tarde, recebendo vazio sem entender por que.
--
-- INTERVALO FECHADO NOS DOIS LADOS
-- `data_de <= data_atendimento <= data_ate`. Passar so um dos dois deixa o
-- outro lado aberto; passar os dois iguais e o "dia especifico"
-- (`?data_de=2026-09-07&data_ate=2026-09-07`).
--
-- A DATA DE CORTE DO TOKEN CONTINUA MANDANDO
-- `data_de` anterior ao corte nao libera historico: o `>= v_token.data_corte`
-- segue no WHERE e e o mais restritivo dos dois. Pedir julho com corte em
-- setembro devolve vazio, nao erro — o recorte e do token, e muda por UPDATE
-- (bloco 4 de integracao_faltas_provisionar.sql), nunca por query string.
--
-- INTERVALO INVERTIDO E ERRO, NAO VAZIO
-- `data_de > data_ate` levanta 22023. Devolver `[]` calado faria o chamador ler
-- "nao houve falta no periodo" onde a verdade e "voce trocou os parametros" —
-- o mesmo genero de mentira silenciosa que o resto deste endpoint evita.
--
-- SEM INDICE NOVO: mesma medicao da 20260915140000 (1.348 linhas no recorte,
-- 8.121 no universo). Reavaliar acima de ~100k.
--
-- DROP antes: CREATE OR REPLACE nao altera a assinatura.

DROP FUNCTION IF EXISTS public.integracao_faltas(
  text, timestamptz, bigint, integer, bigint[], bigint[]);

CREATE FUNCTION public.integracao_faltas(
  p_token           text,
  p_desde           timestamptz DEFAULT NULL,
  p_desde_id        bigint DEFAULT NULL,
  p_limite          integer DEFAULT 500,
  p_agendamento_ids bigint[] DEFAULT NULL,
  p_paciente_ids    bigint[] DEFAULT NULL,
  p_data_de         date DEFAULT NULL,
  p_data_ate        date DEFAULT NULL
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
  -- Array vazio degradado para "sem filtro": ver 20260915140000.
  v_agend  bigint[] := nullif(p_agendamento_ids, '{}');
  v_pac    bigint[] := nullif(p_paciente_ids, '{}');
  v_por_id boolean  := v_agend IS NOT NULL
                       OR v_pac IS NOT NULL
                       OR p_data_de IS NOT NULL
                       OR p_data_ate IS NOT NULL;
BEGIN
  IF coalesce(array_length(v_agend, 1), 0) > 200
     OR coalesce(array_length(v_pac, 1), 0) > 200 THEN
    RAISE EXCEPTION 'no maximo 200 ids por chamada'
      USING ERRCODE = '22023';
  END IF;

  IF p_data_de IS NOT NULL AND p_data_ate IS NOT NULL
     AND p_data_de > p_data_ate THEN
    RAISE EXCEPTION 'data_de (%) e posterior a data_ate (%)', p_data_de, p_data_ate
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
     AND (p_data_de  IS NULL OR v.data_atendimento >= p_data_de)
     AND (p_data_ate IS NULL OR v.data_atendimento <= p_data_ate)
     AND (
       -- O cursor so entra quando NAO ha filtro algum. Ver o cabecalho.
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

REVOKE EXECUTE ON FUNCTION public.integracao_faltas(
  text, timestamptz, bigint, integer, bigint[], bigint[], date, date)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.integracao_faltas(
  text, timestamptz, bigint, integer, bigint[], bigint[], date, date) IS
  'Faltas para parceiro externo. Chave: tita_agendamento_id (o `id` do TiTa). '
  'Dois modos: cursor composto (p_desde, p_desde_id) para sincronizar, ou '
  'filtro para consulta pontual — p_agendamento_ids/p_paciente_ids (max 200) e '
  'p_data_de/p_data_ate sobre data_atendimento (intervalo fechado). QUALQUER '
  'filtro IGNORA o cursor de proposito, para que [] signifique sempre "nao ha '
  'falta" e nunca "nao mudou". Recorte por integracao_tokens.data_corte, que e '
  'sempre o mais restritivo e nao e afrouxavel por p_data_de.';
