-- Fecha o timeout nos 2 jobs que chamam net.http_post direto no comando.
--
-- POR QUE
-- 20260814100200 deu timeout_milliseconds := 120000 às 6 fn_sync_tita_*, mas
-- estes dois não passam por função nenhuma: o net.http_post está no próprio
-- cron.job.command, e eles foram criados pelo dashboard, então não existiam em
-- migration alguma. Sem o parâmetro, vale o default do pg_net (5000 ms): a
-- requisição é enviada, a Edge Function roda, e a resposta é descartada com
-- status_code NULL e timed_out = true. As duas respostas assim das 16:00:00 de
-- 2026-08-14 são deste lote — sync-grade-profissionais-hora roda '0 * * * 1-5'.
--
-- O texto de cada comando foi lido de cron.job depois de 20260814100000, que já
-- havia trocado a chave embutida pela leitura do Vault — é por isso que o
-- Authorization abaixo já vem do vault.decrypted_secrets. URL, headers, corpo e
-- horário são os que estão em produção; a ÚNICA adição é o timeout.
--
-- 120000 é o valor estabelecido no projeto (fn_sync_tita_grade,
-- fn_sync_grade_csv_em_lotes, fn_sync_grade_execucao_em_lotes, os dois
-- snapshots de previsão e agora as 6 fn_sync_tita_*).
--
-- Usa cron.alter_job em vez de cron.schedule: altera só o comando, preservando
-- jobid, horário e o estado ativo. cron.schedule recriaria o job e reativaria
-- um que estivesse desligado.
--
-- NOTA sobre sync-grade-profissionais-hora: ele passa headers com APENAS
-- Authorization, o que substitui o default do pg_net e portanto omite o
-- Content-Type. Mantido como está — vem funcionando assim, o corpo é o '{}'
-- default e Deno parseia sem o header. Acrescentá-lo seria mudança de
-- comportamento fora do escopo deste arquivo.

DO $do$
DECLARE
  v_jobid bigint;
BEGIN
  -- ---------------------------------------------------------------------
  -- sync_tita_agenda  ('0 10,13,16,19 * * 1-5')
  -- ---------------------------------------------------------------------
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'sync_tita_agenda';
  IF v_jobid IS NULL THEN
    -- Banco NOVO (reset local, CI): estes dois jobs foram criados a mao pelo
    -- dashboard e so existem em producao, entao aqui nao ha o que ajustar.
    -- Abortar com EXCEPTION travava o `db reset` inteiro neste ponto e deixava
    -- as ~160 migrations seguintes sem aplicar. Mesmo padrao tolerante de
    -- 20260814100200 ('job ... ja nao existe').
    RAISE NOTICE 'job sync_tita_agenda nao existe neste banco; nada a fazer';
  ELSE
  PERFORM cron.alter_job(v_jobid, command := $cmd$
    select net.http_post(
      url := 'https://wmugemamnqxjfpxrlwes.supabase.co/functions/v1/sync_tita_agenda',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_service_role_key'),
        'Content-Type',
        'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $cmd$);
  RAISE NOTICE 'job sync_tita_agenda: timeout 120000 aplicado';
  END IF;

  -- ---------------------------------------------------------------------
  -- sync-grade-profissionais-hora  ('0 * * * 1-5')
  -- ---------------------------------------------------------------------
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'sync-grade-profissionais-hora';
  IF v_jobid IS NULL THEN
    RAISE NOTICE 'job sync-grade-profissionais-hora nao existe neste banco; nada a fazer';
  ELSE
  PERFORM cron.alter_job(v_jobid, command := $cmd$
    select net.http_post(
      url := 'https://wmugemamnqxjfpxrlwes.supabase.co/functions/v1/sync-terapeutas-tita',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_service_role_key')
      ),
      timeout_milliseconds := 120000
    );
  $cmd$);
  RAISE NOTICE 'job sync-grade-profissionais-hora: timeout 120000 aplicado';
  END IF;
END
$do$;
