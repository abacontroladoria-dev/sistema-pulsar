-- Grade (Cronograma) — Parte 2: capacidade na faixa e saída do profissional.
--
-- 1. CAPACIDADE NA FAIXA ("Pacientes por horário", padrão 1). Decisão do
--    usuário (07/10/2026): mora na faixa da disponibilidade, assim o mesmo
--    profissional pode ter manhã individual e tarde em grupo.
--    Hoje o número vive em cronograma_capacidade_profissional_dia (Indicadores →
--    Profissionais → "Quantidade esperada de pacientes", por nome × dia). A carga
--    abaixo copia esse número para as faixas das versões vigentes/agendadas. A
--    tabela antiga continua existindo e alimentando os Indicadores (próximo
--    passo: apontá-los para a faixa).
--
--    A faixa é IMUTÁVEL (gatilho trg_prof_disp_faixas_imutavel). A carga
--    desliga esse gatilho só durante o UPDATE, dentro desta transação, e grava
--    um evento 'carga_capacidade' por versão tocada. Depois disso a capacidade
--    só muda criando nova versão, como todo o resto da faixa.
--
--    ATENÇÃO na ordem de deploy: enquanto o frontend novo não sai, salvar uma
--    disponibilidade pela tela antiga cria a versão nova com capacidade 1 (a
--    tela não conhece o campo). Basta não salvar disponibilidade de quem tem
--    capacidade > 1 (Thiago, Rachel, Rosenilza, Ianca, Luiz Gustavo) até o
--    redeploy.
--
-- 2. DATA DE SAÍDA do profissional (profissionais.data_saida) e a RPC
--    profissional_inativar: o usuário escolhe MANTER (padrão; as sessões a
--    partir da saída aparecem na Grade como "precisa de reposição") ou EXCLUIR
--    as sessões a partir da saída. Sessão anterior à saída nunca é tocada.
--    Inativar pela tela antiga (só ativo = false) carimba data_saida = hoje;
--    reativar limpa data_saida.
--
-- Depende de 20261008100000. Idempotente.

-- ═════════════════════════════════════════════════════════════════════════════
-- A) Capacidade na faixa
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.profissionais_disponibilidade_faixas
  add column if not exists capacidade smallint not null default 1;

alter table public.profissionais_disponibilidade_faixas
  drop constraint if exists prof_disp_faixas_capacidade_check;
alter table public.profissionais_disponibilidade_faixas
  add constraint prof_disp_faixas_capacidade_check check (capacidade between 1 and 10);

comment on column public.profissionais_disponibilidade_faixas.capacidade is
  'Pacientes por horário nesta faixa (1 = individual; 2, 3… = grupo). Usada pela Grade para "disponível / parcial / lotado".';

alter table public.profissionais_disponibilidade_eventos
  drop constraint if exists prof_disp_eventos_tipo_check;
alter table public.profissionais_disponibilidade_eventos
  add constraint prof_disp_eventos_tipo_check
  check (tipo in ('criar', 'encerrar', 'alterar_vigencia', 'restaurar', 'substituir', 'antecipar', 'carga_capacidade'));

-- Carga: só faixas ainda com o padrão (1), de versões que valem hoje ou no
-- futuro e não foram substituídas. Reaplicar não muda nada (já não estão em 1).
do $$
declare
  r       record;
  v_total integer := 0;
begin
  create temporary table tmp_carga_cap on commit drop as
  select f.id as faixa_id, f.versao_id, v.profissional_id, f.dia_semana, c.capacidade
  from public.profissionais_disponibilidade_faixas f
  join public.profissionais_disponibilidade_versoes v on v.id = f.versao_id
  join public.profissionais p on p.id = v.profissional_id
  join public.cronograma_capacidade_profissional_dia c
    on public.normalizar_nome_paciente(c.profissional_nome) = public.normalizar_nome_paciente(p.nome)
   and c.dow = f.dia_semana
  where v.substituida_em is null
    and (v.vigente_ate is null or v.vigente_ate >= public.hoje_brasilia())
    and f.capacidade = 1
    and c.capacidade > 1;

  if exists (select 1 from tmp_carga_cap) then
    alter table public.profissionais_disponibilidade_faixas disable trigger trg_prof_disp_faixas_imutavel;

    update public.profissionais_disponibilidade_faixas f
       set capacidade = least(t.capacidade, 10)
      from tmp_carga_cap t
     where f.id = t.faixa_id;
    get diagnostics v_total = row_count;

    alter table public.profissionais_disponibilidade_faixas enable trigger trg_prof_disp_faixas_imutavel;

    for r in
      select versao_id, profissional_id,
             jsonb_agg(jsonb_build_object('dia_semana', dia_semana, 'capacidade', capacidade) order by dia_semana) as faixas
      from tmp_carga_cap
      group by versao_id, profissional_id
    loop
      insert into public.profissionais_disponibilidade_eventos
        (profissional_id, versao_id, tipo, depois, motivo, usuario_nome)
      values (
        r.profissional_id, r.versao_id, 'carga_capacidade',
        jsonb_build_object('faixas', r.faixas),
        'Capacidade copiada de "Quantidade esperada de pacientes" (Indicadores) na criação da Grade.',
        'Migração da Grade'
      );
    end loop;
  end if;

  raise notice 'Capacidade copiada para % faixa(s).', v_total;

  -- Quem tem capacidade > 1 nos Indicadores mas não casou com nenhuma faixa
  -- (sem disponibilidade cadastrada ou nome diferente): só avisa.
  for r in
    select distinct c.profissional_nome
    from public.cronograma_capacidade_profissional_dia c
    where c.capacidade > 1
      and not exists (
        select 1
        from public.profissionais p
        join public.profissionais_disponibilidade_versoes v on v.profissional_id = p.id
        join public.profissionais_disponibilidade_faixas f on f.versao_id = v.id and f.dia_semana = c.dow
        where public.normalizar_nome_paciente(p.nome) = public.normalizar_nome_paciente(c.profissional_nome)
          and v.substituida_em is null
          and (v.vigente_ate is null or v.vigente_ate >= public.hoje_brasilia())
      )
  loop
    raise notice 'Sem faixa para receber a capacidade: % (cadastre a disponibilidade e informe "Pacientes por horário").', r.profissional_nome;
  end loop;
end $$;

-- Gravação de faixas: passa a aceitar `capacidade` (1–10, padrão 1). Corpo
-- igual a 20261006140000 + a coluna nova.
create or replace function public.sp_prof_disp_gravar_faixas(
  p_versao_id       uuid,
  p_profissional_id bigint,
  p_faixas          jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  f            jsonb;
  t            jsonb;
  v_faixa_id   uuid;
  v_local      record;
  v_terapia    record;
  v_ini        time;
  v_fim        time;
  v_dur        smallint;
  v_cap        smallint;
  v_int        boolean;
  v_int_ini    time;
  v_int_fim    time;
  v_util       integer;
  v_n          integer := 0;
  v_conflito   record;
begin
  if jsonb_typeof(p_faixas) is distinct from 'array' then
    raise exception 'Faixas em formato inválido.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_faixas) > 60 then
    raise exception 'Faixas demais numa versão (máximo 60).' using errcode = '22023';
  end if;

  for f in select * from jsonb_array_elements(p_faixas) loop
    v_ini := (f ->> 'hora_inicio')::time;
    v_fim := (f ->> 'hora_fim')::time;
    v_dur := coalesce((f ->> 'duracao_min')::smallint, 40);
    v_cap := coalesce((f ->> 'capacidade')::smallint, 1);
    v_int := coalesce((f ->> 'intervalo_ativo')::boolean, false);
    v_int_ini := case when v_int then (f ->> 'intervalo_inicio')::time end;
    v_int_fim := case when v_int then (f ->> 'intervalo_fim')::time end;

    if v_cap not between 1 and 10 then
      raise exception 'Pacientes por horário deve ficar entre 1 e 10.' using errcode = '22023';
    end if;

    -- Tempo útil = faixa menos intervalo; precisa caber ao menos uma sessão.
    v_util := (extract(epoch from (v_fim - v_ini)) / 60)::integer
              - case when v_int and v_int_fim > v_int_ini
                     then (extract(epoch from (v_int_fim - v_int_ini)) / 60)::integer else 0 end;
    if v_fim > v_ini and v_util < v_dur then
      raise exception 'A faixa % – % não comporta nenhuma sessão de % min.',
        to_char(v_ini, 'HH24:MI'), to_char(v_fim, 'HH24:MI'), v_dur using errcode = '22023';
    end if;

    select s.id, s.nome_exibicao, s.unidade_nome into v_local
    from public.cronograma_salas s
    where s.id = nullif(f ->> 'local_id', '')::uuid;
    if not found then
      raise exception 'Local não encontrado em Ocupação de Salas.' using errcode = '23503';
    end if;

    if jsonb_typeof(f -> 'terapias') is distinct from 'array' or jsonb_array_length(f -> 'terapias') = 0 then
      raise exception 'Toda faixa precisa de ao menos uma terapia.' using errcode = '22023';
    end if;

    insert into public.profissionais_disponibilidade_faixas (
      versao_id, dia_semana, hora_inicio, hora_fim, duracao_min, capacidade,
      intervalo_ativo, intervalo_inicio, intervalo_fim,
      local_id, local_nome, unidade_nome, ordem
    ) values (
      p_versao_id, (f ->> 'dia_semana')::smallint, v_ini, v_fim, v_dur, v_cap,
      v_int, v_int_ini, v_int_fim,
      v_local.id, v_local.nome_exibicao, v_local.unidade_nome, coalesce((f ->> 'ordem')::smallint, 0)
    )
    returning id into v_faixa_id;

    for t in select * from jsonb_array_elements(f -> 'terapias') loop
      select c.id, c.nome into v_terapia
      from public.cadastro_terapias c
      join public.profissionais_terapias_habilitadas h
        on h.terapia_id = c.id and h.profissional_id = p_profissional_id
      where c.id = (t #>> '{}')::bigint;
      if not found then
        raise exception 'Terapia % não está habilitada para este profissional.', t #>> '{}' using errcode = '23514';
      end if;
      insert into public.profissionais_disponibilidade_faixa_terapias (faixa_id, terapia_id, terapia_nome)
      values (v_faixa_id, v_terapia.id, v_terapia.nome)
      on conflict do nothing;
    end loop;

    v_n := v_n + 1;
  end loop;

  -- Duas faixas do mesmo dia não podem se encostar por dentro.
  select a.dia_semana, a.hora_inicio, a.hora_fim into v_conflito
  from public.profissionais_disponibilidade_faixas a
  join public.profissionais_disponibilidade_faixas b
    on b.versao_id = a.versao_id and b.dia_semana = a.dia_semana and b.id <> a.id
   and a.hora_inicio < b.hora_fim and b.hora_inicio < a.hora_fim
  where a.versao_id = p_versao_id
  limit 1;
  if found then
    raise exception 'Há faixas sobrepostas no mesmo dia (dia %, a partir de %).',
      v_conflito.dia_semana, to_char(v_conflito.hora_inicio, 'HH24:MI') using errcode = '23P01';
  end if;

  return v_n;
end $$;

revoke all on function public.sp_prof_disp_gravar_faixas(uuid, bigint, jsonb) from public, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- B) Data de saída do profissional
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.profissionais
  add column if not exists data_saida date;

comment on column public.profissionais.data_saida is
  'Primeiro dia SEM o profissional. Gravada pela RPC profissional_inativar (ou = hoje, se inativado pela tela antiga); limpa ao reativar. A Grade mostra as sessões mantidas a partir daqui como "precisa de reposição".';

-- ativo e data_saida andam juntos, venha a mudança da RPC ou da tela.
create or replace function public.sp_profissionais_saida()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.ativo then
    new.data_saida := null;
  elsif new.data_saida is null then
    new.data_saida := public.hoje_brasilia();
  end if;
  return new;
end $$;

drop trigger if exists trg_profissionais_saida on public.profissionais;
create trigger trg_profissionais_saida
  before insert or update of ativo, data_saida on public.profissionais
  for each row execute function public.sp_profissionais_saida();

-- Quem já estava inativo: saída = dia da última atualização (melhor aproximação
-- disponível; nenhuma sessão é tocada por isso). O gatilho de carimbo fica
-- desligado só aqui, para a carga não parecer uma edição de hoje.
alter table public.profissionais disable trigger trg_profissionais_antes_gravar;
update public.profissionais
   set data_saida = (atualizado_em at time zone 'America/Sao_Paulo')::date
 where not ativo and data_saida is null;
alter table public.profissionais enable trigger trg_profissionais_antes_gravar;

revoke all on function public.sp_profissionais_saida() from public, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- C) RPC profissional_inativar
-- ═════════════════════════════════════════════════════════════════════════════
-- p_agendamentos:
--   'manter'  (padrão) — as sessões a partir da saída continuam na agenda,
--             marcadas na Grade como "profissional inativo — precisa de reposição";
--   'excluir' — as sessões a partir da saída (e de hoje) ficam excluídas, com
--             escopo 'inativacao_profissional'.
-- Nos dois casos: as séries do profissional param de gerar sessões novas, a
-- disponibilidade que vale na véspera da saída termina nela, e NENHUMA sessão
-- anterior à saída (nem do passado) é tocada.
create or replace function public.profissional_inativar(
  p_profissional_id  bigint,
  p_data_saida       date,
  p_agendamentos     text default 'manter',
  p_motivo           text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prof      record;
  v_nome      text;
  v_hoje      date := public.hoje_brasilia();
  v_corte     date;
  v_lote      uuid := gen_random_uuid();
  v_motivo    text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_sessoes   integer := 0;
  v_pacientes integer := 0;
  v_series    integer := 0;
  v_versao    record;
begin
  if auth.uid() is null or not public.usuario_tem_permissao('cadastros_profissionais') then
    raise exception 'Sem permissão para inativar profissional.' using errcode = '42501';
  end if;
  if p_data_saida is null then
    raise exception 'Informe a data de saída.' using errcode = '22023';
  end if;
  if coalesce(p_agendamentos, '') not in ('manter', 'excluir') then
    raise exception 'Escolha manter ou excluir os agendamentos.' using errcode = '22023';
  end if;
  if coalesce(length(v_motivo), 0) > 500 then
    raise exception 'Motivo longo demais (máximo 500).' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('grade_prof'), p_profissional_id::integer);

  select * into v_prof from public.profissionais where id = p_profissional_id for update;
  if not found then
    raise exception 'Profissional % não encontrado.', p_profissional_id using errcode = 'P0002';
  end if;
  if not v_prof.ativo then
    raise exception '% já está inativo.', v_prof.nome using errcode = '22023';
  end if;

  select u.nome into v_nome from public.usuarios u where u.id = auth.uid();
  v_nome := coalesce(v_nome, 'Usuário do Pulsar');
  -- Sessão passada é congelada: mesmo com saída retroativa, só se mexe de hoje em diante.
  v_corte := greatest(p_data_saida, v_hoje);

  update public.profissionais set ativo = false, data_saida = p_data_saida where id = p_profissional_id;

  -- Disponibilidade: a versão que vale na véspera da saída termina nela.
  select v.id, v.vigente_de, v.vigente_ate into v_versao
  from public.profissionais_disponibilidade_versoes v
  where v.profissional_id = p_profissional_id
    and v.substituida_em is null
    and v.vigente_de <= p_data_saida - 1
    and (v.vigente_ate is null or v.vigente_ate > p_data_saida - 1)
  limit 1;
  if found then
    update public.profissionais_disponibilidade_versoes
       set vigente_ate = p_data_saida - 1
     where id = v_versao.id;
    insert into public.profissionais_disponibilidade_eventos
      (profissional_id, versao_id, tipo, antes, depois, motivo, usuario_id, usuario_nome)
    values (
      p_profissional_id, v_versao.id, 'encerrar',
      jsonb_build_object('vigente_de', v_versao.vigente_de, 'vigente_ate', v_versao.vigente_ate),
      jsonb_build_object('vigente_de', v_versao.vigente_de, 'vigente_ate', p_data_saida - 1),
      'Profissional inativado; saída em ' || to_char(p_data_saida, 'DD/MM/YYYY'),
      auth.uid(), v_nome
    );
  end if;

  -- Sessões a partir do corte.
  if p_agendamentos = 'excluir' then
    with exc as (
      update public.grade_agendamentos a
         set situacao = 'excluido', excluido_em = now(), excluido_por = auth.uid(),
             excluido_por_nome = v_nome, escopo_exclusao = 'inativacao_profissional',
             motivo_exclusao = coalesce(v_motivo, 'Profissional inativado; saída em ' || to_char(p_data_saida, 'DD/MM/YYYY')),
             lote_id = v_lote
       where a.profissional_id = p_profissional_id
         and a.situacao = 'agendado'
         and a.data >= v_corte
      returning a.paciente_id
    )
    select count(*), count(distinct paciente_id) into v_sessoes, v_pacientes from exc;
  else
    select count(*), count(distinct a.paciente_id) into v_sessoes, v_pacientes
    from public.grade_agendamentos a
    where a.profissional_id = p_profissional_id and a.situacao = 'agendado' and a.data >= v_corte;
  end if;

  -- Séries: param de gerar sessões (encerradas a partir da saída).
  with enc as (
    update public.grade_series s
       set situacao = 'encerrada', encerrada_a_partir = greatest(p_data_saida, s.data_inicio),
           encerrada_em = now(), encerrada_por = auth.uid(), encerrada_por_nome = v_nome,
           motivo_encerramento = 'Profissional inativado; saída em ' || to_char(p_data_saida, 'DD/MM/YYYY'),
           data_fim = case when p_data_saida - 1 >= s.data_inicio
                           then least(coalesce(s.data_fim, p_data_saida - 1), p_data_saida - 1)
                           else s.data_fim end
     where s.profissional_id = p_profissional_id
       and s.situacao = 'ativa'
       and (s.data_fim is null or s.data_fim >= p_data_saida)
    returning 1
  )
  select count(*) into v_series from enc;

  insert into public.grade_eventos
    (acao, profissional_id, lote_id, quantidade, depois, motivo, resumo, feito_por, feito_por_nome)
  values (
    'inativacao_profissional', p_profissional_id, v_lote, v_sessoes,
    jsonb_build_object('data_saida', p_data_saida, 'agendamentos', p_agendamentos,
                       'sessoes', v_sessoes, 'pacientes', v_pacientes, 'series_encerradas', v_series),
    v_motivo,
    v_prof.nome || ' inativado(a), saída em ' || to_char(p_data_saida, 'DD/MM/YYYY') || ' — ' ||
      case when p_agendamentos = 'excluir'
           then v_sessoes || ' sessão(ões) de ' || v_pacientes || ' paciente(s) excluída(s) a partir de ' || to_char(v_corte, 'DD/MM/YYYY')
           else v_sessoes || ' sessão(ões) de ' || v_pacientes || ' paciente(s) mantida(s) para reposição' end,
    auth.uid(), v_nome
  );

  insert into public.cadastros_auditoria
    (tabela, registro_id, acao, alvo_nome, antes, depois, resumo, motivo, usuario_id, usuario_nome)
  values (
    'profissional', p_profissional_id::text, 'inativar', v_prof.nome,
    jsonb_build_object('ativo', true),
    jsonb_build_object('ativo', false, 'data_saida', p_data_saida, 'agendamentos', p_agendamentos),
    'Inativado. Saída em ' || to_char(p_data_saida, 'DD/MM/YYYY') || '; agendamentos: ' ||
      case when p_agendamentos = 'excluir' then 'excluídos (' || v_sessoes || ')' else 'mantidos (' || v_sessoes || ')' end,
    v_motivo, auth.uid(), v_nome
  );

  return jsonb_build_object(
    'sessoes', v_sessoes, 'pacientes', v_pacientes, 'series_encerradas', v_series,
    'agendamentos', p_agendamentos, 'data_saida', p_data_saida
  );
end $$;

comment on function public.profissional_inativar(bigint, date, text, text) is
  'Inativa o profissional com data de saída. p_agendamentos = manter (padrão: sessões a partir da saída viram "precisa de reposição") | excluir (sessões a partir da saída e de hoje ficam excluídas). Nunca toca sessão anterior à saída. Exige cadastros_profissionais.';

-- Contagem para o modal ("23 sessões de 9 pacientes serão afetadas"). Só números.
create or replace function public.profissional_sessoes_a_partir(
  p_profissional_id bigint,
  p_data            date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sessoes   integer;
  v_pacientes integer;
begin
  if auth.uid() is null or not public.usuario_tem_permissao('cadastros_profissionais') then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  select count(*), count(distinct a.paciente_id) into v_sessoes, v_pacientes
  from public.grade_agendamentos a
  where a.profissional_id = p_profissional_id
    and a.situacao = 'agendado'
    and a.data >= greatest(coalesce(p_data, public.hoje_brasilia()), public.hoje_brasilia());
  return jsonb_build_object('sessoes', v_sessoes, 'pacientes', v_pacientes);
end $$;

revoke all on function public.profissional_inativar(bigint, date, text, text) from public, anon;
revoke all on function public.profissional_sessoes_a_partir(bigint, date)     from public, anon;
grant execute on function public.profissional_inativar(bigint, date, text, text) to authenticated;
grant execute on function public.profissional_sessoes_a_partir(bigint, date)     to authenticated;
