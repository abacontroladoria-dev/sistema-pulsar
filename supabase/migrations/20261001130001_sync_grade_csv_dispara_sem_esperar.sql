-- sync-grade-csv: o cron deixa de ESPERAR a resposta e passa a ser conferido pelo DADO
--
-- ─── O defeito ──────────────────────────────────────────────────────────────
-- fn_sync_grade_csv_em_lotes() (20260914120000) dispara net.http_post e depois
-- fica em pg_sleep(2) até 160s por tentativa, 3 tentativas. O statement_timeout
-- do cron é de 120s: o job morre SEMPRE aos 2 minutos, em
--   "canceling statement due to statement timeout ... SELECT pg_sleep(2)"
-- Medido em 2026-10-01: cron.job_run_details do jobid 31 = `failed` todos os dias
-- de 22/09 a 01/10, com end_time = start_time + 2min.
--
-- Duas consequências, ambas silenciosas:
--   1. A função é abortada INTEIRA, então o insert em public.alertas (regra
--      sync_grade_falhou) nunca roda: zero alertas, ninguém foi avisado.
--   2. net.http_post só enfileira o envio quando a transação termina. Dentro de
--      uma transação que espera a própria resposta, o pedido pode nunca sair
--      (o log da Edge Function não tinha uma única chamada em modo "grade").
--
-- Efeito para o usuário: a grade futura parou em 31/10 e, na virada do mês, as
-- telas de Cronograma (Saída de Profissional, Ocupação de Paciente) ficaram sem
-- dado para a janela de novembro ("Nenhum registro encontrado para o período").
--
-- Prova de que a Edge Function estava saudável: um net.http_post ISOLADO (sem
-- esperar), feito à mão em 2026-10-01, voltou 200 e a função se reencadeou
-- sozinha por salto até o fim da janela.
--
-- ─── A correção ─────────────────────────────────────────────────────────────
--   • fn_sync_grade_csv_em_lotes(): só dispara e retorna. A transação fecha, o
--     pedido sai. Sem segredo no Vault, FALHA com exceção (o job fica `failed`
--     de verdade, com a causa na mensagem, em vez de silêncio).
--   • fn_sync_grade_csv_verificar(p_alertar): confere pelo DADO — o que importa
--     é a grade alcançar o fim do mês seguinte, não o HTTP 200 da primeira
--     rodada (a function se encadeia por minutos/horas depois de responder).
--       p_alertar = false  → se faltou, RETOMA a partir do último dia com
--                            grade (a function é idempotente), sem alarme.
--       p_alertar = true   → se ainda faltou, abre o alerta sync_grade_falhou.
--   • Dois jobs: 08:30 UTC (retoma) e 11:30 UTC (alerta).
--
-- "Alcançou" = grade com data >= fim do mês seguinte − 3 dias: tolera o fim
-- ficar em sábado/domingo (a clínica não atende e a TiTa devolve vazio).
--
-- Rollback: recriar fn_sync_grade_csv_em_lotes() com o corpo de
-- 20260914120000 e `select cron.unschedule(...)` nos dois jobs novos.
--
-- Idempotente.

create or replace function public.fn_sync_grade_csv_em_lotes()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  select decrypted_secret into v_token
    from vault.decrypted_secrets
   where name = 'cron_service_role_key';

  if v_token is null then
    raise exception 'sync-grade-csv: segredo cron_service_role_key ausente no Vault';
  end if;

  -- Sem data_inicio/data_fim: a function aplica a janela padrão (hoje → fim do
  -- mês seguinte) e se reencadeia sozinha, um dia por salto. Não esperamos a
  -- resposta: a transação precisa terminar para o pedido sair.
  perform net.http_post(
    url     := 'https://wmugemamnqxjfpxrlwes.supabase.co/functions/v1/sync-grade-csv',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_token,
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object('modo', 'grade'),
    timeout_milliseconds := 150000
  );
end;
$$;

comment on function public.fn_sync_grade_csv_em_lotes() is
  'Dispara UMA chamada à Edge Function sync-grade-csv (modo grade) e retorna sem esperar a resposta — esperar na mesma transação estourava o statement_timeout (2 min) e abortava tudo. Quem confere se a grade alcançou o fim do mês seguinte é fn_sync_grade_csv_verificar().';

create or replace function public.fn_sync_grade_csv_verificar(p_alertar boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoje   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_fim    date;
  v_meta   date;
  v_max    date;
  v_token  text;
  v_inicio date;
  v_detalhe text;
begin
  v_fim  := (date_trunc('month', v_hoje) + interval '2 month' - interval '1 day')::date;
  v_meta := v_fim - 3;

  select max(g.data::date) into v_max
    from public.vw_grade_base g
   where g.unidade_id = 280;

  if v_max is not null and v_max >= v_meta then
    return;
  end if;

  v_detalhe := concat(
    'a grade vai só até ', coalesce(v_max::text, '(vazia)'),
    ' e deveria chegar a ', v_fim::text
  );

  if not p_alertar then
    select decrypted_secret into v_token
      from vault.decrypted_secrets
     where name = 'cron_service_role_key';

    if v_token is null then
      raise exception 'sync-grade-csv: segredo cron_service_role_key ausente no Vault';
    end if;

    v_inicio := greatest(coalesce(v_max, v_hoje - 1) + 1, v_hoje);

    perform net.http_post(
      url     := 'https://wmugemamnqxjfpxrlwes.supabase.co/functions/v1/sync-grade-csv',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_token,
        'Content-Type',  'application/json'
      ),
      body    := jsonb_build_object(
        'modo', 'grade',
        'data_inicio', v_inicio::text,
        'data_fim', v_fim::text
      ),
      timeout_milliseconds := 150000
    );
    return;
  end if;

  with novo as (
    insert into public.alertas (
      modulo, regra_codigo, origem, entidade_tipo, entidade_id, entidade_ref,
      titulo, descricao, prioridade, status, setor_destino, fingerprint
    ) values (
      'sync', 'sync_grade_falhou', 'sistema', 'sync_grade_chunk',
      concat('janela_', v_hoje::text),
      jsonb_build_object('modo', 'grade', 'hoje', v_hoje::text,
                         'ultima_data', v_max, 'fim_esperado', v_fim),
      concat('Grade futura não sincronizou (rodada de ', v_hoje::text, ')'),
      concat(
        'Conferência pelo dado: ', v_detalhe, '. A retomada automática já foi tentada. ',
        'As telas de Cronograma ficam sem grade no mês seguinte. ',
        'Reexecute com: select public.fn_sync_grade_csv_em_lotes();'
      ),
      'alta', 'aberto', 'admin',
      concat_ws('|', 'sync_grade_csv', v_hoje::text)
    )
    on conflict do nothing
    returning id
  )
  insert into public.alertas_eventos (
    alerta_id, entidade_tipo, entidade_id, tipo, autor_tipo, autor_nome, descricao
  )
  select
    novo.id, 'sync_grade_chunk', concat('janela_', v_hoje::text),
    'deteccao', 'sistema', 'Sistema',
    concat('Sistema detectou grade futura incompleta: ', v_detalhe)
  from novo;
end;
$$;

comment on function public.fn_sync_grade_csv_verificar(boolean) is
  'Confere se a grade (unidade 280) alcança o fim do mês seguinte (tolerância de 3 dias). p_alertar=false: retoma o sync do último dia com grade. p_alertar=true: abre o alerta sync_grade_falhou.';

revoke execute on function public.fn_sync_grade_csv_em_lotes() from public, anon, authenticated;
revoke execute on function public.fn_sync_grade_csv_verificar(boolean) from public, anon, authenticated;

select cron.schedule(
  'sync-grade-csv-verificar-retoma', '30 8 * * *',
  $$ select public.fn_sync_grade_csv_verificar(false); $$
);
select cron.schedule(
  'sync-grade-csv-verificar-alerta', '30 11 * * *',
  $$ select public.fn_sync_grade_csv_verificar(true); $$
);
