-- Leitura de faltas por sistema parceiro: view protegida + token próprio.
--
-- CONTEXTO
-- Um sistema externo precisa lançar, do lado dele, as faltas que a recepção
-- registra aqui. A direção é PULL: o parceiro consulta; o Pulsar não conhece a
-- URL dele, não guarda fila de entrega e não fica refém da disponibilidade do
-- outro lado.
--
-- POR QUE VIEW **E** RPC, E NÃO SÓ A VIEW
-- No PostgREST quem autentica é a chave do header, e só existem `anon`,
-- `authenticated` e `service_role` — não há role de banco customizada neste
-- projeto, nem `db_pre_request`. `anon` é a chave pública do bundle do frontend
-- (revogá-la derruba o app inteiro) e `service_role` é a chave mestra. Nenhuma
-- serve para um terceiro. Então o acesso é por token próprio, validado dentro do
-- banco, e a view existe para FIXAR A PROJEÇÃO: mesmo que a RPC mude amanhã, o
-- parceiro nunca alcança CPF, carteirinha ou guia, que moram na mesma tabela.
--
-- POR QUE A CHAVE É `tita_agendamento_id`
-- É o `id` do agendamento na API do TiTa (sync_tita_agenda/index.ts:354 mapeia
-- `tita_agendamento_id: a.id`), então o parceiro já o possui. Medido em produção
-- em 2026-09-14: 8.036 faltas com o campo preenchido, 8.036 valores distintos —
-- nenhuma repetição. Ao contrário da guia da ASSIM (que recicla) e de
-- `terapia_id` (que agrupa nomes), identifica a sessão sem ambiguidade.

-- ---------------------------------------------------------------------------
-- 1. Tokens de integração
-- ---------------------------------------------------------------------------
-- Mesmo desenho de `public.maquinas`: só o sha256 do token é guardado, o valor
-- em claro existe uma única vez (no retorno do INSERT) e é entregue ao parceiro.

CREATE TABLE IF NOT EXISTS public.integracao_tokens (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parceiro          text NOT NULL,
  token_hash        text NOT NULL,
  escopo            text NOT NULL DEFAULT 'faltas',
  -- Recorte histórico, por parceiro. Faltas anteriores a esta data não saem.
  -- Existe porque a chave `tita_agendamento_id` só é confiável a partir de
  -- meados de 2026: em abril/maio ela era nula em 100%/9,6% das linhas (o
  -- backfill que a preencheu é de 20260701163444), contra 0,2% em setembro.
  -- Mandar o passivo de abril seria mandar linha sem chave — que o parceiro não
  -- tem como casar. Muda com um UPDATE, sem migration.
  data_corte        date NOT NULL DEFAULT DATE '2026-09-01',
  criado_em         timestamptz NOT NULL DEFAULT now(),
  criado_por_nome   text,
  ultimo_uso_em     timestamptz,
  revogado_em       timestamptz,
  observacao        text,
  CONSTRAINT chk_integracao_escopo CHECK (escopo IN ('faltas'))
);

CREATE UNIQUE INDEX IF NOT EXISTS integracao_tokens_hash_key
  ON public.integracao_tokens (token_hash);

ALTER TABLE public.integracao_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integracao_tokens FORCE ROW LEVEL SECURITY;
-- Sem policy, de propósito: ninguém lê esta tabela pelo PostgREST. Só as funções
-- SECURITY DEFINER abaixo (que rodam como owner e por isso passam) e a
-- service_role. FORCE para que nem o owner escape da ausência de policy.
REVOKE ALL ON public.integracao_tokens FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.integracao_tokens IS
  'Tokens de parceiros externos para leitura via RPC. Só o sha256 é guardado; '
  'revogar = preencher revogado_em. data_corte recorta o histórico entregue.';

-- ---------------------------------------------------------------------------
-- 2. Autenticador — sem GRANT, chamado só pela RPC de leitura
-- ---------------------------------------------------------------------------
-- Devolve a linha inteira do token (não só o id) porque a RPC precisa de
-- `data_corte` na mesma consulta — evita um segundo SELECT por chamada.
--
-- SOBRE FORÇA BRUTA
-- O token tem 256 bits. Deliberadamente NÃO existe tabela de tentativas falhas:
-- seria uma escrita não autenticada e ilimitada num banco que já tem aperto de
-- Disk IO — o próprio remédio viraria o vetor. Falha vai para o log do Postgres
-- via RAISE WARNING (custo zero de I/O) e a plataforma já aplica rate limit de
-- borda; a rota Next ainda soma o seu (checkRateLimit por token).

CREATE OR REPLACE FUNCTION public.integracao_autenticar(p_token text, p_escopo text)
RETURNS public.integracao_tokens
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.integracao_tokens;
BEGIN
  IF p_token IS NULL OR length(p_token) < 32 THEN
    RAISE EXCEPTION 'token invalido' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_row
    FROM public.integracao_tokens
   WHERE token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
     AND escopo = p_escopo
     AND revogado_em IS NULL;

  IF v_row.id IS NULL THEN
    -- Mensagem idêntica para token inexistente, revogado ou de outro escopo:
    -- não entregar ao chamador a informação de "quase acertou".
    RAISE WARNING 'integracao: autenticacao recusada (escopo=%, ip=%)',
      p_escopo,
      coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', '?');
    RAISE EXCEPTION 'token invalido' USING ERRCODE = '28000';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.integracao_autenticar(text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. A view — a superfície de dados da integração
-- ---------------------------------------------------------------------------
-- `security_invoker = true` é o padrão do repo. E é `CREATE OR REPLACE`, nunca
-- DROP+CREATE: o DROP perde `reloptions` e o security_invoker morre CALADO —
-- regressão real documentada em 20260914120000.
--
-- QUAL FALTA ENTRA (o ponto mais importante deste arquivo)
-- A tentação é `WHERE status = 'falta'`. Isso PERDE LINHA em silêncio: "ser
-- falta" é um valor de `status`, e `status` é mutável. A linha sai de 'falta'
-- por três caminhos, e ao sair ela simplesmente sumiria da resposta — sem
-- estorno, sem aviso, e como o parceiro pagina por cursor incremental ele nunca
-- saberia. Falta fantasma do lado dele, para sempre:
--
--   1. reverter_falta_em_lote        -> status 'cancelado'  (20260908100100:560)
--   2. reversão individual na UI     -> status 'pendente'   (central-pacientes/page.tsx:311)
--   3. cron sync_assim_results       -> status 'cancelado'  (20260825000000:274-276)
--      ramo 'Liberado *', SEM intervenção humana e sem carimbar falta_revertida_em
--
-- Medido em 2026-09-14: `status='falta'` dá 7.529 linhas; o critério abaixo dá
-- 8.036 — 507 linhas que sumiriam. E as duas reversões também ZERAM
-- `tipo_falta`, então `tipo_falta IS NOT NULL` sozinho também não basta
-- (perderia 31 revertidas). Só a união dos três predicados cobre.
--
-- Unicidade conferida sob este critério: 8.036 linhas, 8.036 ids distintos.

CREATE OR REPLACE VIEW public.vw_integracao_faltas
WITH (security_invoker = true) AS
SELECT
  f.tita_agendamento_id,
  -- `paciente_id` é `text` nesta tabela e `bigint` em agenda_tita/TiTa. Sai como
  -- número para o parceiro casar sem ambiguidade de formato — mesmo cast que o
  -- resto do repo já aplica sobre esta coluna. O NULLIF protege a linha rara com
  -- string vazia: viraria erro de conversão e derrubaria a consulta inteira.
  nullif(f.paciente_id, '')::bigint AS paciente_id,
  -- profissional_id NÃO existe em fila_autorizacoes (só `nome_medico`, que é o
  -- médico da GUIA, não o terapeuta que atende). Vem de agenda_tita.
  --
  -- LEFT JOIN, jamais INNER: agenda_tita versiona linhas por `ativo`, e 12,7%
  -- das faltas não têm linha ativa lá (o agendamento foi inativado depois). Com
  -- INNER, essas 1.023 faltas desapareceriam — exatamente o defeito que o
  -- critério acima existe para evitar. Aqui o campo vem NULL e a falta continua
  -- saindo. Fan-out conferido: 0 linhas duplicadas.
  a.profissional_id,
  f.data_atendimento,
  f.horario,
  coalesce(f.terapia_nome, f.terapia_falta) AS terapia_nome,
  f.tipo_falta,
  f.codigo_justificativa,
  f.justificativa_falta AS justificativa,
  -- Estado atual, explícito. Não é `falta_revertida_em IS NULL`: 5 linhas são
  -- falta ATIVA com esse carimbo preenchido, porque re-marcar uma falta
  -- revertida não limpa o campo (solicitar/page.tsx:1013-1019). Olhar o par
  -- (status, tipo_falta) diz a verdade; olhar só o carimbo mente.
  (f.status = 'falta' AND f.tipo_falta IS NOT NULL) AS ativa,
  f.status,
  -- `updated_at`/`created_at` são `timestamp without time zone` guardando UTC (a
  -- mistura de fusos conhecida desta tabela). O AT TIME ZONE entrega um instante
  -- absoluto, sem depender do fuso da sessão de quem lê.
  (coalesce(f.updated_at, f.created_at) AT TIME ZONE 'UTC') AS atualizado_em
FROM public.fila_autorizacoes f
LEFT JOIN public.agenda_tita a
       ON a.tita_agendamento_id = f.tita_agendamento_id
      AND a.ativo
WHERE f.tita_agendamento_id IS NOT NULL
  AND (
        f.status = 'falta'
     OR f.tipo_falta IS NOT NULL
     OR f.falta_revertida_em IS NOT NULL
  );

-- View INVOKER legível pelo `anon` NÃO é acusada por advisor nenhum (o lint
-- security_definer_view só olha DEFINER), e o grant costuma chegar por herança
-- de default privilege. Revogar explicitamente — ver 20260914150000.
REVOKE ALL ON public.vw_integracao_faltas FROM PUBLIC, anon, authenticated;

COMMENT ON VIEW public.vw_integracao_faltas IS
  'Projecao de faltas para parceiros externos: chave do TiTa, paciente, profissional, '
  'sessao, motivo e estado. Sem CPF, carteirinha ou guia. Lida pela RPC integracao_faltas.';

-- ---------------------------------------------------------------------------
-- 4. A RPC — autentica, recorta e pagina
-- ---------------------------------------------------------------------------
-- PAGINAÇÃO: CURSOR COMPOSTO, NÃO SÓ O TEMPO
-- Paginar por `atualizado_em > p_desde` PERDE LINHA em massa. Medido: as faltas
-- têm apenas 272 valores distintos de `updated_at`, e um backfill carimbou 3.858
-- delas no MESMO instante. Com limite 500 e `>` estrito, o parceiro levaria 500
-- e as outras 3.358 nunca mais apareceriam.
--
-- Por isso o cursor é o par (atualizado_em, tita_agendamento_id): dentro do
-- mesmo timestamp a varredura continua pelo id. O parceiro devolve os DOIS
-- valores da última linha que recebeu. Validado: 16 páginas, 8.036 de 8.036,
-- sem perda nem duplicata.

CREATE OR REPLACE FUNCTION public.integracao_faltas(
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
  UPDATE public.integracao_tokens
     SET ultimo_uso_em = now()
   WHERE id = v_token.id;

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
  'Cursor composto (p_desde, p_desde_id). Recorte por integracao_tokens.data_corte.';

-- ---------------------------------------------------------------------------
-- 5. Índice de varredura
-- ---------------------------------------------------------------------------
-- A expressão indexada é IDÊNTICA à do ORDER BY da view — se divergir, o planner
-- ignora o índice e ordena as milhares de linhas em disco a cada chamada.
--
-- Parcial para não pesar nas ~26 mil linhas que não são falta: este banco tem
-- aperto de Disk IO e um índice cheio aqui custaria mais do que resolve. O
-- predicado repete o da view pelo mesmo motivo.

CREATE INDEX IF NOT EXISTS fila_autorizacoes_integracao_faltas_idx
  ON public.fila_autorizacoes (
    ((coalesce(updated_at, created_at) AT TIME ZONE 'UTC')),
    tita_agendamento_id
  )
  WHERE tita_agendamento_id IS NOT NULL
    AND (status = 'falta' OR tipo_falta IS NOT NULL OR falta_revertida_em IS NOT NULL);
