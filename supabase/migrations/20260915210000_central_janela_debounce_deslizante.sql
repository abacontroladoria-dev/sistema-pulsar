-- ============================================================================
-- Central: a janela de agrupamento passa a DESLIZAR
--
-- O DEFEITO
--
-- A fila de agrupamento sempre teve debounce, mas a janela era FIXA POR LINHA:
-- `process_after` nascia com `now() + 15 segundos` (20260701010000, linha 324) e
-- nada a movia depois. Cada mensagem carregava o próprio relógio.
--
-- Na prática, com o responsável mandando o nome e, 3 segundos depois, a data:
--
--   00:00  "Maria Silva"      -> elegivel as 00:15
--   00:03  "pode ser terca"   -> elegivel as 00:18
--   00:16  worker roda, reivindica SO a primeira, gera e ENVIA a resposta
--   00:19  worker roda, reivindica a segunda, e responde DE NOVO
--
-- Duas respostas para um pensamento só. O agrupamento por remetente existe no
-- worker (agrupamento.worker.ts), mas ele só junta o que caiu no MESMO claim —
-- e nesse exemplo as duas linhas nunca caem no mesmo. Daí o sintoma ser
-- intermitente: quando as duas mensagens vencem dentro do mesmo tique, vira uma
-- resposta só; quando não, viram duas.
--
-- A CORREÇÃO
--
-- Toda mensagem nova reinicia o relógio de TODAS as pendentes do mesmo
-- remetente. Enquanto a pessoa estiver digitando, a janela é empurrada para
-- frente; quando ela para, tudo vence junto e vira um turno só. É o que faz a
-- atendente responder como quem esperou a frase terminar.
--
-- A janela cai de 15s para 8s: com a janela deslizando, esperar 15s depois da
-- ÚLTIMA mensagem é lento sem necessidade — os 15s existiam para cobrir o
-- intervalo entre a primeira e a última, o que agora o deslizamento faz.
--
-- POR QUE UMA RPC, E NÃO UPSERT + UPDATE NA ROTA
--
-- Inserir e empurrar precisam ser ATÔMICOS. Em dois round-trips, um processo
-- que morre no meio deixa a linha nova com a janela nova e a antiga com a
-- antiga — exatamente o defeito que esta migration corrige, agora de forma
-- intermitente e mais difícil de enxergar. E seria latência extra no caminho
-- crítico do webhook, onde a Meta reentrega se demorarmos.
--
-- POR QUE NÃO UM TRIGGER
--
-- Funcionaria, e seria impossível de contornar. Mas teria de ser FOR EACH
-- STATEMENT (com trigger de linha, as N linhas do mesmo lote empurrariam umas
-- às outras em cascata), e esconderia comportamento temporal de quem lê a rota.
-- Uma função nomeada, chamada explicitamente, diz o que faz.
--
-- CONCORRÊNCIA — por que não há lock novo aqui
--
-- O UPDATE de empurrão e o `for update skip locked` do claim disputam a mesma
-- linha, e as duas ordens possíveis já são seguras:
--
--   claim primeiro: o UPDATE bloqueia até o commit do claim, reavalia, e
--     encontra a linha em 'processing' — o `status = 'pending'` do predicado a
--     descarta. É exatamente o que se quer: mensagem JÁ EM PROCESSAMENTO não
--     pode ter a janela empurrada, senão o item ficaria preso enquanto o turno
--     que o consome já está rodando.
--   empurrão primeiro: o claim vê a linha travada, faz SKIP LOCKED e não a
--     reivindica neste lote. Correto — a janela acabou de ser estendida.
--
-- É POR ISSO que o predicado do UPDATE diz `status = 'pending'` e não
-- `status in ('pending','processing')`. Alargar esse predicado quebraria a
-- garantia acima; não alargue.
--
-- O empurrão não toca `attempts` nem `claimed_at`. Nada é sepultado por ter
-- sido adiado: o sepultamento em claim_message_grouping_batch só olha itens em
-- 'processing'.
--
-- DUAS CONSEQUÊNCIAS DELIBERADAS
--
-- 1. NÃO HÁ TETO DE ESPERA. Quem mandar uma mensagem a cada 7 segundos adia a
--    resposta indefinidamente. Com a janela em 8s isso deixa de ser teórico.
--    Ficou de fora por decisão de escopo; o lugar de corrigir é aqui, com um
--    `least(now() + janela, primeira_chegada + teto)`.
--
-- 2. `updated_at` DEIXA DE SIGNIFICAR "última transição de status": o trigger
--    set_updated_at dispara no empurrão também. Quem for diagnosticar a fila
--    pelo updated_at precisa saber disso.
--
-- O QUE ESTA MIGRATION NÃO RESOLVE
--
-- Se a linha A já estiver em 'processing' (turno em andamento na OpenAI) quando
-- B chegar, B fica para o turno seguinte e saem duas respostas. O deslizamento
-- encolhe essa fresta de 15s+ para o tempo de um turno, mas não a fecha. Fechá-la
-- é uma barreira no worker, não na fila — outro trabalho.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. O remetente vira coluna
--
-- Ele mora em `message_data->>'from'`, e um predicado sobre jsonb não se indexa
-- bem dentro de um índice composto. `generated always as ... stored` mantém a
-- coluna sempre de acordo com o payload — não há caminho de escrita que possa
-- discordar dela.
-- ----------------------------------------------------------------------------
alter table central.message_grouping_queue
  add column if not exists sender_key text
    generated always as (message_data ->> 'from') stored;

comment on column central.message_grouping_queue.sender_key is
  'Remetente extraido de message_data->>''from''. Chave do debounce deslizante: mensagem nova empurra a janela das pendentes do mesmo remetente.';

-- Índice parcial: só 'pending' interessa ao empurrão, e é a fatia pequena da
-- tabela. A expressão casa com a do predicado em enqueue_grouping_messages, que
-- compara o par (remetente, nosso número) concatenado — um índice sobre as duas
-- colunas soltas não seria usado por aquele `= any(...)`.
create index if not exists idx_grouping_debounce
  on central.message_grouping_queue (
    organization_id,
    ((sender_key || E'' || phone_number_id))
  )
  where status = 'pending';

-- ----------------------------------------------------------------------------
-- 2. A janela encolhe para 8 segundos
--
-- O default vale para qualquer insert que NÃO passe pela RPC (teste, correção à
-- mão). A RPC usa o mesmo valor, escrito uma vez só, logo abaixo.
-- ----------------------------------------------------------------------------
alter table central.message_grouping_queue
  alter column process_after set default now() + interval '8 seconds';

-- ----------------------------------------------------------------------------
-- 3. enqueue_grouping_messages — insere e empurra, na mesma transação
--
-- Devolve `inseridas` (o upsert com ignoreDuplicates escondia isso) e o novo
-- `process_after` do lote. O segundo não é enfeite: é o que o despachante em
-- Node usa para agendar o worker. Sem ele, o Node teria de repetir o "8" e os
-- dois relógios sairiam de acordo no dia em que a janela mudasse.
--
-- `on conflict do nothing` preserva a idempotência que hoje vem de
-- uq_grouping_wa_msg (20260810120100). E tem um efeito que importa: a REENTREGA
-- da Meta não insere nada, então também NÃO deve empurrar a janela — por isso o
-- UPDATE olha apenas os remetentes das linhas efetivamente inseridas.
-- ----------------------------------------------------------------------------
create or replace function central.enqueue_grouping_messages(
  p_organization_id uuid,
  p_rows            jsonb,
  p_janela          interval default '8 seconds'
)
returns table (inseridas integer, process_after timestamptz)
language plpgsql
security definer
set search_path = central, public
as $$
declare
  v_inseridas integer;
  v_prazo     timestamptz;
  -- Pares (remetente, nosso número) efetivamente inseridos neste lote, como um
  -- array de registros. Uma tabela temporária serviria, mas obrigaria a limpá-la
  -- entre chamadas na mesma transação — e um `delete` sem WHERE esbarra no guard
  -- do repositório. Arrays não têm estado entre chamadas: nascem e morrem com a
  -- execução.
  --
  -- Par, e não dois arrays paralelos: `array_agg(distinct a)` e
  -- `array_agg(distinct b)` separados perdem a correspondência entre os dois e
  -- o empurrão viraria produto cartesiano — empurraria a janela de um remetente
  -- num número em que ele não escreveu.
  v_pares     text[];
begin
  -- Uma linha por MENSAGEM inserida (a reentrega cai no `do nothing` e não
  -- aparece aqui) — é o que faz `inseridas` contar mensagens, e não remetentes
  -- distintos.
  --
  -- `insert ... returning` só pode ser consumido como CTE: Postgres não aceita
  -- comando de escrita numa subquery de FROM.
  with novas as (
    insert into central.message_grouping_queue (
      organization_id,
      whatsapp_message_id,
      phone_number_id,
      message_data,
      contacts_data,
      process_after
    )
    select
      p_organization_id,
      r.whatsapp_message_id,
      r.phone_number_id,
      r.message_data,
      r.contacts_data,
      now() + p_janela
    from jsonb_to_recordset(p_rows) as r (
      whatsapp_message_id text,
      phone_number_id     text,
      message_data        jsonb,
      contacts_data       jsonb
    )
    on conflict (organization_id, whatsapp_message_id) do nothing
    returning sender_key, phone_number_id
  )
  -- O par vira um texto com separador , que não ocorre em telefone nem em
  -- phone_number_id. O mesmo par do outro lado é montado igual, então a
  -- comparação é exata.
  select
    count(*)::integer,
    array_agg(distinct sender_key || E'' || phone_number_id)
  into v_inseridas, v_pares
  from novas;

  -- Nada entrou: reentrega pura. Não empurra janela de ninguém, e devolve o
  -- prazo que já existe para o despachante não agendar cedo demais.
  if v_inseridas = 0 then
    return query
      select 0, max(q.process_after)
      from central.message_grouping_queue q
      where q.organization_id = p_organization_id
        and q.status = 'pending';
    return;
  end if;

  -- O EMPURRÃO. `status = 'pending'` é o que protege o item já reivindicado —
  -- ver o bloco de concorrência no topo deste arquivo.
  --
  -- phone_number_id entra no predicado junto com o remetente: o mesmo número
  -- pode escrever para dois números nossos, e juntar as duas conversas num
  -- turno só seria pior que o defeito que estamos corrigindo.
  update central.message_grouping_queue q
  set process_after = now() + p_janela
  where q.organization_id = p_organization_id
    and q.status          = 'pending'
    and (q.sender_key || E'' || q.phone_number_id) = any (v_pares);

  select max(q.process_after)
    into v_prazo
  from central.message_grouping_queue q
  where q.organization_id = p_organization_id
    and q.status          = 'pending'
    and (q.sender_key || E'' || q.phone_number_id) = any (v_pares);

  return query select v_inseridas, v_prazo;
end;
$$;

comment on function central.enqueue_grouping_messages(uuid, jsonb, interval) is
  'Enfileira mensagens recebidas e DESLIZA a janela de debounce das pendentes do mesmo remetente. Atomica de proposito: insert e empurrao separados deixariam linhas com janelas diferentes. Devolve (inseridas, process_after) — o prazo alimenta o agendamento do worker em Node.';

-- ----------------------------------------------------------------------------
-- 4. Quem pode chamar
--
-- Só o webhook, que usa service_role. Nenhuma sessão de navegador tem motivo
-- para enfileirar mensagem recebida, e a função é `security definer`.
-- ----------------------------------------------------------------------------
revoke execute on function central.enqueue_grouping_messages(uuid, jsonb, interval)
  from public, anon, authenticated;

grant execute on function central.enqueue_grouping_messages(uuid, jsonb, interval)
  to service_role;
