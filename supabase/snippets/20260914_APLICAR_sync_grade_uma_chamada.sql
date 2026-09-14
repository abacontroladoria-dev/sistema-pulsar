-- ============================================================================
-- sync-grade-csv: o cron para de fatiar, e "HTTP 200" deixa de significar "deu certo"
-- ----------------------------------------------------------------------------
-- Incidente de 2026-09-14, visto pelo aviso "Grade desatualizada" da Ocupação de
-- Paciente (o alarme sobre `visto_em` que 20260910* previu como o P1). Medido em
-- produção: toda data FUTURA com `visto_em` congelado em 2026-09-10 21:0x —
-- 01/10 às 20:59, 07/10 às 21:01, 31/10 às 21:08. Quatro dias parada.
--
-- O cron não estava morto: as rodadas de 11, 12, 13 e 14/09 gravaram 1.739,
-- 1.610, 905 e 1.166 linhas. Só que TODAS no passado — a faixa tocada desde
-- 11/09 vai de 31/07 a 14/09, que é exatamente a janela do modo `execucao`
-- (hoje-45 → hoje, DIAS_RECAPTURA). O modo `grade` não gravou um único dia
-- futuro. O passado sobrevivia porque tem cron próprio com janela curta.
--
-- A Edge Function está boa. Chamada à mão em 14/09 para 02/10 ela fecha limpa em
-- segundos (669 recebidos, 2 inseridos, 2 excluídos, 667 inalterados), e chamada
-- com {"modo":"grade"} devolve `diasProcessados: 2, proximoDia: 2026-09-16,
-- continuaSozinha: true` — o fatiamento de um dia por chamada e o encadeamento
-- que 3a78a72/eda2daa/d015cbb/dbcb3f0 introduziram funcionam.
--
-- O defeito é QUEM CHAMA. Esta função ainda manda blocos de 7 dias
-- (`v_chunk_fim := v_chunk_inicio + 6`), que é precisamente o tamanho que o
-- cabeçalho da Edge Function documenta como fatal: "blocos de 7 dias morreram
-- com 546 WORKER_RESOURCE_LIMIT, blocos de 4 dias também. Só um dia por chamada".
-- O fix de 10/09 corrigiu o fatiamento INTERNO da function; o cron continuou
-- impondo 7 dias por request e cada bloco futuro morria no limite de recurso.
--
-- Correção, em duas partes:
--
--   1. UMA chamada, sem fatiar. A function já se fatia sozinha em um dia por
--      vez, já para antes do teto de 25s e já se reencadeia até MAX_SALTOS
--      fechando a janela inteira. Fatiar aqui não ajuda mais — atrapalha, porque
--      o bloco de 7 dias nem chega a ser fatiado: ele morre antes. Mandar `{}`
--      deixa a function resolver a janela padrão (hoje → fim do mês seguinte)
--      pela sua própria fórmula, o que também elimina a duplicação da fórmula
--      de `v_fim` aqui — a divergência entre as duas cópias já foi o incidente
--      de 20260805150000 e de 20260902100050.
--
--   2. Aceitar 200 é aceitar pouco. O retry de 20260820120100 só reagia a
--      status != 200, e a resposta de uma rodada que parou no meio é 200 com
--      `{"ok": false, "incompleto": true}` no corpo. Por isso as 4 rodadas
--      falhas não abriram um único alerta (nenhum alerta desde 30/07). Agora o
--      sucesso exige `ok = true` no CORPO, não só no status — que é o mesmo
--      critério que a própria function usa para dizer "a janela inteira entrou".
--
-- O retry de 3 tentativas, a espera síncrona por net._http_response e o alerta
-- `sync_grade_falhou` continuam iguais; o que muda é o que conta como falha e o
-- fato de haver um bloco só.
--
-- Uma ressalva medida nesta mesma sessão, e que esta migration NÃO resolve: um
-- único dia futuro levou 88s para fechar (2026-10-29, chamada isolada). O teto
-- de TETO_EXECUCAO_MS = 25_000 na Edge Function foi dimensionado supondo "~2
-- dias por salto"; a 88s/dia ele dispara DEPOIS do primeiro dia, e cada salto
-- rende 1 dia, não 2. A janela de ~48 dias passa a exigir ~48 saltos — acima de
-- MAX_SALTOS = 45. Ou seja: mesmo com esta correção, a rodada pode não alcançar
-- o fim do mês seguinte sozinha. A diferença é que agora ela ABRE ALERTA quando
-- isso acontece (o corpo volta ok=false), em vez de congelar em silêncio como
-- fez de 10/09 a 14/09. Subir MAX_SALTOS ou baratear a fatia é trabalho da Edge
-- Function, fora do escopo desta migration, e o alerta é o que torna essa
-- pendência visível em vez de suposta.
--
-- Segunda ressalva, também medida aqui e também fora do escopo desta migration:
-- no modo `grade`, `visto_em` só é escrito em linha INSERIDA ou ALTERADA (ver
-- `aInserir` em sincronizarGrade). A renovação periódica do carimbo
-- (`marcarVistas`, DIAS_REVALIDACAO = 7) existe apenas em `sincronizarExecucao`,
-- e o modo `grade` nunca a chama. Consequência: um dia futuro cuja grade não
-- mudou fica com `visto_em` antigo mesmo depois de um sync bem-sucedido —
-- verificado em 15/09 e 16/09, que após sync explícito voltaram "906 recebidos,
-- 906 inalterados, 0 escritas" e mantiveram o carimbo de 10/09.
--
-- Isso é correto para o sync (ele é idempotente de propósito, e o desenho evita
-- ~29 mil UPDATEs de carimbo por dia), mas torna `visto_em` um proxy IMPERFEITO
-- para o que o aviso "Grade desatualizada" quer medir: o banner mede "a TiTa
-- confirmou esta linha", e no futuro isso na prática vira "esta linha mudou".
-- Um período genuinamente estável acende o alarme sem haver falha. O alarme
-- ainda assim pegou a falha real de 10–14/09, porque ali NADA no futuro era
-- escrito; mas ele tem falso-positivo embutido, e a correção certa é o modo
-- `grade` passar a renovar o carimbo como o `execucao` já faz.
--
-- O timeout sobe de 120s para 150s: a chamada devolve a resposta assim que o
-- primeiro salto termina e dispara o resto em background via
-- EdgeRuntime.waitUntil, mas a 88s por fatia esse primeiro salto sozinho já
-- passa folgado dos 120s anteriores.
-- ============================================================================

create or replace function public.fn_sync_grade_csv_em_lotes()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoje        date := (now() at time zone 'America/Sao_Paulo')::date;
  v_token       text;
  v_tentativa   int;
  v_request_id  bigint;
  v_status_code int;
  v_error_msg   text;
  v_corpo       jsonb;
  v_corpo_ok    boolean;
  v_espera      int;
  v_ok          boolean := false;
  v_detalhe     text;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'cron_service_role_key';

  <<tentativas>>
  for v_tentativa in 1..3 loop
    v_status_code := null;
    v_error_msg   := null;
    v_corpo       := null;
    v_corpo_ok    := null;

    -- Body sem data_inicio/data_fim: a function aplica a janela padrão
    -- (hoje → fim do mês seguinte) e a fatia sozinha, um dia por chamada.
    v_request_id := net.http_post(
      url     := 'https://wmugemamnqxjfpxrlwes.supabase.co/functions/v1/sync-grade-csv',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_token,
        'Content-Type',  'application/json'
      ),
      body    := jsonb_build_object('modo', 'grade'),
      timeout_milliseconds := 150000
    );

    -- Espera síncrona pela resposta real (net.http_post só enfileira e retorna
    -- na hora). Poll a cada 2s por até 160s — 10s de folga sobre o
    -- timeout_milliseconds acima, para o pg_net terminar de gravar a linha de
    -- resposta mesmo quando a chamada expira no limite.
    for v_espera in 1..80 loop
      perform pg_sleep(2);
      select r.status_code, r.error_msg, r.content::jsonb
        into v_status_code, v_error_msg, v_corpo
        from net._http_response r
       where r.id = v_request_id;
      exit when v_status_code is not null or v_error_msg is not null;
    end loop;

    -- `ok` no corpo é o que a function usa para dizer "a janela inteira entrou":
    -- ela devolve 200 com ok=false/incompleto=true quando para no meio, e foi
    -- esse caso que passou batido por 4 rodadas. Corpo ilegível (resposta
    -- truncada, timeout antes do primeiro byte) conta como falha, não como
    -- sucesso — no escuro, o que não se pode afirmar não se assume.
    begin
      v_corpo_ok := (v_corpo ->> 'ok')::boolean;
    exception when others then
      v_corpo_ok := null;
    end;

    if v_status_code = 200 and v_corpo_ok then
      v_ok := true;
      exit tentativas;
    end if;

    -- Pequena pausa antes de tentar de novo — não faz sentido reatacar no mesmo
    -- instante em que acabou de falhar.
    if v_tentativa < 3 then
      perform pg_sleep(5);
    end if;
  end loop tentativas;

  if not v_ok then
    v_detalhe := coalesce(
      case
        when v_status_code = 200 and v_corpo_ok is not true
          then concat(
            'HTTP 200 porém incompleto (parou em ',
            coalesce(v_corpo ->> 'proximoDia', '?'),
            ', ', coalesce(v_corpo ->> 'diasProcessados', '?'),
            '/', coalesce(v_corpo ->> 'diasPedidos', '?'), ' dias)'
          )
        else null
      end,
      'HTTP ' || v_status_code::text,
      v_error_msg,
      'sem resposta'
    );

    with novo as (
      insert into public.alertas (
        modulo, regra_codigo, origem, entidade_tipo, entidade_id, entidade_ref,
        titulo, descricao, prioridade, status, setor_destino, fingerprint
      ) values (
        'sync', 'sync_grade_falhou', 'sistema', 'sync_grade_chunk',
        concat('janela_', v_hoje::text),
        jsonb_build_object(
          'modo', 'grade', 'hoje', v_hoje::text,
          'status_code', v_status_code, 'error_msg', v_error_msg,
          'corpo', v_corpo
        ),
        concat('Grade futura não sincronizou (rodada de ', v_hoje::text, ')'),
        concat(
          'As 3 tentativas falharam. Último resultado: ', v_detalhe,
          '. A grade FUTURA pode estar desatualizada — a Ocupação de Paciente vai '
          'ofertar horário já ocupado e esconder sessão recém-remarcada. '
          'Reexecute com: select public.fn_sync_grade_csv_em_lotes();'
        ),
        'alta', 'aberto', 'admin',
        -- Um alerta por rodada: a janela desliza a partir de "hoje", e cada dia
        -- que falhar merece o seu, não um só que nunca mais reabre.
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
      concat('Sistema detectou falha ao sincronizar a grade futura após 3 tentativas: ', v_detalhe)
    from novo;
  end if;
end;
$$;

comment on function public.fn_sync_grade_csv_em_lotes() is
  'Dispara UMA chamada à Edge Function sync-grade-csv no modo grade, sem fatiar: a function já se fatia em um dia por chamada e se reencadeia até fechar hoje → fim do mês seguinte. Espera a resposta real e só considera sucesso quando o CORPO traz ok=true (200 com ok=false significa rodada incompleta). Até 3 tentativas; se todas falharem, abre alerta em public.alertas (regra sync_grade_falhou). Ver o comentário no topo de 20260914120000 para o incidente que motivou a mudança.';
