-- Correções de segurança do endpoint de integração, achadas em auditoria
-- adversarial antes de entregar o token ao parceiro.
--
-- Três problemas, em ordem de gravidade:
--
-- 1. DoS SEM AUTENTICAÇÃO (o grave). A rota aplica `checkRateLimit` chaveado
--    pelo TOKEN DO REQUEST, ANTES de autenticar. O store é um Map de processo e
--    `cleanupRateLimitStore()` nunca é chamado em lugar nenhum do repo — então
--    cada token diferente insere uma entrada que nunca sai. Um atacante SEM
--    TOKEN VÁLIDO varia o token a cada request e cresce o heap indefinidamente.
--    Medido: 292 bytes por request; ~1,8 milhão de requests para 512 MB, ou
--    ~31 min de flood a 1k req/s. (Este servidor já morre de OOM em build.)
--
--    A ironia é que a justificativa escrita na rota para NÃO chavear por IP era
--    exatamente "o Map cresce sem limite" — e a chave adotada é mais livre que
--    o IP.
--
--    Correção: o rate limit passa a rodar DEPOIS da autenticação, chaveado pelo
--    `id` do token. A cardinalidade deixa de ser "o que o atacante digita" e
--    passa a ser "quantos parceiros existem". Fecha o vetor por construção, não
--    por limpeza periódica. Para isso a RPC precisa DEVOLVER quem autenticou —
--    é o que `parceiro_id` abaixo faz.
--
-- 2. ESCRITA NÃO AUTENTICADA POR REQUEST. `ultimo_uso_em` era atualizado a cada
--    chamada: 60+ UPDATEs/min por parceiro na MESMA linha (lock serializado),
--    num banco que esta própria migration descreve como tendo aperto de Disk IO.
--    Esta migration rejeitou uma tabela de tentativas falhas por ser "escrita
--    não autenticada e ilimitada" e então aceitou esta. Agora só grava se
--    passaram 5 minutos — mantém a observabilidade e mata o custo.
--
-- 3. TOKEN SEM EXPIRAÇÃO. Havia `revogado_em`, mas nenhum prazo: um token
--    vazado valia para sempre até alguém notar. Ganha `expira_em`, checado no
--    autenticador.

-- ---------------------------------------------------------------------------
-- 1. Expiração de token
-- ---------------------------------------------------------------------------
-- NULL = não expira (comportamento atual preservado para o token já emitido).
-- Preencher em tokens novos é a política recomendada.

ALTER TABLE public.integracao_tokens
  ADD COLUMN IF NOT EXISTS expira_em timestamptz;

COMMENT ON COLUMN public.integracao_tokens.expira_em IS
  'Prazo do token. NULL = sem prazo. Checado por integracao_autenticar: expirado '
  'recebe a mesma recusa de um token inexistente.';

-- ---------------------------------------------------------------------------
-- 2. Autenticador: honra a expiração e sanitiza o log
-- ---------------------------------------------------------------------------
-- O `RAISE WARNING` gravava `x-forwarded-for` CRU no log do Postgres. É header
-- não confiável: um `\n` forjado injeta linhas falsas no log de quem o parseia,
-- e o valor inteiro falsifica a trilha de auditoria. Agora só passa o que casa
-- com formato de IP, truncado.

CREATE OR REPLACE FUNCTION public.integracao_autenticar(p_token text, p_escopo text)
RETURNS public.integracao_tokens
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.integracao_tokens;
  v_ip  text;
BEGIN
  IF p_token IS NULL OR length(p_token) < 32 THEN
    RAISE EXCEPTION 'token invalido' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_row
    FROM public.integracao_tokens
   WHERE token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
     AND escopo = p_escopo
     AND revogado_em IS NULL
     AND (expira_em IS NULL OR expira_em > now());

  IF v_row.id IS NULL THEN
    -- Mensagem idêntica para inexistente, revogado, expirado ou de outro
    -- escopo: não entregar ao chamador a informação de "quase acertou".
    --
    -- Só o que se parece com um IP entra no log. `substring` com regex de IP
    -- descarta \n, \r e qualquer texto forjado no header.
    v_ip := substring(
      coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', '')
      from '^[0-9a-fA-F:.]{1,45}'
    );
    RAISE WARNING 'integracao: autenticacao recusada (escopo=%, ip=%)',
      p_escopo, coalesce(v_ip, '?');
    RAISE EXCEPTION 'token invalido' USING ERRCODE = '28000';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.integracao_autenticar(text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Identificação do parceiro, sem ler dado nenhum
-- ---------------------------------------------------------------------------
-- A rota precisa saber QUEM está chamando antes de decidir se aplica o rate
-- limit — e precisa saber disso mesmo quando a consulta devolveria zero linhas
-- (um cursor no futuro devolve vazio sempre, e sem isto seria um caminho livre
-- de limite).
--
-- Devolve só o id e a data de corte: nada de `token_hash`, nada de outro
-- parceiro. É o id do próprio chamador, que não é segredo para ele.

CREATE OR REPLACE FUNCTION public.integracao_identificar(p_token text)
RETURNS TABLE (parceiro_id bigint, data_corte date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token public.integracao_tokens := public.integracao_autenticar(p_token, 'faltas');
BEGIN
  -- Carimba aqui (e não na consulta): este é o ponto por onde TODA chamada
  -- passa, inclusive a que será recusada pelo rate limit adiante.
  IF v_token.ultimo_uso_em IS NULL
     OR v_token.ultimo_uso_em < now() - interval '5 minutes' THEN
    UPDATE public.integracao_tokens
       SET ultimo_uso_em = now()
     WHERE id = v_token.id;
  END IF;

  RETURN QUERY SELECT v_token.id, v_token.data_corte;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.integracao_identificar(text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.integracao_identificar(text) IS
  'Autentica o token e devolve so o id do parceiro + data_corte. Existe para a rota '
  'aplicar rate limit por parceiro ANTES de consultar, inclusive quando a consulta '
  'devolveria zero linhas.';

-- ---------------------------------------------------------------------------
-- 4. A consulta, sem a escrita por request
-- ---------------------------------------------------------------------------
-- DROP antes: CREATE OR REPLACE não altera RETURNS TABLE.

DROP FUNCTION IF EXISTS public.integracao_faltas(text, timestamptz, bigint, integer);

CREATE FUNCTION public.integracao_faltas(
  p_token    text,
  p_desde    timestamptz DEFAULT NULL,
  p_desde_id bigint DEFAULT NULL,
  p_limite   integer DEFAULT 500
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
BEGIN
  -- Sem UPDATE aqui: `ultimo_uso_em` é carimbado por `integracao_identificar`,
  -- por onde toda chamada passa antes. Antes esta função escrevia a cada
  -- request — 60 req/min contendendo pela MESMA linha, gerando row version +
  -- WAL por chamada, num banco com aperto de Disk IO.
  RETURN QUERY
    SELECT
      v.tita_agendamento_id, v.paciente_id, v.profissional_id,
      v.data_atendimento, v.horario, v.terapia_nome,
      v.tipo_falta, v.codigo_justificativa, v.justificativa,
      v.ativa, v.status, v.atualizado_em
    FROM public.vw_integracao_faltas v
   WHERE v.data_atendimento >= v_token.data_corte
     AND (
       p_desde IS NULL
       -- Cursor composto. Sem isto, um bloco de linhas com `atualizado_em`
       -- idêntico maior que `p_limite` trava a varredura para sempre.
       OR (v.atualizado_em, v.tita_agendamento_id) > (p_desde, coalesce(p_desde_id, -1))
     )
   ORDER BY v.atualizado_em, v.tita_agendamento_id
   LIMIT v_limite;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.integracao_faltas(text, timestamptz, bigint, integer)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.integracao_faltas(text, timestamptz, bigint, integer) IS
  'Faltas para parceiro externo. Chave: tita_agendamento_id (o `id` do TiTa). '
  'Cursor composto (p_desde, p_desde_id). Recorte por integracao_tokens.data_corte. '
  'Devolve parceiro_id para a rota aplicar rate limit APOS autenticar.';
