-- =============================================================================
-- A janela do vínculo passa a comparar contra a data REAL do atendimento
-- =============================================================================
-- Fecha o trio de 20260916120000/120100/120200. Duas funções mudam.
--
-- A JANELA CONTINUA RETROATIVA
-- Não se abre `exec + N`. A regra segue sendo "a sessão é anterior ou igual à
-- data_execucao da guia", que é a semântica do domínio: a autorização ASSIM é
-- tirada no atendimento ou depois dele, nunca antes.
--
-- O que muda é CONTRA O QUE se compara. Até aqui a guarda olhava
-- data_atendimento — a data da AGENDA. Quando a sessão foi adiantada, essa data
-- é justamente a que NÃO descreve o atendimento. Passa a olhar
-- coalesce(data_atendimento_real, data_atendimento): para 100% das sessões
-- normais nada muda, e para a sessão adiantada a comparação passa a usar o dia
-- em que o atendimento de fato ocorreu.
--
-- No caso que originou (Davi Lucas): bloco de 16/09 com data real 15/09, guia
-- com data_execucao 15/09 08:26. Data efetiva 15/09 <= 15/09 → dentro da janela.
-- Sem a data real registrada, 16/09 > 15/09 → fora, como sempre foi.
--
-- POR QUE O generate_series PRECISA DE UM DIA A MAIS
-- get_candidatas_vinculo varre dia a dia por data de AGENDA, e o bloco adiantado
-- mora na data agendada (16/09), fora de [exec-7, exec]. Sem estender a varredura
-- ele nunca seria encontrado — a guarda estaria certa e a tela continuaria vazia.
--
-- A extensão é de 1 dia e só serve para ALCANÇAR o bloco; quem decide se ele
-- entra é o filtro pela data efetiva, logo abaixo. Uma sessão de 16/09 sem data
-- real registrada é varrida e descartada no mesmo statement.
--
-- Custo: 9 fatias em vez de 8 (+12,5%), sob o mesmo statement_timeout de 55s. Foi
-- o menor incremento que resolve o caso; 14 dias (o teto de
-- marcar_sessao_adiantada) custaria 22 fatias e não foi medido.
--
-- O statement_timeout de get_candidatas_vinculo é reposto explicitamente:
-- CREATE OR REPLACE FUNCTION descarta proconfig, e sem o SET a função voltaria ao
-- default e penduraria a tela na fatia patológica.
-- =============================================================================

-- =============================================================================
-- 1. get_candidatas_vinculo — alcança e filtra pela data efetiva
-- =============================================================================
-- DROP antes do CREATE porque o retorno ganha `data_atendimento_real`, e
-- CREATE OR REPLACE não muda tipo de retorno (42P13). Só esta função e as outras
-- duas cujo retorno mudou levam DROP; `vincular_autorizacao`, abaixo, mantém a
-- assinatura e é substituída em REPLACE.
drop function if exists public.get_candidatas_vinculo(text, integer);

create or replace function public.get_candidatas_vinculo(
  p_guia         text,
  p_janela_dias  integer default 7
)
returns table (
  bloco_id           text,
  paciente_id        text,
  paciente_nome      text,
  data_atendimento   date,
  hora_inicial       time without time zone,
  codigo_tuss        text,
  terapias           text,
  profissionais      text,
  quantidade_sessoes bigint,
  situacao           text,
  guia_atual         text,
  status_assim       text,
  motivo_glosa_codigo    text,
  motivo_glosa_descricao text,
  observacao         text,
  fila_id            uuid,
  distancia_horas    numeric,
  ja_vinculado       boolean,
  elegivel           boolean,
  data_atendimento_real date
)
language plpgsql
stable
security definer
set search_path = public
-- Abaixo do limite do gateway REST do Supabase. O caso típico são ~9 fatias de
-- 1-3s; o teto existe para a fatia patológica não pendurar a tela.
set statement_timeout = '55s'
as $$
declare
  v_g       record;
  v_empresa text;
  v_matric  text;
  v_dep     text;
  v_de      date;
  v_ate     date;
begin
  if p_janela_dias is null or p_janela_dias < 0 or p_janela_dias > 60 then
    raise exception 'Janela inválida: % (esperado 0..60)', p_janela_dias
      using errcode = '22023';
  end if;

  select aa.guia, aa.matricula, aa.data_execucao, aa.codigo_tuss, aa.status
    into v_g
  from public.autorizacoes_assim aa
  where aa.guia = p_guia;

  if not found then
    raise exception 'Guia % não existe em autorizacoes_assim', p_guia
      using errcode = 'P0002';
  end if;
  if v_g.data_execucao is null or v_g.codigo_tuss is null then
    raise exception 'Guia % sem data_execucao ou TUSS — não é reconciliável', p_guia
      using errcode = '22023';
  end if;

  v_empresa := split_part(v_g.matricula, '.', 1);
  v_matric  := split_part(v_g.matricula, '.', 2);
  v_dep     := split_part(v_g.matricula, '.', 3);
  v_ate     := date(v_g.data_execucao);
  v_de      := v_ate - p_janela_dias;

  return query
  with cand as (
    select
      a.bloco_id, a.paciente_id, a.paciente_nome, a.data_atendimento,
      a.hora_inicial, a.codigo_tuss, a.terapias, a.profissionais,
      a.quantidade_sessoes, a.situacao,
      a.guia         as guia_atual,
      a.status_assim,
      -- motivo_glosa da RPC já vem resolvido pelo de-para glosa_codigos; aqui só
      -- separamos código e texto com a mesma regra de frontend/lib/glosa.ts:27-40
      nullif(btrim(substring(coalesce(a.motivo_glosa, a.descricao_erro, '') from '^\s*(\d{3,5})\s*-')), '') as mg_cod,
      nullif(btrim(regexp_replace(coalesce(a.motivo_glosa, a.descricao_erro, ''), '^\s*\d{3,5}\s*-\s*', '')), '') as mg_desc,
      a.observacao
    -- +1 dia para ALCANÇAR o bloco de uma sessão adiantada, que mora na data
    -- agendada (posterior à execução da guia). Quem decide se ele entra é o
    -- filtro por data efetiva abaixo, não esta varredura.
    from generate_series(v_de, v_ate + 1, interval '1 day') g(dia)
    cross join lateral public.get_auditoria_assim_periodo(g.dia::date, g.dia::date) a
    where a.empresa     = v_empresa
      and a.matricula   = v_matric
      and a.dep         = v_dep
      and a.codigo_tuss = v_g.codigo_tuss
  ),
  cand_efetiva as (
    select c.*, coalesce(dr.data_atendimento_real, c.data_atendimento) as data_efetiva,
           dr.data_atendimento_real
    from cand c
    left join lateral (
      select f.data_atendimento_real
      from public.fila_autorizacoes f
      where f.paciente_id      = c.paciente_id
        and f.data_atendimento = c.data_atendimento
        and f.horario          = c.hora_inicial
        and f.data_atendimento_real is not null
      order by coalesce(f.updated_at, f.created_at) desc
      limit 1
    ) dr on true
  )
  select
    c.bloco_id,
    c.paciente_id,
    c.paciente_nome,
    c.data_atendimento,
    c.hora_inicial,
    c.codigo_tuss,
    c.terapias,
    c.profissionais,
    c.quantidade_sessoes,
    c.situacao,
    c.guia_atual,
    c.status_assim,
    c.mg_cod,
    c.mg_desc,
    c.observacao,
    fa.id as fila_id,
    -- Distância medida da data EFETIVA: numa sessão adiantada é ela que descreve
    -- quando o atendimento ocorreu, e é por ela que a ordenação faz sentido.
    round(extract(epoch from (v_g.data_execucao - (c.data_efetiva + c.hora_inicial))) / 3600.0, 2) as distancia_horas,
    (vin.guia is not null) as ja_vinculado,
    -- Elegível = ainda não coberta e ainda não vinculada. LIBERADA fica visível
    -- de propósito, marcada como não-elegível: é a informação que faz o operador
    -- perceber que a guia é extra e usar "sem sessão correspondente" (39% das
    -- órfãs medidas caem nesse caso).
    (vin.guia is null and c.situacao <> 'LIBERADA') as elegivel,
    c.data_atendimento_real
  from cand_efetiva c
  -- a linha da fila daquela sessão, pelos 4 campos naturais que a RPC usa
  -- (20260820150000:443-447)
  left join lateral (
    select f.id
    from public.fila_autorizacoes f
    where f.paciente_id      = c.paciente_id
      and f.data_atendimento = c.data_atendimento
      and f.tuss             = c.codigo_tuss
      and f.horario          = c.hora_inicial
    order by coalesce(f.updated_at, f.created_at) desc
    limit 1
  ) fa on true
  left join public.autorizacoes_vinculos vin
    on vin.bloco_id = c.bloco_id and vin.desfeito_em is null and vin.tipo = 'vinculo'
  -- A janela, agora sobre a data efetiva. Mesma regra retroativa de sempre: é o
  -- espelho exato da guarda 6 de vincular_autorizacao. Descarta o dia extra que
  -- o generate_series varreu sem ter data real.
  where c.data_efetiva between v_ate - p_janela_dias and v_ate
  order by
    case c.situacao
      when 'GLOSA'                  then 1
      when 'NAO_SOLICITADA'         then 2
      when 'RETORNO_NAO_CONFIRMADO' then 3
      when 'SINCRONIZANDO'          then 4
      when 'CANCELADA'              then 5
      else 6
    end,
    abs(extract(epoch from (v_g.data_execucao - (c.data_efetiva + c.hora_inicial)))),
    c.hora_inicial;
end;
$$;

comment on function public.get_candidatas_vinculo(text, integer) is
  'Sessões candidatas a receber a cobertura de uma guia órfã: mesmo beneficiário, mesmo TUSS, janela retroativa (default 7 dias, medido na Etapa 0) medida sobre coalesce(data_atendimento_real, data_atendimento). Varre um dia a mais para alcançar sessões adiantadas, que moram na data agendada. Nunca vincula — só ordena por relevância.';

grant execute on function public.get_candidatas_vinculo(text, integer) to authenticated;


-- =============================================================================
-- 2. vincular_autorizacao — a guarda 6 sobre a data efetiva
-- =============================================================================
-- Corpo idêntico a 20260821000000:541-678 exceto pela guarda 6. Recriado inteiro
-- porque é plpgsql: não há como trocar um IF sem reescrever a função.
create or replace function public.vincular_autorizacao(
  p_guia        text,
  p_bloco_id    text,
  p_fila_id     uuid    default null,
  p_observacao  text    default null,
  p_janela_dias integer default 7
)
returns uuid
language plpgsql
security definer
set search_path = public
set statement_timeout = '55s'
as $$
declare
  v_role   text := public.fn_usuario_role();
  v_uid    uuid := auth.uid();
  v_nome   text;
  v_g      record;
  v_b      record;
  v_pac    bigint;
  v_data   date;
  v_tuss   text;
  v_hora   time;
  v_gorig  text;
  v_id     uuid;
  v_efetiva date;
begin
  if v_role is null or v_role not in ('admin', 'autorizacao', 'recepcao') then
    raise exception 'Sem permissão para vincular autorizações'
      using errcode = '42501';
  end if;
  select nome into v_nome from public.usuarios where id = v_uid;

  -- 1) a guia existe, está liberada e não foi triada
  select aa.guia, aa.matricula, aa.data_execucao, aa.codigo_tuss, aa.status
    into v_g
  from public.autorizacoes_assim aa where aa.guia = p_guia;
  if not found then
    raise exception 'Guia % não existe em autorizacoes_assim', p_guia using errcode = 'P0002';
  end if;
  if v_g.status is distinct from 'Liberado' then
    raise exception 'Guia % não está liberada (status: %). Só autorização liberada cobre sessão.',
      p_guia, coalesce(v_g.status, '(nulo)') using errcode = '22023';
  end if;
  if v_g.data_execucao is null or v_g.codigo_tuss is null then
    raise exception 'Guia % sem data_execucao ou TUSS', p_guia using errcode = '22023';
  end if;
  if exists (select 1 from public.autorizacoes_vinculos v
             where v.guia = p_guia and v.desfeito_em is null) then
    raise exception 'Guia % já foi triada. Desfaça o vínculo atual antes de refazer.', p_guia
      using errcode = '23505';
  end if;

  -- 2) o bloco_id é bem formado. Formato: pacienteId_YYYY-MM-DD_TUSS_HH:MM:SS
  begin
    v_pac  := split_part(p_bloco_id, '_', 1)::bigint;
    v_data := split_part(p_bloco_id, '_', 2)::date;
    v_tuss := split_part(p_bloco_id, '_', 3);
    v_hora := split_part(p_bloco_id, '_', 4)::time;
  exception when others then
    raise exception 'bloco_id malformado: % (esperado pacienteId_YYYY-MM-DD_TUSS_HH:MM:SS)', p_bloco_id
      using errcode = '22023';
  end;

  -- 3) o bloco existe de fato na Conferência daquele dia
  select * into v_b
  from public.fn_blocos_assim(v_data, v_data) b
  where b.bloco_id = p_bloco_id;
  if not found then
    raise exception 'Bloco % não existe na Conferência de % (sessão inativa, reagendada ou fora do recorte ASSIM)',
      p_bloco_id, v_data using errcode = 'P0002';
  end if;

  -- 4) mesmo beneficiário
  if v_b.empresa   is distinct from split_part(v_g.matricula, '.', 1)
  or v_b.matricula is distinct from split_part(v_g.matricula, '.', 2)
  or v_b.dep       is distinct from split_part(v_g.matricula, '.', 3) then
    raise exception 'Beneficiário divergente: guia % é de %, bloco é de %.%.%',
      p_guia, v_g.matricula, v_b.empresa, v_b.matricula, v_b.dep using errcode = '22023';
  end if;

  -- 5) mesmo TUSS. A v.1 não reconcilia entre TUSS diferentes.
  if v_b.codigo_tuss is distinct from v_g.codigo_tuss then
    raise exception 'TUSS divergente: guia % é %, bloco é %',
      p_guia, v_g.codigo_tuss, v_b.codigo_tuss using errcode = '22023';
  end if;

  -- 6) dentro da janela retroativa permitida, medida sobre a data EFETIVA do
  --    atendimento. Numa sessão adiantada (20260916120000) a data da agenda não
  --    descreve quando o atendimento ocorreu; a data real, sim. A regra segue
  --    retroativa: não existe cobrir sessão que ainda não aconteceu.
  v_efetiva := coalesce(v_b.data_atendimento_real, v_b.data_atendimento);
  if v_efetiva > date(v_g.data_execucao)
  or v_efetiva < date(v_g.data_execucao) - p_janela_dias then
    raise exception 'Sessão de % fora da janela de % dias da autorização (%)',
      v_efetiva, p_janela_dias, date(v_g.data_execucao) using errcode = '22023';
  end if;

  -- 7) o bloco ainda não está coberto por outra guia
  if exists (select 1 from public.autorizacoes_vinculos v
             where v.bloco_id = p_bloco_id and v.desfeito_em is null and v.tipo = 'vinculo') then
    raise exception 'Sessão % já está coberta por outra guia', p_bloco_id
      using errcode = '23505';
  end if;

  -- 8) se veio fila_id, ela tem de ser a linha DAQUELE bloco. Sem esta guarda o
  --    rastro apontaria para a solicitação de outra sessão.
  if p_fila_id is not null then
    if not exists (
      select 1 from public.fila_autorizacoes f
      where f.id = p_fila_id
        and f.paciente_id::bigint = v_pac
        and f.data_atendimento    = v_data
        and f.tuss                = v_tuss
        and f.horario             = v_hora
    ) then
      raise exception 'fila_id % não corresponde ao bloco %', p_fila_id, p_bloco_id
        using errcode = '22023';
    end if;
  end if;

  -- guia_original: congelada agora, porque é o histórico da glosa que dá sentido
  -- ao vínculo e numero_autorizacao pode ser sobrescrito depois pelo sync.
  select f.numero_autorizacao into v_gorig
  from public.fila_autorizacoes f
  where f.paciente_id::bigint = v_pac
    and f.data_atendimento    = v_data
    and f.tuss                = v_tuss
    and f.horario             = v_hora
  order by coalesce(f.updated_at, f.created_at) desc
  limit 1;

  insert into public.autorizacoes_vinculos
    (guia, tipo, bloco_id, fila_id, guia_original, observacao,
     vinculado_por, vinculado_por_id)
  values
    (p_guia, 'vinculo', p_bloco_id, p_fila_id, v_gorig, nullif(btrim(p_observacao), ''),
     coalesce(v_nome, 'Usuário'), v_uid)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.vincular_autorizacao(text, text, uuid, text, integer) is
  'Vincula uma guia ASSIM órfã à sessão que ela cobre. Valida beneficiário, TUSS, janela e unicidade no servidor. A janela é retroativa e medida sobre coalesce(data_atendimento_real, data_atendimento). Não escreve em fila_autorizacoes nem em autorizacoes_assim.';

grant execute on function public.vincular_autorizacao(text, text, uuid, text, integer) to authenticated;
