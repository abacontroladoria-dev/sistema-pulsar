-- ============================================================================
-- Tique dos workers acorda também para a "Maia sugere" (números Evolution)
--
-- O guard de fila vazia só olhava message_grouping_queue e send_queue. A
-- Evolution não passa por fila nenhuma, então com as duas vazias a rota nunca
-- era chamada e sugestao-evolution.worker.ts nunca rodava.
-- Terceiro critério: conversa de número com maia_sugestao que recebeu mensagem
-- nos últimos 30 min depois da última reivindicação de sugestão.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_central_worker_tick()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'central', 'vault'
AS $function$
DECLARE
  _url      text;
  _segredo  text;
  _pendente integer;
BEGIN
  SELECT url INTO _url
    FROM central.worker_tick_config
   WHERE id = true AND ativo = true;

  IF _url IS NULL THEN
    RETURN;   -- desligado de propósito, ou nunca configurado
  END IF;

  -- Guard de fila vazia: no caminho feliz o despacho pós-webhook já drenou
  -- tudo, e a rede de segurança não tem nada a fazer. Contar é barato (índice
  -- idx_grouping_org_process_after); acordar o Coolify à toa, não.
  SELECT count(*) INTO _pendente
    FROM central.message_grouping_queue
   WHERE status = 'pending' AND process_after <= now();

  IF _pendente = 0 THEN
    SELECT count(*) INTO _pendente
      FROM central.send_queue
     WHERE status = 'pending' AND scheduled_at <= now();
  END IF;

  -- Maia sugere: conversa com mensagem nova desde a última reivindicação.
  IF _pendente = 0 THEN
    SELECT count(*) INTO _pendente
      FROM central.conversations c
      JOIN central.inboxes i ON i.id = c.inbox_id AND i.maia_sugestao
     WHERE c.last_message_at >= now() - interval '30 minutes'
       AND c.last_message_at > coalesce((c.ai_context->'sugestao'->>'em')::timestamptz, '-infinity');
  END IF;

  IF _pendente = 0 THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO _segredo
    FROM vault.decrypted_secrets WHERE name = 'central_worker_secret';

  IF _segredo IS NULL THEN
    RAISE EXCEPTION 'fn_central_worker_tick: segredo central_worker_secret ausente no Vault';
  END IF;

  -- net.http_post é ASSÍNCRONO e fire-and-forget. Ver 20260811 e seguintes.
  PERFORM net.http_post(
    url     := _url,
    headers := jsonb_build_object(
      'x-worker-secret', _segredo,
      'Content-Type',    'application/json'
    ),
    body                 := '{}'::jsonb,
    timeout_milliseconds := 55000   -- abaixo do maxDuration=60 da rota
  );
END;
$function$;
