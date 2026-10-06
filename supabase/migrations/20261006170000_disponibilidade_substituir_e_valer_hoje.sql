-- Disponibilidade do profissional: versão SUBSTITUÍDA e "Valer a partir de hoje".
--
-- O problema (06/10/2026): a versão nº 1 foi criada valendo a partir de HOJE.
-- Uma nº 2 só podia começar AMANHÃ — começar hoje exigiria a nº 1 terminar
-- ontem, antes de ter começado (CHECK vigente_ate >= vigente_de). E a nº 2
-- agendada para amanhã não podia ser antecipada, porque cruzaria a nº 1. Não
-- havia caminho para "a nº 2 vale agora".
--
-- A saída: versão que ainda não tinha começado a valer (ou começou hoje) e é
-- trocada por outra fica SUBSTITUÍDA — continua no histórico, com quem/quando
-- e por qual versão, mas sai da linha do tempo (não conta para sobreposição nem
-- para a situação da grade). O que já valeu em dias anteriores continua
-- intocável: só ganha data de fim, como antes.
--
--   - criar versão: as que começam na mesma data ou depois e cruzam o período
--     são substituídas se ainda não valeram antes de hoje; se já valeram, a
--     criação é recusada como antes (seria reescrever o passado).
--   - profissional_disponibilidade_valer_hoje: a versão agendada passa a valer
--     hoje mantendo o número; a que vale hoje termina ontem (ou, se começou
--     hoje, é substituída).
--
-- Idempotente. Depende de 20261006140000.

-- ═════════════════════════════════════════════════════════════════════════════
-- A) Colunas e tipo de evento
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.profissionais_disponibilidade_versoes
  add column if not exists substituida_em  timestamptz,
  add column if not exists substituida_por uuid;

-- DEFERRABLE: a versão nova é marcada como substituta antes de ser inserida
-- (inserir antes cruzaria o período da que vai ser substituída).
alter table public.profissionais_disponibilidade_versoes
  drop constraint if exists prof_disp_versoes_substituida_por_fkey;
alter table public.profissionais_disponibilidade_versoes
  add constraint prof_disp_versoes_substituida_por_fkey
  foreign key (substituida_por) references public.profissionais_disponibilidade_versoes(id)
  deferrable initially deferred;

alter table public.profissionais_disponibilidade_versoes
  drop constraint if exists prof_disp_versoes_substituida_check;
alter table public.profissionais_disponibilidade_versoes
  add constraint prof_disp_versoes_substituida_check
  check ((substituida_em is null) = (substituida_por is null) and (substituida_por is null or substituida_por <> id));

alter table public.profissionais_disponibilidade_eventos
  drop constraint if exists prof_disp_eventos_tipo_check;
alter table public.profissionais_disponibilidade_eventos
  add constraint prof_disp_eventos_tipo_check
  check (tipo in ('criar', 'encerrar', 'alterar_vigencia', 'restaurar', 'substituir', 'antecipar'));

-- ═════════════════════════════════════════════════════════════════════════════
-- B) Gatilho da versão: substituída é final e não entra na sobreposição
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.sp_prof_disp_versoes_guarda()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_conflito record;
begin
  if tg_op = 'DELETE' then
    raise exception 'Versão de disponibilidade é histórico: não pode ser apagada.' using errcode = '42501';
  end if;

  -- Serializa as gravações do MESMO profissional: duas abas salvando juntas não
  -- passam ambas pela checagem de sobreposição.
  perform pg_advisory_xact_lock(hashtext('prof_disp_versoes'), new.profissional_id::integer);

  if tg_op = 'INSERT' then
    select coalesce(max(v.numero), 0) + 1 into new.numero
    from public.profissionais_disponibilidade_versoes v
    where v.profissional_id = new.profissional_id;
    new.criado_em := now();
    -- Ninguém nasce substituído.
    new.substituida_em := null;
    new.substituida_por := null;
  else
    if new.profissional_id is distinct from old.profissional_id
       or new.numero is distinct from old.numero
       or new.dias_ativos is distinct from old.dias_ativos
       or new.origem is distinct from old.origem
       or new.restaurada_de is distinct from old.restaurada_de
       or new.motivo is distinct from old.motivo
       or new.criado_por is distinct from old.criado_por
       or new.criado_por_nome is distinct from old.criado_por_nome
       or new.criado_em is distinct from old.criado_em then
      raise exception 'Só a vigência de uma versão pode mudar; o conteúdo é histórico.' using errcode = '42501';
    end if;
    -- Substituída é estado final: nem a vigência nem a substituição mudam mais.
    if old.substituida_em is not null then
      raise exception 'A versão nº % foi substituída e é histórico: restaure-a como nova versão.', old.numero
        using errcode = '42501';
    end if;
    -- Ao substituir, a vigência fica como estava (é o registro do que se planejou).
    if new.substituida_em is not null
       and (new.vigente_de is distinct from old.vigente_de or new.vigente_ate is distinct from old.vigente_ate) then
      raise exception 'Substituir não altera a vigência da versão.' using errcode = '42501';
    end if;
  end if;

  if new.substituida_em is null then
    select v.numero, v.vigente_de, v.vigente_ate into v_conflito
    from public.profissionais_disponibilidade_versoes v
    where v.profissional_id = new.profissional_id
      and v.id <> new.id
      and v.substituida_em is null
      and daterange(v.vigente_de, v.vigente_ate, '[]') && daterange(new.vigente_de, new.vigente_ate, '[]')
    limit 1;

    if found then
      raise exception 'O período se sobrepõe à versão nº % (% a %).',
        v_conflito.numero,
        to_char(v_conflito.vigente_de, 'DD/MM/YYYY'),
        coalesce(to_char(v_conflito.vigente_ate, 'DD/MM/YYYY'), 'indeterminado')
        using errcode = '23P01';
    end if;
  end if;

  return new;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- C) Views (colunas novas → recriar; a de situação depende da de versões)
-- ═════════════════════════════════════════════════════════════════════════════
drop view if exists public.vw_profissionais_grade_situacao;
drop view if exists public.vw_profissionais_disponibilidade_versoes;

create view public.vw_profissionais_disponibilidade_versoes
with (security_invoker = true) as
select
  v.id, v.profissional_id, v.numero, v.vigente_de, v.vigente_ate, v.dias_ativos, v.origem,
  v.restaurada_de, v.motivo, v.criado_por, v.criado_por_nome, v.criado_em,
  v.substituida_em, v.substituida_por,
  case
    when v.substituida_em is not null then 'substituida'
    when v.vigente_de > public.hoje_brasilia() then 'agendada'
    when v.vigente_ate is not null and v.vigente_ate < public.hoje_brasilia() then 'encerrada'
    else 'vigente'
  end as situacao
from public.profissionais_disponibilidade_versoes v;

comment on view public.vw_profissionais_disponibilidade_versoes is
  'Versões com a situação de hoje (Brasília): vigente | agendada | encerrada | substituida.';

create view public.vw_profissionais_grade_situacao
with (security_invoker = true) as
with v as (
  select * from public.vw_profissionais_disponibilidade_versoes where situacao <> 'substituida'
)
select
  p.profissional_id,
  case
    when bool_or(p.situacao = 'vigente')  then 'vigente'
    when bool_or(p.situacao = 'agendada') then 'agendada'
    else 'inativa'
  end as situacao,
  (array_agg(p.id order by p.vigente_de) filter (where p.situacao = 'vigente'))[1]     as versao_vigente_id,
  max(p.vigente_de)  filter (where p.situacao = 'vigente')                              as vigente_desde,
  max(p.vigente_ate) filter (where p.situacao = 'vigente')                              as vigente_ate,
  min(p.vigente_de)  filter (where p.situacao = 'agendada')                             as proxima_de,
  max(p.vigente_ate) filter (where p.situacao = 'encerrada')                            as encerrada_em,
  count(*)                                                                              as total_versoes
from v p
group by p.profissional_id;

comment on view public.vw_profissionais_grade_situacao is
  'Situação da grade de cada profissional hoje (Brasília): vigente | agendada | inativa. Quem não tem linha = sem grade. Versões substituídas não contam.';

revoke all on public.vw_profissionais_disponibilidade_versoes from public, anon, authenticated;
revoke all on public.vw_profissionais_grade_situacao          from public, anon, authenticated;
grant select on public.vw_profissionais_disponibilidade_versoes to authenticated, service_role;
grant select on public.vw_profissionais_grade_situacao          to authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- D) Criar versão: substitui as que ainda não valeram
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.profissional_disponibilidade_criar_versao(
  p_profissional_id   bigint,
  p_vigente_de        date,
  p_vigente_ate       date,
  p_dias              smallint[],
  p_faixas            jsonb,
  p_motivo            text,
  p_origem            text default 'manual',
  p_encerrar_anterior boolean default true,
  p_restaurada_de     uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome     text;
  v_versao   uuid := gen_random_uuid();
  v_ant      record;
  v_sub      record;
  v_n        integer;
  v_hoje     date := public.hoje_brasilia();
begin
  if auth.uid() is null or not public.usuario_tem_permissao('cadastros_profissionais') then
    raise exception 'Sem permissão para alterar a disponibilidade.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profissionais where id = p_profissional_id) then
    raise exception 'Profissional % não encontrado.', p_profissional_id using errcode = 'P0002';
  end if;
  if p_vigente_de is null then
    raise exception 'Informe a data de início da vigência.' using errcode = '22023';
  end if;
  if p_vigente_ate is not null and p_vigente_ate < p_vigente_de then
    raise exception 'O fim da vigência é anterior ao início.' using errcode = '22023';
  end if;
  if coalesce(p_origem, '') not in ('manual', 'preenchido_tita', 'restaurada') then
    raise exception 'Origem inválida.' using errcode = '22023';
  end if;
  if (p_origem = 'restaurada') <> (p_restaurada_de is not null) then
    raise exception 'Restauração precisa indicar a versão de origem (e só ela).' using errcode = '22023';
  end if;
  if p_restaurada_de is not null and not exists (
    select 1 from public.profissionais_disponibilidade_versoes
    where id = p_restaurada_de and profissional_id = p_profissional_id
  ) then
    raise exception 'A versão restaurada não é deste profissional.' using errcode = '22023';
  end if;
  if coalesce(length(p_motivo), 0) > 500 then
    raise exception 'Motivo longo demais (máximo 500).' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('prof_disp_versoes'), p_profissional_id::integer);
  select u.nome into v_nome from public.usuarios u where u.id = auth.uid();

  -- Versão que começa nesta data ou depois, cruza o período e JÁ VALEU antes de
  -- hoje: substituí-la apagaria dias que aconteceram. Recusa como antes.
  if exists (
    select 1 from public.profissionais_disponibilidade_versoes v
    where v.profissional_id = p_profissional_id
      and v.substituida_em is null
      and v.vigente_de >= p_vigente_de
      and v.vigente_de < v_hoje
      and daterange(v.vigente_de, v.vigente_ate, '[]') && daterange(p_vigente_de, p_vigente_ate, '[]')
  ) then
    raise exception 'Já existe versão que valeu a partir de % ou depois e cruza este período. Ajuste a vigência dela antes.',
      to_char(p_vigente_de, 'DD/MM/YYYY') using errcode = '23P01';
  end if;

  -- As que começam nesta data ou depois e ainda não valeram (agendadas, ou
  -- começando hoje) ficam SUBSTITUÍDAS pela nova.
  for v_sub in
    update public.profissionais_disponibilidade_versoes v
       set substituida_em = now(), substituida_por = v_versao
     where v.profissional_id = p_profissional_id
       and v.substituida_em is null
       and v.vigente_de >= p_vigente_de
       and v.vigente_de >= v_hoje
       and daterange(v.vigente_de, v.vigente_ate, '[]') && daterange(p_vigente_de, p_vigente_ate, '[]')
    returning v.id, v.numero, v.vigente_de, v.vigente_ate
  loop
    insert into public.profissionais_disponibilidade_eventos
      (profissional_id, versao_id, tipo, antes, depois, motivo, usuario_id, usuario_nome)
    values (
      p_profissional_id, v_sub.id, 'substituir',
      jsonb_build_object('vigente_de', v_sub.vigente_de, 'vigente_ate', v_sub.vigente_ate),
      jsonb_build_object('substituida_por', v_versao),
      'Substituída por nova versão a partir de ' || to_char(p_vigente_de, 'DD/MM/YYYY'),
      auth.uid(), coalesce(v_nome, 'Usuário do Pulsar')
    );
  end loop;

  -- A versão que já valia em p_vigente_de termina na véspera.
  if p_encerrar_anterior then
    select v.id, v.vigente_de, v.vigente_ate into v_ant
    from public.profissionais_disponibilidade_versoes v
    where v.profissional_id = p_profissional_id
      and v.substituida_em is null
      and v.vigente_de < p_vigente_de
      and (v.vigente_ate is null or v.vigente_ate >= p_vigente_de)
    limit 1;
    if found then
      update public.profissionais_disponibilidade_versoes
         set vigente_ate = p_vigente_de - 1
       where id = v_ant.id;
      insert into public.profissionais_disponibilidade_eventos
        (profissional_id, versao_id, tipo, antes, depois, motivo, usuario_id, usuario_nome)
      values (
        p_profissional_id, v_ant.id, 'encerrar',
        jsonb_build_object('vigente_de', v_ant.vigente_de, 'vigente_ate', v_ant.vigente_ate),
        jsonb_build_object('vigente_de', v_ant.vigente_de, 'vigente_ate', p_vigente_de - 1),
        'Substituída por nova versão a partir de ' || to_char(p_vigente_de, 'DD/MM/YYYY'),
        auth.uid(), coalesce(v_nome, 'Usuário do Pulsar')
      );
    end if;
  end if;

  insert into public.profissionais_disponibilidade_versoes (
    id, profissional_id, vigente_de, vigente_ate, dias_ativos, origem, restaurada_de, motivo,
    criado_por, criado_por_nome
  ) values (
    v_versao, p_profissional_id, p_vigente_de, p_vigente_ate,
    coalesce((select array_agg(distinct d order by d) from unnest(p_dias) d), '{}'),
    p_origem, p_restaurada_de, nullif(btrim(coalesce(p_motivo, '')), ''),
    auth.uid(), coalesce(v_nome, 'Usuário do Pulsar')
  );

  v_n := public.sp_prof_disp_gravar_faixas(v_versao, p_profissional_id, p_faixas);

  insert into public.profissionais_disponibilidade_eventos
    (profissional_id, versao_id, tipo, depois, motivo, usuario_id, usuario_nome)
  values (
    p_profissional_id, v_versao, case when p_origem = 'restaurada' then 'restaurar' else 'criar' end,
    jsonb_build_object('vigente_de', p_vigente_de, 'vigente_ate', p_vigente_ate, 'faixas', v_n, 'dias', p_dias),
    nullif(btrim(coalesce(p_motivo, '')), ''),
    auth.uid(), coalesce(v_nome, 'Usuário do Pulsar')
  );

  return v_versao;
end $$;

comment on function public.profissional_disponibilidade_criar_versao(bigint, date, date, smallint[], jsonb, text, text, boolean, uuid) is
  'Cria uma versão da disponibilidade (valida faixas, terapias habilitadas, locais e período). A que valia antes termina na véspera; as que começam na mesma data ou depois e ainda não valeram ficam substituídas. Exige cadastros_profissionais.';

-- ═════════════════════════════════════════════════════════════════════════════
-- E) Alterar vigência: versão substituída não muda mais
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.profissional_disponibilidade_alterar_vigencia(
  p_versao_id    uuid,
  p_vigente_de   date,
  p_vigente_ate  date,
  p_motivo       text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v       record;
  v_nome  text;
  v_hoje  date := public.hoje_brasilia();
begin
  if auth.uid() is null or not public.usuario_tem_permissao('cadastros_profissionais') then
    raise exception 'Sem permissão para alterar a disponibilidade.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Informe o motivo da alteração de vigência.' using errcode = '22023';
  end if;
  if coalesce(length(p_motivo), 0) > 500 then
    raise exception 'Motivo longo demais (máximo 500).' using errcode = '22023';
  end if;

  select * into v from public.profissionais_disponibilidade_versoes where id = p_versao_id for update;
  if not found then
    raise exception 'Versão não encontrada.' using errcode = 'P0002';
  end if;
  if v.substituida_em is not null then
    raise exception 'A versão nº % foi substituída: restaure-a como nova versão.', v.numero using errcode = '22023';
  end if;
  if p_vigente_de is null or (p_vigente_ate is not null and p_vigente_ate < p_vigente_de) then
    raise exception 'Período inválido.' using errcode = '22023';
  end if;
  -- O início de uma versão que já começou a valer é fato consumado.
  if p_vigente_de <> v.vigente_de and v.vigente_de <= v_hoje then
    raise exception 'Esta versão já começou a valer em %; o início não pode mudar. Encerre-a e crie outra.',
      to_char(v.vigente_de, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  if p_vigente_de = v.vigente_de and p_vigente_ate is not distinct from v.vigente_ate then
    return;
  end if;

  select u.nome into v_nome from public.usuarios u where u.id = auth.uid();

  update public.profissionais_disponibilidade_versoes
     set vigente_de = p_vigente_de, vigente_ate = p_vigente_ate
   where id = p_versao_id;

  insert into public.profissionais_disponibilidade_eventos
    (profissional_id, versao_id, tipo, antes, depois, motivo, usuario_id, usuario_nome)
  values (
    v.profissional_id, p_versao_id,
    case when p_vigente_de = v.vigente_de and p_vigente_ate is not null
              and (v.vigente_ate is null or p_vigente_ate < v.vigente_ate)
         then 'encerrar' else 'alterar_vigencia' end,
    jsonb_build_object('vigente_de', v.vigente_de, 'vigente_ate', v.vigente_ate),
    jsonb_build_object('vigente_de', p_vigente_de, 'vigente_ate', p_vigente_ate),
    btrim(p_motivo), auth.uid(), coalesce(v_nome, 'Usuário do Pulsar')
  );
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- F) Valer a partir de hoje (antecipar uma versão agendada)
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.profissional_disponibilidade_valer_hoje(
  p_versao_id  uuid,
  p_motivo     text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v       record;
  o       record;
  v_nome  text;
  v_hoje  date := public.hoje_brasilia();
  v_mot   text := coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), 'Antecipada para valer a partir de hoje');
begin
  if auth.uid() is null or not public.usuario_tem_permissao('cadastros_profissionais') then
    raise exception 'Sem permissão para alterar a disponibilidade.' using errcode = '42501';
  end if;
  if length(v_mot) > 500 then
    raise exception 'Motivo longo demais (máximo 500).' using errcode = '22023';
  end if;

  select * into v from public.profissionais_disponibilidade_versoes where id = p_versao_id;
  if not found then
    raise exception 'Versão não encontrada.' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('prof_disp_versoes'), v.profissional_id::integer);
  select * into v from public.profissionais_disponibilidade_versoes where id = p_versao_id for update;

  if v.substituida_em is not null then
    raise exception 'A versão nº % foi substituída: restaure-a como nova versão.', v.numero using errcode = '22023';
  end if;
  if v.vigente_de <= v_hoje then
    raise exception 'A versão nº % já está valendo desde %.', v.numero, to_char(v.vigente_de, 'DD/MM/YYYY') using errcode = '22023';
  end if;

  select u.nome into v_nome from public.usuarios u where u.id = auth.uid();

  -- Quem ocupa [hoje, véspera do início dela]: o que já valia antes de hoje
  -- termina ontem; o que começa hoje ou depois (e ainda não valeu) é substituído.
  for o in
    select x.id, x.numero, x.vigente_de, x.vigente_ate
    from public.profissionais_disponibilidade_versoes x
    where x.profissional_id = v.profissional_id
      and x.id <> v.id
      and x.substituida_em is null
      and daterange(x.vigente_de, x.vigente_ate, '[]') && daterange(v_hoje, v.vigente_de - 1, '[]')
    order by x.vigente_de
  loop
    if o.vigente_de < v_hoje then
      update public.profissionais_disponibilidade_versoes set vigente_ate = v_hoje - 1 where id = o.id;
      insert into public.profissionais_disponibilidade_eventos
        (profissional_id, versao_id, tipo, antes, depois, motivo, usuario_id, usuario_nome)
      values (
        v.profissional_id, o.id, 'encerrar',
        jsonb_build_object('vigente_de', o.vigente_de, 'vigente_ate', o.vigente_ate),
        jsonb_build_object('vigente_de', o.vigente_de, 'vigente_ate', v_hoje - 1),
        'Encerrada: a versão nº ' || v.numero || ' passou a valer a partir de ' || to_char(v_hoje, 'DD/MM/YYYY'),
        auth.uid(), coalesce(v_nome, 'Usuário do Pulsar')
      );
    else
      update public.profissionais_disponibilidade_versoes
         set substituida_em = now(), substituida_por = v.id
       where id = o.id;
      insert into public.profissionais_disponibilidade_eventos
        (profissional_id, versao_id, tipo, antes, depois, motivo, usuario_id, usuario_nome)
      values (
        v.profissional_id, o.id, 'substituir',
        jsonb_build_object('vigente_de', o.vigente_de, 'vigente_ate', o.vigente_ate),
        jsonb_build_object('substituida_por', v.id),
        'Substituída pela versão nº ' || v.numero || ', antecipada para ' || to_char(v_hoje, 'DD/MM/YYYY'),
        auth.uid(), coalesce(v_nome, 'Usuário do Pulsar')
      );
    end if;
  end loop;

  update public.profissionais_disponibilidade_versoes set vigente_de = v_hoje where id = v.id;

  insert into public.profissionais_disponibilidade_eventos
    (profissional_id, versao_id, tipo, antes, depois, motivo, usuario_id, usuario_nome)
  values (
    v.profissional_id, v.id, 'antecipar',
    jsonb_build_object('vigente_de', v.vigente_de, 'vigente_ate', v.vigente_ate),
    jsonb_build_object('vigente_de', v_hoje, 'vigente_ate', v.vigente_ate),
    v_mot, auth.uid(), coalesce(v_nome, 'Usuário do Pulsar')
  );
end $$;

comment on function public.profissional_disponibilidade_valer_hoje(uuid, text) is
  'Faz uma versão agendada valer a partir de hoje (mesmo número). A que valia antes de hoje termina ontem; a que começou hoje ou estava agendada antes dela fica substituída. Exige cadastros_profissionais.';

revoke all on function public.profissional_disponibilidade_valer_hoje(uuid, text) from public, anon;
grant execute on function public.profissional_disponibilidade_valer_hoje(uuid, text) to authenticated;
