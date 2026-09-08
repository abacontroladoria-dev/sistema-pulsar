-- ============================================================================
-- CONTRAPROVA — registrar_falta_em_lote / reverter_falta_em_lote
--
-- SÓ LEITURA (o único bloco que escreve é o 7, explicitamente marcado e com
-- rollback embutido). Rodar DEPOIS de aplicar 20260908100000 e 20260908100100,
-- e ANTES de qualquer uso real.
--
-- Cada bloco LANÇA em vez de devolver linha: um "select que parece ok" é como
-- uma contraprova passa sem provar nada.
--
-- ⚠ TROQUE :data_teste pela data que você vai conferir. Use um dia MOVIMENTADO
--   e real — um domingo vazio faz todos os blocos passarem sem testar nada
--   (o mesmo modo de falha do numero_autorizacao = 'N/A': join com zero match
--   imprime "OK").
-- ============================================================================

\set data_teste '2026-09-04'

-- ----------------------------------------------------------------------------
-- 0. As colunas e as funções existem
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='fila_autorizacoes'
                    and column_name='motivo_falta') then
    raise exception 'motivo_falta não existe — 20260908100000 não foi aplicada';
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='fila_autorizacoes'
                    and column_name='falta_lote_id') then
    raise exception 'falta_lote_id não existe — 20260908100000 não foi aplicada';
  end if;

  if to_regprocedure('public.registrar_falta_em_lote(date,text,text,text,text,time without time zone,text,boolean,uuid)') is null then
    raise exception 'registrar_falta_em_lote não existe — 20260908100100 não foi aplicada';
  end if;

  if to_regprocedure('public.reverter_falta_em_lote(uuid)') is null then
    raise exception 'reverter_falta_em_lote não existe — 20260908100100 não foi aplicada';
  end if;

  raise notice 'BLOCO 0 ok — colunas e funções presentes';
end $$;

-- ----------------------------------------------------------------------------
-- 1. O CHECK do motivo realmente recusa lixo
--
-- Sem este bloco, um CHECK escrito errado (ex.: com `or true`) passaria
-- despercebido e a lista fechada não seria fechada coisa nenhuma.
-- ----------------------------------------------------------------------------
do $$
begin
  begin
    -- Linha impossível de verdade: se o INSERT passar, o CHECK não está valendo.
    insert into public.fila_autorizacoes
      (paciente_id, paciente_nome, data_atendimento, horario, status, motivo_falta)
    values ('-1', '__contraprova__', date '1900-01-01', time '00:00', 'falta', 'motivo_que_nao_existe');

    raise exception 'chk_motivo_falta NÃO está valendo — aceitou um motivo fora da lista';
  exception
    when check_violation then
      raise notice 'BLOCO 1 ok — chk_motivo_falta recusa motivo fora da lista';
  end;
  -- Nada a limpar: o insert falhou. Mas garantimos, por segurança.
  delete from public.fila_autorizacoes where paciente_nome = '__contraprova__';
end $$;

-- ----------------------------------------------------------------------------
-- 2. O dry-run NÃO escreve
--
-- É a premissa de tudo: a tela chama o dry-run a cada clique em Salvar. Se ele
-- escrever, cada abertura de confirmação lançaria faltas de verdade.
-- ----------------------------------------------------------------------------
do $$
declare
  antes  bigint;
  depois bigint;
  r      jsonb;
begin
  select count(*) into antes from public.fila_autorizacoes;

  r := public.registrar_falta_em_lote(
         p_data          => :'data_teste'::date,
         p_motivo        => 'feriado',
         p_justificativa => 'contraprova — dry-run não deve escrever',
         p_dry_run       => true);

  select count(*) into depois from public.fila_autorizacoes;

  if antes <> depois then
    raise exception 'DRY-RUN ESCREVEU: % linhas viraram %. Isso é grave.', antes, depois;
  end if;

  if (r->>'dry_run')::boolean is not true then
    raise exception 'dry_run não voltou true no retorno: %', r;
  end if;

  raise notice 'BLOCO 2 ok — dry-run não escreveu. Recorte: % aplicáveis, % ignoradas %',
    r->>'aplicadas', r->>'ignoradas', r->>'ignoradas_por_motivo';
end $$;

-- ----------------------------------------------------------------------------
-- 3. O dia escolhido tem movimento — SE FALHAR, TROQUE A DATA
--
-- Este bloco existe para impedir o falso positivo mais provável desta
-- contraprova: rodar tudo contra um dia sem sessão nenhuma e concluir que está
-- tudo certo.
-- ----------------------------------------------------------------------------
do $$
declare
  r jsonb;
  n int;
begin
  r := public.registrar_falta_em_lote(
         p_data          => :'data_teste'::date,
         p_motivo        => 'feriado',
         p_justificativa => 'contraprova',
         p_dry_run       => true);

  n := (r->>'aplicadas')::int + (r->>'ignoradas')::int;

  if n = 0 then
    raise exception
      'A data % não tem NENHUM slot elegível nem ignorado. Os outros blocos passariam sem testar nada — escolha um dia movimentado.',
      :'data_teste';
  end if;

  raise notice 'BLOCO 3 ok — % slots no recorte (% aplicáveis + % ignoradas)',
    n, r->>'aplicadas', r->>'ignoradas';
end $$;

-- ----------------------------------------------------------------------------
-- 4. Materializa o recorte para inspeção e para o bloco 5
--
-- Espelha as CTEs da função com um nome estável nesta sessão (a temp table da
-- própria função é ON COMMIT DROP e não sobrevive até aqui). Serve também para
-- olhar o recorte com o olho, paciente por paciente, com a tela aberta ao lado.
-- ----------------------------------------------------------------------------
drop table if exists _lote_slots_debug;

create temp table _lote_slots_debug as
with
usuario_atual as (
  select (select unidades from public.usuarios where id = auth.uid()) as unidades
),
fallback_pat as (
  select
    p.paciente_id, ag.cpf, ag.data_nascimento, ag.convenio_id, ag.convenio_nome,
    ag.numero_carteirinha,
    substring(ag.numero_carteirinha, 1, 6)                         as empresa,
    substring(ag.numero_carteirinha, 7, 7)                         as matricula,
    right(regexp_replace(ag.numero_carteirinha, '\D', '', 'g'), 2) as dep
  from (
    select distinct paciente_id
    from   public.agenda_tita_autorizacao
    where  data_atendimento = :'data_teste'::date
      and  (cpf is null or numero_carteirinha is null or convenio_id is null)
  ) p
  cross join lateral (
    select cpf, data_nascimento, convenio_id, convenio_nome, numero_carteirinha
    from   public.agenda_tita
    where  paciente_id = p.paciente_id
      and  (cpf is not null or numero_carteirinha is not null)
    order by (origem = 'grade') desc,
             (cpf is not null and numero_carteirinha is not null) desc,
             updated_at desc
    limit 1
  ) ag
),
raw_slots as (
  select
    ag.paciente_id, ag.paciente_nome, ag.data_atendimento, ag.hora_inicial,
    ag.terapia_nome, ag.sala_nome, ag.codigo_tuss,
    coalesce(ag.convenio_nome, fp.convenio_nome) as convenio_nome,
    coalesce(ag.matricula,     fp.matricula)     as matricula,
    coalesce(ag.dep,           fp.dep)           as dep
  from public.agenda_tita_autorizacao ag
  left join fallback_pat fp on fp.paciente_id = ag.paciente_id
  cross join usuario_atual ua
  where ag.data_atendimento = :'data_teste'::date
    and lower(coalesce(ag.terapia_nome, '')) <> all (array[
          'aplicador aba escola','aplicador aba casa','aplicador suporte',
          'apoio operacional','especialista técnico de área','estágio',
          'facilitador técnico','operações clínicas','supervisão aba',
          'técnico terapêutico particular','triagem'])
    and lower(coalesce(ag.paciente_nome, '')) <> 'horário bloqueado'
    and lower(coalesce(ag.sala_nome,     '')) not like '%sala teste%'
    and lower(coalesce(ag.terapia_nome, '')) <> all (array[
          'equoterapia','fisioterapia aquática','fisioterapia aquatica'])
    and (ua.unidades is null or cardinality(ua.unidades) = 0
         or exists (select 1 from unnest(ua.unidades) un
                    where ag.sala_nome ilike '%' || un || '%'))
),
ma_blocos as (
  select rs.paciente_id, rs.data_atendimento, rs.hora_inicial, rs.codigo_tuss,
         rs.matricula, rs.dep,
         row_number() over (partition by rs.matricula, rs.dep,
                                         rs.data_atendimento, rs.codigo_tuss
                            order by rs.hora_inicial) as ordem_consumo
  from raw_slots rs
  group by rs.paciente_id, rs.data_atendimento, rs.hora_inicial,
           rs.codigo_tuss, rs.matricula, rs.dep
),
ma_consumos_falta as (
  select distinct bo.matricula, bo.dep, bo.data_atendimento,
                  bo.codigo_tuss, bo.ordem_consumo
  from ma_blocos bo
  join public.fila_autorizacoes fa
    on  fa.matricula         = bo.matricula
    and coalesce(fa.dep,'')  = coalesce(bo.dep,'')
    and fa.data_atendimento  = bo.data_atendimento
    and fa.horario           = bo.hora_inicial
    and fa.tuss              = bo.codigo_tuss
    and fa.status            = 'falta'
),
ma_auths as (
  select aa.matricula_limpa as matricula, right(aa.matricula,2) as dep,
         aa.codigo_tuss, date(aa.data_execucao) as data_atendimento,
         row_number() over (partition by aa.matricula_limpa, right(aa.matricula,2),
                                         date(aa.data_execucao), aa.codigo_tuss
                            order by aa.data_execucao) as ordem_autorizacao
  from public.autorizacoes_assim aa
  where date(aa.data_execucao) = :'data_teste'::date
    and not exists (
      select 1 from public.fila_autorizacoes fa
      where fa.numero_autorizacao = aa.guia
        and fa.data_atendimento between (date(aa.data_execucao) - 7)
                                    and (date(aa.data_execucao) + 7))
),
match_assim as (
  select bo.paciente_id, bo.data_atendimento, bo.hora_inicial as horario, bo.codigo_tuss
  from ma_blocos bo
  join ma_auths an
    on  an.matricula         = bo.matricula
    and coalesce(an.dep,'')  = coalesce(bo.dep,'')
    and an.data_atendimento  = bo.data_atendimento
    and an.codigo_tuss       = bo.codigo_tuss
    and an.ordem_autorizacao = bo.ordem_consumo
  union
  select bo.paciente_id, bo.data_atendimento, bo.hora_inicial as horario, bo.codigo_tuss
  from ma_blocos bo
  join ma_consumos_falta cf
    on  cf.matricula         = bo.matricula
    and coalesce(cf.dep,'')  = coalesce(bo.dep,'')
    and cf.data_atendimento  = bo.data_atendimento
    and cf.codigo_tuss       = bo.codigo_tuss
    and cf.ordem_consumo     = bo.ordem_consumo
),
ultima_fila as (
  select distinct on (paciente_id, data_atendimento, horario, tuss)
         id, paciente_id, data_atendimento, horario, tuss, status
  from public.fila_autorizacoes
  where data_atendimento = :'data_teste'::date
  order by paciente_id, data_atendimento, horario, tuss, created_at desc
)
select
  rs.paciente_id, rs.paciente_nome, rs.hora_inicial, rs.terapia_nome,
  rs.codigo_tuss, rs.sala_nome, rs.convenio_nome,
  uf.id as fila_id, uf.status as fila_status,
  case
    when ma.paciente_id is not null                then 'autorizado_externo'
    when uf.status = 'falta'                       then 'falta'
    when uf.status = 'concluido'                   then 'concluido'
    when uf.status = 'concluido_sem_guia'          then 'concluido_sem_guia'
    when uf.status = 'glosa'                       then 'glosa'
    when uf.status in ('processando','executando') then 'em_processamento'
    else null
  end as motivo_ignorada
from raw_slots rs
left join ultima_fila uf
  on  uf.paciente_id::bigint = rs.paciente_id
  and uf.data_atendimento    = rs.data_atendimento
  and uf.horario             = rs.hora_inicial
  and uf.tuss                = rs.codigo_tuss
left join match_assim ma
  on  ma.paciente_id      = rs.paciente_id
  and ma.data_atendimento = rs.data_atendimento
  and ma.horario          = rs.hora_inicial
  and ma.codigo_tuss      = rs.codigo_tuss;

-- Olhe com o olho, lado a lado com a /solicitar aberta na mesma data:
select motivo_ignorada, count(*) as n
from _lote_slots_debug
group by motivo_ignorada
order by n desc;

select paciente_nome, hora_inicial, terapia_nome, sala_nome, motivo_ignorada
from _lote_slots_debug
order by hora_inicial, paciente_nome
limit 50;

-- ----------------------------------------------------------------------------
-- 5. A contagem bate com a tela  ← ESTE É O TESTE CENTRAL
--
-- Compara o que a RPC de lote considera elegível com o que a /solicitar mostra.
-- A tela agrupa por (paciente, data, horário) e o lote conta por slot
-- (paciente, data, horário, tuss), então a comparação correta é: os PARES
-- (paciente, horário) do lote têm de ser exatamente os cards visíveis.
--
-- Divergência aqui significa que a replicação da elegibilidade saiu errada —
-- é o bug mais caro possível nesta funcionalidade, porque lançaria falta em
-- sessão que a recepção nunca viu.
--
-- ⚠ Rode este bloco COMO UMA RECEPCIONISTA (via a aplicação ou com o JWT dela),
--   não como service_role: auth.uid() nulo desliga o filtro de unidade dos dois
--   lados e a comparação vira trivial.
-- ----------------------------------------------------------------------------
do $$
declare
  so_na_tela int;
  so_no_lote int;
begin
  -- Cards visíveis na /solicitar que NÃO aparecem como elegíveis no lote
  select count(*) into so_na_tela
  from (
    select c.paciente_id, c.horario
    from public.listar_central_autorizacoes(:'data_teste'::date) c
    where c.mostrar_na_tela
      -- a tela também esconde estas por TERAPIAS_OCULTAS, no cliente
      and not exists (
        select 1 from unnest(c.terapias) t
        where lower(t) in ('equoterapia','fisioterapia aquática','fisioterapia aquatica'))
    except
    select s.paciente_id, s.hora_inicial
    from _lote_slots_debug s
    where s.motivo_ignorada is null
  ) q;

  -- Elegíveis do lote que NÃO estão visíveis na tela  ← o lado perigoso
  select count(*) into so_no_lote
  from (
    select s.paciente_id, s.hora_inicial
    from _lote_slots_debug s
    where s.motivo_ignorada is null
    except
    select c.paciente_id, c.horario
    from public.listar_central_autorizacoes(:'data_teste'::date) c
    where c.mostrar_na_tela
      and not exists (
        select 1 from unnest(c.terapias) t
        where lower(t) in ('equoterapia','fisioterapia aquática','fisioterapia aquatica'))
  ) q;

  if so_no_lote > 0 then
    raise exception
      'PERIGO: % sessão(ões) seriam marcadas em lote mas NÃO aparecem na /solicitar. A elegibilidade do lote está mais larga que a da tela.',
      so_no_lote;
  end if;

  if so_na_tela > 0 then
    raise warning
      '% card(s) visíveis na tela ficariam de fora do lote. Menos grave (o lote pula), mas investigue: pode ser slot já em falta parcial.',
      so_na_tela;
  end if;

  raise notice 'BLOCO 5 ok — o recorte do lote não extrapola o que a tela mostra';
end $$;

-- ----------------------------------------------------------------------------
-- 6. Os números da RPC batem com o recorte materializado
--
-- Se divergirem, a função e esta contraprova saíram do ar uma da outra — e a
-- contraprova deixa de provar qualquer coisa a partir daqui.
-- ----------------------------------------------------------------------------
do $$
declare
  r          jsonb;
  n_elegivel int;
  n_ignorada int;
begin
  r := public.registrar_falta_em_lote(
         p_data => :'data_teste'::date, p_motivo => 'feriado',
         p_justificativa => 'contraprova', p_dry_run => true);

  select count(*) filter (where motivo_ignorada is null),
         count(*) filter (where motivo_ignorada is not null)
    into n_elegivel, n_ignorada
  from _lote_slots_debug;

  if (r->>'aplicadas')::int <> n_elegivel then
    raise exception 'RPC diz % aplicáveis, o recorte materializado diz %. Divergiram.',
      r->>'aplicadas', n_elegivel;
  end if;

  if (r->>'ignoradas')::int <> n_ignorada then
    raise exception 'RPC diz % ignoradas, o recorte materializado diz %. Divergiram.',
      r->>'ignoradas', n_ignorada;
  end if;

  raise notice 'BLOCO 6 ok — RPC e recorte concordam (% aplicáveis, % ignoradas)',
    n_elegivel, n_ignorada;
end $$;

-- ============================================================================
-- 7. ⚠ ESTE BLOCO ESCREVE — ensaio de ida e volta
--
-- Rode só quando os blocos 0-6 tiverem passado. Usa uma data FUTURA e um
-- horário específico para manter o raio pequeno, aplica de verdade e reverte
-- em seguida, conferindo os dois lados.
--
-- Ajuste :data_ensaio para um dia futuro COM movimento na grade (D+30 costuma
-- servir) e :hora_ensaio para um horário que exista nesse dia.
-- ============================================================================
\set data_ensaio '2026-10-08'
\set hora_ensaio '08:00'

-- Descomente o bloco abaixo para rodar o ensaio.
/*
do $$
declare
  r_prev  jsonb;
  r_apl   jsonb;
  r_rev   jsonb;
  v_lote  uuid;
  n_falta int;
begin
  r_prev := public.registrar_falta_em_lote(
              p_data => :'data_ensaio'::date, p_motivo => 'feriado',
              p_justificativa => 'ensaio de contraprova — reverter em seguida',
              p_horario => :'hora_ensaio'::time, p_dry_run => true);

  if (r_prev->>'aplicadas')::int = 0 then
    raise exception 'O ensaio não tem o que aplicar em % às %. Escolha outra data/hora — senão o teste passa sem testar.',
      :'data_ensaio', :'hora_ensaio';
  end if;

  v_lote := (r_prev->>'lote_id')::uuid;
  raise notice 'ENSAIO: vai aplicar % faltas (lote %)', r_prev->>'aplicadas', v_lote;

  r_apl := public.registrar_falta_em_lote(
             p_data => :'data_ensaio'::date, p_motivo => 'feriado',
             p_justificativa => 'ensaio de contraprova — reverter em seguida',
             p_horario => :'hora_ensaio'::time, p_dry_run => false,
             p_lote_id => v_lote);

  if (r_apl->>'aplicadas')::int <> (r_prev->>'aplicadas')::int then
    raise warning 'Dry-run previu % e a aplicação escreveu %. Alguém mexeu na fila no meio, ou o dry-run mente.',
      r_prev->>'aplicadas', r_apl->>'aplicadas';
  end if;

  -- Conferência: as linhas existem, com motivo e lote corretos?
  select count(*) into n_falta
  from public.fila_autorizacoes
  where falta_lote_id = v_lote and status = 'falta' and motivo_falta = 'feriado';

  if n_falta <> (r_apl->>'aplicadas')::int then
    raise exception 'Escreveu % mas só % linhas têm lote+status+motivo corretos.',
      r_apl->>'aplicadas', n_falta;
  end if;

  raise notice 'ENSAIO ok na ida — % linhas com falta_lote_id, status falta e motivo feriado', n_falta;

  -- Volta
  r_rev := public.reverter_falta_em_lote(v_lote);

  if (r_rev->>'revertidas')::int <> n_falta then
    raise exception 'Aplicou % e reverteu % — a reversão não pegou tudo.',
      n_falta, r_rev->>'revertidas';
  end if;

  if exists (select 1 from public.fila_autorizacoes where falta_lote_id = v_lote) then
    raise exception 'Sobrou linha com falta_lote_id = % depois da reversão.', v_lote;
  end if;

  raise notice 'ENSAIO ok na volta — % linhas revertidas para cancelado, nenhuma sobra', r_rev->>'revertidas';
  raise notice 'ATENÇÃO: as linhas revertidas ficaram como cancelado (não pendente), por desenho. Confira na /solicitar que elas reapareceram.';
end $$;
*/
