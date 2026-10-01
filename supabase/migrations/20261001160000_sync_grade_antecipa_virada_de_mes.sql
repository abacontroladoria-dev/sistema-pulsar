-- sync-grade-csv: a virada de mês deixa de ser o dia em que a grade falta
--
-- ─── Por que o problema cai sempre no dia 1º ────────────────────────────────
-- A janela padrão do sync é "hoje → fim do MÊS SEGUINTE" (fimPadrao() na Edge
-- Function). No dia 30/09 isso é 31/10; no dia 01/10 vira 30/11 — o horizonte
-- salta um mês inteiro de uma vez. Nos outros dias a cadeia tem ~31 dias a
-- cobrir e quase tudo já está sincronizado; no dia 1º são 61, com um mês
-- inédito.
--
-- E a cadeia anda em ORDEM, um dia por salto. A janela que as telas leem —
-- getRefWeek() (1ª segunda-sexta do mês seguinte) e getJanelaOcupacaoPaciente()
-- (dias 1 a 7 do mês seguinte), ver frontend/lib/cronograma/helpers.ts — é
-- justamente o FIM dessa fila. Ou seja: no dia em que ela é mais necessária,
-- ela é a última a chegar.
--
-- Foi o que aconteceu em 01/09 e em 01/10/2026 (grade parada em 31/10, telas de
-- Cronograma sem registro para 02/11–06/11). O gatilho foi o cron falhando
-- desde 20/08 (`pg_sleep` esperando a resposta dentro do statement_timeout —
-- corrigido em 20261001130000), mas o DESENHO já era frágil: mesmo com o cron
-- saudável, a janela crítica depende de 61 saltos terminarem antes de a clínica
-- abrir.
--
-- ─── A correção ─────────────────────────────────────────────────────────────
-- Parar de depender da ordem da fila para a janela que importa:
--
--   fn_sync_grade_csv_janela_critica(p_meses) — garante os 14 primeiros dias do
--     mês `hoje + p_meses`, com datas EXPLÍCITAS (a Edge Function respeita
--     data_inicio/data_fim e ignora a janela padrão). 14 dias porque a 1ª
--     sexta-feira útil cai no dia 11 no pior caso (mês que começa numa terça).
--
--   Dois agendamentos:
--     • diário, 03:00 UTC (00:00 Brasília), p_meses = 1 — rede de segurança do
--       que as telas leem HOJE; na madrugada do dia 1º resolve a janela crítica
--       em ~14 saltos, antes de a cadeia de 61 dias começar às 02:00.
--     • dias 25–28, 03:30 UTC, p_meses = 2 — ANTECIPA a janela do mês que vai
--       virar. No dia 1º ela já está no banco e o diário não tem o que fazer.
--       Quatro dias seguidos são quatro tentativas; depois da primeira que
--       funcionar, as outras saem na hora sem trabalho nenhum.
--
-- Sincronizar uma janela estreita é seguro: sincronizarGrade() só considera
-- "existentes" o que carregarAtivas(sb, dataInicio, dataFim) devolve, e o
-- handler chama um dia por vez — nada fora da janela é inativado. Verificado em
-- 01/10/2026 sincronizando 01–07/11 à mão: 773 inseridos, 0 excluídos.
--
-- ─── O ajuste em fn_sync_grade_csv_verificar ────────────────────────────────
-- Ela conferia só `max(data) >= fim do mês seguinte − 3`. Com a antecipação
-- acima, `max(data)` passa a alcançar o mês+2 ANTES de o mês+1 estar completo —
-- e o alarme ficaria cego justamente para o buraco que ele existe para pegar.
-- Agora são duas perguntas: a janela crítica tem dia útil suficiente, E a cauda
-- chegou ao fim do mês seguinte.
--
-- "Suficiente" = 8 dias distintos com grade na quinzena. Uma quinzena tem 10
-- dias úteis; 8 tolera dois feriados sem alarme falso, e nenhum sync parcial
-- passa batido. Contar TODO dia útil não serviria: feriado sem sessão na TiTa
-- (25/12, por exemplo) viraria falha permanente.
--
-- Rollback: `select cron.unschedule('sync-grade-csv-janela-critica');`,
-- idem 'sync-grade-csv-antecipa-mes', e recriar fn_sync_grade_csv_verificar
-- com o corpo de 20261001130000.
--
-- Idempotente.

-- ── Disparo: um lugar só para Vault + http_post ──────────────────────────────
-- Sem datas, a Edge Function aplica a janela padrão e se reencadeia sozinha.
-- Com datas, sincroniza exatamente o pedido. Nunca espera a resposta: esperar
-- dentro da transação é o que estourava o statement_timeout do cron.
create or replace function public.fn_sync_grade_csv_disparar(
  p_inicio date default null,
  p_fim    date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_body  jsonb := jsonb_build_object('modo', 'grade');
begin
  select decrypted_secret into v_token
    from vault.decrypted_secrets
   where name = 'cron_service_role_key';

  if v_token is null then
    raise exception 'sync-grade-csv: segredo cron_service_role_key ausente no Vault';
  end if;

  if p_inicio is not null and p_fim is not null then
    v_body := v_body || jsonb_build_object(
      'data_inicio', p_inicio::text,
      'data_fim',    p_fim::text
    );
  end if;

  perform net.http_post(
    url     := 'https://wmugemamnqxjfpxrlwes.supabase.co/functions/v1/sync-grade-csv',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_token,
      'Content-Type',  'application/json'
    ),
    body    := v_body,
    timeout_milliseconds := 150000
  );
end;
$$;

comment on function public.fn_sync_grade_csv_disparar(date, date) is
  'Dispara a Edge Function sync-grade-csv (modo grade) e retorna sem esperar a resposta. Sem datas: janela padrão (hoje → fim do mês seguinte), que se reencadeia sozinha. Com datas: exatamente essa janela.';

-- ── Quantos dias distintos com grade existem na quinzena que as telas leem ───
create or replace function public.fn_grade_dias_na_janela(p_inicio date, p_fim date)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct g.data::date)::int
    from public.vw_grade_base g
   where g.unidade_id = 280
     and g.data::date between p_inicio and p_fim;
$$;

comment on function public.fn_grade_dias_na_janela(date, date) is
  'Dias distintos com grade (unidade 280) no intervalo. Uma quinzena cheia tem ~10 dias úteis; abaixo de 8 indica sync parcial ou ausente.';

-- ── Garante a quinzena crítica do mês hoje+p_meses ──────────────────────────
create or replace function public.fn_sync_grade_csv_janela_critica(p_meses integer default 1)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoje   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_inicio date;
  v_fim    date;
begin
  v_inicio := (date_trunc('month', v_hoje) + make_interval(months => p_meses))::date;
  v_fim    := v_inicio + 13;

  if public.fn_grade_dias_na_janela(v_inicio, v_fim) >= 8 then
    return;
  end if;

  -- greatest(): no mês corrente (p_meses = 0, uso manual) a janela não pode
  -- começar no passado — a Edge Function recusaria e o trigger de congelamento
  -- também.
  perform public.fn_sync_grade_csv_disparar(greatest(v_inicio, v_hoje), v_fim);
end;
$$;

comment on function public.fn_sync_grade_csv_janela_critica(integer) is
  'Garante os 14 primeiros dias do mês hoje+p_meses — a janela que getRefWeek() e getJanelaOcupacaoPaciente() leem. Não faz nada se a quinzena já tem 8+ dias com grade. p_meses=1: rede diária. p_meses=2: antecipa a virada de mês.';

-- ── Conferência: janela crítica E cauda do mês seguinte ─────────────────────
create or replace function public.fn_sync_grade_csv_verificar(p_alertar boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoje      date := (now() at time zone 'America/Sao_Paulo')::date;
  v_fim       date;
  v_crit_ini  date;
  v_crit_fim  date;
  v_crit_dias int;
  v_max       date;
  v_cauda_ok  boolean;
  v_detalhe   text;
begin
  v_fim      := (date_trunc('month', v_hoje) + interval '2 month' - interval '1 day')::date;
  v_crit_ini := (date_trunc('month', v_hoje) + interval '1 month')::date;
  v_crit_fim := v_crit_ini + 13;

  v_crit_dias := public.fn_grade_dias_na_janela(v_crit_ini, v_crit_fim);

  select max(g.data::date) into v_max
    from public.vw_grade_base g
   where g.unidade_id = 280;

  -- Tolerância de 3 dias: o fim do mês pode cair em sábado/domingo, e aí a TiTa
  -- devolve vazio sem que nada esteja errado.
  v_cauda_ok := v_max is not null and v_max >= v_fim - 3;

  if v_crit_dias >= 8 and v_cauda_ok then
    return;
  end if;

  v_detalhe := concat(
    'janela crítica ', v_crit_ini::text, '..', v_crit_fim::text,
    ' com ', v_crit_dias, ' dia(s) de grade (esperado 8+)',
    '; última data da grade: ', coalesce(v_max::text, '(vazia)'),
    ' (esperado alcançar ', v_fim::text, ')'
  );

  if not p_alertar then
    -- Janela crítica primeiro: é o que as telas leem. A cauda fica para a
    -- cadeia diária, que a cobre de qualquer forma.
    if v_crit_dias < 8 then
      perform public.fn_sync_grade_csv_disparar(greatest(v_crit_ini, v_hoje), v_crit_fim);
    else
      perform public.fn_sync_grade_csv_disparar(greatest(coalesce(v_max, v_hoje - 1) + 1, v_hoje), v_fim);
    end if;
    return;
  end if;

  with novo as (
    insert into public.alertas (
      modulo, regra_codigo, origem, entidade_tipo, entidade_id, entidade_ref,
      titulo, descricao, prioridade, status, setor_destino, fingerprint
    ) values (
      'sync', 'sync_grade_falhou', 'sistema', 'sync_grade_chunk',
      concat('janela_', v_hoje::text),
      jsonb_build_object(
        'modo', 'grade', 'hoje', v_hoje::text,
        'janela_critica_inicio', v_crit_ini, 'janela_critica_fim', v_crit_fim,
        'janela_critica_dias', v_crit_dias,
        'ultima_data', v_max, 'fim_esperado', v_fim
      ),
      concat('Grade futura não sincronizou (rodada de ', v_hoje::text, ')'),
      concat(
        'Conferência pelo dado: ', v_detalhe, '. A retomada automática já foi tentada. ',
        'As telas de Cronograma (Saída de Profissional, Ocupação de Paciente) ficam sem grade. ',
        'Reexecute com: select public.fn_sync_grade_csv_janela_critica(1); '
        'e select public.fn_sync_grade_csv_em_lotes();'
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
  'Confere a grade por DOIS critérios: a quinzena crítica do mês seguinte tem 8+ dias, e a última data alcança o fim do mês seguinte (tolerância de 3 dias). p_alertar=false: retoma, priorizando a janela crítica. p_alertar=true: abre o alerta sync_grade_falhou.';

revoke execute on function public.fn_sync_grade_csv_disparar(date, date)       from public, anon, authenticated;
revoke execute on function public.fn_grade_dias_na_janela(date, date)          from public, anon, authenticated;
revoke execute on function public.fn_sync_grade_csv_janela_critica(integer)    from public, anon, authenticated;
revoke execute on function public.fn_sync_grade_csv_verificar(boolean)         from public, anon, authenticated;

-- 00:00 Brasília: rede de segurança do que as telas leem hoje. Roda ANTES da
-- cadeia das 02:00 justamente para a madrugada do dia 1º resolver a quinzena
-- crítica sem esperar os 61 saltos.
select cron.schedule(
  'sync-grade-csv-janela-critica', '0 3 * * *',
  $$ select public.fn_sync_grade_csv_janela_critica(1); $$
);

-- Dias 25–28, 00:30 Brasília: antecipa a quinzena do mês que vai virar, para
-- que no dia 1º não haja nada de urgente a fazer.
select cron.schedule(
  'sync-grade-csv-antecipa-mes', '30 3 25-28 * *',
  $$ select public.fn_sync_grade_csv_janela_critica(2); $$
);
