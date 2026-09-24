-- ============================================================================
-- Fila da reauditoria de evoluções
--
-- POR QUE EXISTE
--
-- A reauditoria em massa era um laço no navegador (AuditoriaEvolucoesShell,
-- processarEmLotes): fechar a aba, o notebook dormir ou a sessão expirar parava
-- tudo no meio, em silêncio, e o trabalho ficava preso à máquina de quem clicou.
-- Agora o botão só enfileira; quem processa é o servidor.
--
-- O MOLDE É A FILA DA CENTRAL (20260810120050_central_filas_lease.sql e
-- 20260901180000_central_worker_tick_cron.sql): reserva com FOR UPDATE SKIP
-- LOCKED e prazo, sepultamento de quem esgotou tentativas, pg_cron chamando uma
-- rota Next com segredo do Vault. Não inventar mecânica nova.
--
-- ACESSO: só service_role. A tabela tem RLS ligada e nenhuma policy, e toda
-- função tem o EXECUTE revogado de PUBLIC/anon/authenticated. Quem lê e escreve
-- são as rotas /api/terapeutico/auditoria-evolucoes/fila (depois de conferir a
-- permissão da auditoria) e o worker.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tabela
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.auditoria_reauditoria_fila (
  id                    bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lote_id               uuid        NOT NULL,
  grade_id              uuid        NOT NULL REFERENCES public.csv_grades_profissionais(id) ON DELETE CASCADE,
  status                text        NOT NULL DEFAULT 'pendente'
                          CHECK (status IN ('pendente', 'processando', 'feito', 'falhou', 'cancelado')),
  tentativas            integer     NOT NULL DEFAULT 0,
  max_tentativas        integer     NOT NULL DEFAULT 3,
  -- Espera entre tentativas: sem ela, um 429 da OpenAI seria reprocessado no
  -- mesmo instante e queimaria as 3 tentativas em segundos.
  disponivel_em         timestamptz NOT NULL DEFAULT now(),
  reservado_em          timestamptz,
  erro                  text,
  enfileirado_por       uuid,
  enfileirado_por_nome  text,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  concluido_em          timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.auditoria_reauditoria_fila IS
  'Fila da reauditoria em massa de evoluções. Processada por POST /api/terapeutico/auditoria-evolucoes/worker/tick/. Só service_role.';

-- A mesma evolução não entra duas vezes enquanto ainda não foi processada.
-- Depois de feita, pode voltar (nova versão dos critérios).
CREATE UNIQUE INDEX IF NOT EXISTS uq_reauditoria_fila_grade_ativa
  ON public.auditoria_reauditoria_fila (grade_id)
  WHERE status IN ('pendente', 'processando');

CREATE INDEX IF NOT EXISTS idx_reauditoria_fila_ativa
  ON public.auditoria_reauditoria_fila (disponivel_em)
  WHERE status IN ('pendente', 'processando');

CREATE INDEX IF NOT EXISTS idx_reauditoria_fila_lote
  ON public.auditoria_reauditoria_fila (lote_id);

-- ENABLE e não FORCE: com FORCE as funções SECURITY DEFINER abaixo (dono
-- postgres) também passariam pela RLS e, sem policy, não enxergariam nada.
ALTER TABLE public.auditoria_reauditoria_fila ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auditoria_reauditoria_fila FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Enfileirar
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enfileirar_reauditoria(
  p_grade_ids     uuid[],
  p_usuario_id    uuid,
  p_usuario_nome  text
)
RETURNS TABLE (lote_id uuid, enfileirados integer, ja_na_fila integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _lote     uuid := gen_random_uuid();
  _pedidos  integer;
  _n        integer;
BEGIN
  SELECT count(DISTINCT g) INTO _pedidos FROM unnest(p_grade_ids) AS g;

  INSERT INTO public.auditoria_reauditoria_fila (lote_id, grade_id, enfileirado_por, enfileirado_por_nome)
  SELECT _lote, g, p_usuario_id, p_usuario_nome
    FROM (SELECT DISTINCT g FROM unnest(p_grade_ids) AS g) ids
   WHERE EXISTS (SELECT 1 FROM public.csv_grades_profissionais c WHERE c.id = ids.g)
  ON CONFLICT (grade_id) WHERE status IN ('pendente', 'processando') DO NOTHING;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN QUERY SELECT _lote, _n, _pedidos - _n;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Reservar (copiado de central.claim_message_grouping_batch)
--
-- Quem reserva também sepulta: item em 'processando' com prazo vencido e sem
-- tentativa restante vira 'falhou'. Se isso vivesse noutra função, dependeria de
-- alguém lembrar de chamá-la.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reservar_lote_reauditoria(
  p_tamanho  integer  DEFAULT 5,
  p_prazo    interval DEFAULT '3 minutes'
)
RETURNS SETOF public.auditoria_reauditoria_fila
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.auditoria_reauditoria_fila
     SET status       = 'falhou',
         erro         = coalesce(erro || ' | ', '')
                        || format('esgotou %s tentativas; a última travou em %s', max_tentativas, reservado_em),
         concluido_em = now(),
         updated_at   = now()
   WHERE status = 'processando'
     AND reservado_em < now() - p_prazo
     AND tentativas  >= max_tentativas;

  RETURN QUERY
  UPDATE public.auditoria_reauditoria_fila f
     SET status       = 'processando',
         reservado_em = now(),
         tentativas   = f.tentativas + 1,
         updated_at   = now()
   WHERE f.id IN (
     SELECT id
       FROM public.auditoria_reauditoria_fila
      WHERE disponivel_em <= now()
        AND tentativas < max_tentativas
        AND (status = 'pendente'
             OR (status = 'processando' AND reservado_em < now() - p_prazo))
      ORDER BY criado_em, id
      LIMIT p_tamanho
      FOR UPDATE SKIP LOCKED
   )
  RETURNING f.*;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Resumo para a tela
--
-- Soma todos os lotes que ainda têm trabalho — dois usuários enfileirando ao
-- mesmo tempo veem o progresso somado, não um esconde o outro. Sem nada em
-- andamento, devolve o último lote, para a tela mostrar as falhas dele.
-- Agregado no banco: a tela nunca lê linhas (o PostgREST cortaria em 1000).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resumo_fila_reauditoria()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ativos AS (
    SELECT DISTINCT lote_id FROM public.auditoria_reauditoria_fila
     WHERE status IN ('pendente', 'processando')
  ),
  ultimo AS (
    SELECT lote_id FROM public.auditoria_reauditoria_fila
     ORDER BY criado_em DESC, id DESC LIMIT 1
  ),
  alvo AS (
    SELECT lote_id FROM ativos
    UNION
    SELECT lote_id FROM ultimo WHERE NOT EXISTS (SELECT 1 FROM ativos)
  )
  SELECT jsonb_build_object(
    'em_andamento', EXISTS (SELECT 1 FROM ativos),
    'lotes',        coalesce((SELECT jsonb_agg(lote_id) FROM alvo), '[]'::jsonb),
    'total',        count(*),
    'feitos',       count(*) FILTER (WHERE status = 'feito'),
    'falharam',     count(*) FILTER (WHERE status = 'falhou'),
    'cancelados',   count(*) FILTER (WHERE status = 'cancelado'),
    'pendentes',    count(*) FILTER (WHERE status IN ('pendente', 'processando')),
    'concluido_em', max(concluido_em)
  )
  FROM public.auditoria_reauditoria_fila
  WHERE lote_id IN (SELECT lote_id FROM alvo);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Repetir as que falharam / cancelar o que falta
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.repetir_falhas_reauditoria(p_lotes uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n integer;
BEGIN
  UPDATE public.auditoria_reauditoria_fila f
     SET status        = 'pendente',
         tentativas    = 0,
         erro          = NULL,
         disponivel_em = now(),
         reservado_em  = NULL,
         concluido_em  = NULL,
         updated_at    = now()
   WHERE f.lote_id = ANY (p_lotes)
     AND f.status  = 'falhou'
     -- Respeita o índice único: se a evolução já voltou à fila por outro lote,
     -- não duplica.
     AND NOT EXISTS (
       SELECT 1 FROM public.auditoria_reauditoria_fila o
        WHERE o.grade_id = f.grade_id AND o.status IN ('pendente', 'processando')
     );
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancelar_reauditoria()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n integer;
BEGIN
  -- Só o que ainda não começou. O que está em 'processando' já tem chamada à
  -- IA em voo; cancelar no meio descartaria um resultado pago.
  UPDATE public.auditoria_reauditoria_fila
     SET status = 'cancelado', concluido_em = now(), updated_at = now()
   WHERE status = 'pendente';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enfileirar_reauditoria(uuid[], uuid, text)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reservar_lote_reauditoria(integer, interval)    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resumo_fila_reauditoria()                       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.repetir_falhas_reauditoria(uuid[])              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancelar_reauditoria()                          FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.enfileirar_reauditoria(uuid[], uuid, text)      TO service_role;
GRANT  EXECUTE ON FUNCTION public.reservar_lote_reauditoria(integer, interval)    TO service_role;
GRANT  EXECUTE ON FUNCTION public.resumo_fila_reauditoria()                       TO service_role;
GRANT  EXECUTE ON FUNCTION public.repetir_falhas_reauditoria(uuid[])              TO service_role;
GRANT  EXECUTE ON FUNCTION public.cancelar_reauditoria()                          TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Configuração do tique (linha única, como central.worker_tick_config)
--
-- URL e interruptor em tabela: trocar o endereço ou pausar a fila numa
-- emergência vira um UPDATE, não uma migration. O segredo NÃO fica aqui: fica
-- no Vault (auditoria_worker_secret).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.auditoria_worker_config (
  id          boolean     PRIMARY KEY DEFAULT true CHECK (id),
  url         text        NOT NULL,
  ativo       boolean     NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.auditoria_worker_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auditoria_worker_config FROM anon, authenticated;

COMMENT ON COLUMN public.auditoria_worker_config.url IS
  'URL absoluta do tique no Coolify. COM barra final: sem ela o Next responde 308 e o pg_net não segue redirect.';

INSERT INTO public.auditoria_worker_config (id, url)
VALUES (true, 'https://orbitaautomacao.com.br/api/terapeutico/auditoria-evolucoes/worker/tick/')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Disparador + agendamento
--
-- O gatilho normal é a própria rota que enfileira (despacho em processo). O
-- cron é a rede de segurança: container reiniciado, tentativa adiada por
-- disponivel_em, item com prazo de reserva vencido.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_auditoria_worker_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  _url      text;
  _segredo  text;
BEGIN
  SELECT url INTO _url FROM public.auditoria_worker_config WHERE id = true AND ativo = true;
  IF _url IS NULL THEN
    RETURN;
  END IF;

  -- Fila vazia (o caso de quase todo minuto): não acorda o Coolify.
  IF NOT EXISTS (
    SELECT 1 FROM public.auditoria_reauditoria_fila
     WHERE status IN ('pendente', 'processando')
       AND disponivel_em <= now()
  ) THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO _segredo
    FROM vault.decrypted_secrets WHERE name = 'auditoria_worker_secret';
  IF _segredo IS NULL THEN
    RAISE EXCEPTION 'fn_auditoria_worker_tick: segredo auditoria_worker_secret ausente no Vault';
  END IF;

  PERFORM net.http_post(
    url     := _url,
    headers := jsonb_build_object('x-worker-secret', _segredo, 'Content-Type', 'application/json'),
    body                 := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_auditoria_worker_tick() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('auditoria-worker-tick');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'auditoria-worker-tick',
  '* * * * *',
  $cron$SELECT public.fn_auditoria_worker_tick()$cron$
);

-- ============================================================================
-- ANTES DE APLICAR: crie o segredo no Vault com o MESMO valor da variável
-- AUDITORIA_WORKER_SECRET do Coolify. Sem ele, o cron só levanta exceção.
--
--   SELECT vault.create_secret(
--     '<mesmo valor de AUDITORIA_WORKER_SECRET>',
--     'auditoria_worker_secret',
--     'Segredo do tique da fila de reauditoria de evoluções'
--   );
--
-- CONFERÊNCIA:
--   SELECT * FROM cron.job WHERE jobname = 'auditoria-worker-tick';
--   SELECT public.resumo_fila_reauditoria();
--   SELECT status_code, content, created FROM net._http_response ORDER BY created DESC LIMIT 5;
-- ============================================================================
