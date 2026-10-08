-- Grade (Cronograma) — Parte 3: leitura e escrita da agenda.
--
-- Toda escrita passa por aqui (SECURITY DEFINER + usuario_tem_permissao
-- ('cronograma_grade')). Nada daqui chama o TiTa.
--
-- LEITURA. Quem usa a Grade (atendentes) não tem, necessariamente, a permissão
-- dos cadastros. Em vez de abrir profissionais / disponibilidade / feriados,
-- estas funções devolvem SÓ o que a agenda precisa (sem CPF, contato, endereço):
--   grade_profissionais(), grade_faixas(de, ate, ids), grade_feriados(de, ate),
--   grade_disponibilidade_paciente(id).
--
-- ESCRITA.
--   grade_simular_agendamento(payload) — prévia: cada data da série com ok ou
--     o conflito. Nada é gravado.
--   grade_criar_agendamento(payload)   — cria a série e as sessões das datas
--     sem conflito; as puladas ficam no evento.
--   grade_excluir_agendamento(id, escopo, motivo) — 'somente_esta' ou
--     'desta_em_diante' (encerra a série). Motivo obrigatório; só de hoje em diante.
--   grade_criar_bloqueio(payload) / grade_excluir_bloqueio(id, motivo).
--   grade_estender_series() — pg_cron noturno: séries contínuas até o horizonte.
--
-- Conflitos (sp_grade_conflito), na ordem em que são verificados:
--   passado, profissional_inativo, paciente_inativo, paciente_alta, feriado,
--   bloqueio, fora_da_disponibilidade, terapia_fora_da_faixa, lotado,
--   paciente_ocupado.
-- Só paciente_ocupado pode ser aceito na criação (permitir_paciente_simultaneo):
-- há atendimento com dois profissionais ao mesmo tempo (ex.: supervisão).
--
-- Horizonte: séries contínuas ficam materializadas até hoje + 182 dias.
--
-- Depende de 20261008100000 e 20261008100100. Idempotente.

-- ═════════════════════════════════════════════════════════════════════════════
-- A) Auxiliares internas (sem EXECUTE para ninguém além do dono)
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.sp_grade_usuario_nome()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select u.nome from public.usuarios u where u.id = auth.uid()), 'Usuário do Pulsar')
$$;

create or replace function public.sp_grade_exigir_permissao()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.usuario_tem_permissao('cronograma_grade') then
    raise exception 'Sem permissão para a Grade.' using errcode = '42501';
  end if;
end $$;

create or replace function public.sp_grade_horizonte()
returns date
language sql
stable
set search_path = ''
as $$
  select public.hoje_brasilia() + 182
$$;

create or replace function public.sp_grade_rotulo_conflito(p_conflito text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_conflito
    when 'passado'                 then 'data passada'
    when 'profissional_inativo'    then 'profissional inativo'
    when 'paciente_inativo'        then 'paciente inativo'
    when 'paciente_alta'           then 'paciente de alta'
    when 'feriado'                 then 'feriado'
    when 'bloqueio'                then 'horário bloqueado'
    when 'fora_da_disponibilidade' then 'fora da disponibilidade do profissional'
    when 'terapia_fora_da_faixa'   then 'terapia não oferecida nesse horário'
    when 'lotado'                  then 'horário lotado'
    when 'paciente_ocupado'        then 'paciente já tem sessão nesse horário'
    else coalesce(p_conflito, '')
  end
$$;

-- Datas de uma série: de p_inicio até p_ate, a cada p_intervalo semanas.
create or replace function public.sp_grade_datas(p_inicio date, p_intervalo smallint, p_ate date)
returns setof date
language sql
immutable
set search_path = ''
as $$
  select d::date
  from generate_series(p_inicio::timestamp, p_ate::timestamp, make_interval(days => 7 * greatest(p_intervalo, 1))) d
$$;

-- A faixa da disponibilidade que contém o horário naquela data (versão que vale
-- no dia, não substituída, dia ativo, fora do intervalo).
create or replace function public.sp_grade_faixa_do_horario(
  p_profissional_id bigint,
  p_data            date,
  p_ini             time,
  p_fim             time
)
returns table (faixa_id uuid, capacidade smallint, local_id uuid, local_nome text, unidade_nome text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.capacidade, f.local_id, f.local_nome, f.unidade_nome
  from public.profissionais_disponibilidade_versoes v
  join public.profissionais_disponibilidade_faixas f on f.versao_id = v.id
  where v.profissional_id = p_profissional_id
    and v.substituida_em is null
    and p_data >= v.vigente_de
    and (v.vigente_ate is null or p_data <= v.vigente_ate)
    and extract(isodow from p_data)::smallint = any(v.dias_ativos)
    and f.dia_semana = extract(isodow from p_data)::smallint
    and f.hora_inicio <= p_ini
    and f.hora_fim >= p_fim
    and not (f.intervalo_ativo and f.intervalo_inicio < p_fim and f.intervalo_fim > p_ini)
  order by f.hora_inicio
  limit 1
$$;

-- Primeiro conflito de uma sessão hipotética; null = pode agendar.
-- p_checar_disponibilidade = false (estender séries): uma série que já existe
-- continua sendo projetada mesmo que a disponibilidade tenha mudado — a tela
-- mostra "fora da grade" e alguém decide; sumir com a sessão em silêncio não.
create or replace function public.sp_grade_conflito(
  p_profissional_id         bigint,
  p_paciente_id             bigint,
  p_terapia_id              bigint,
  p_data                    date,
  p_ini                     time,
  p_fim                     time,
  p_checar_disponibilidade  boolean default true
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prof   record;
  v_fer    record;
  v_faixa  record;
  v_ocup   integer;
begin
  if p_data < public.hoje_brasilia() then
    return 'passado';
  end if;

  select p.ativo, p.data_saida into v_prof from public.profissionais p where p.id = p_profissional_id;
  if not found or (v_prof.data_saida is not null and p_data >= v_prof.data_saida)
     or (not v_prof.ativo and v_prof.data_saida is null) then
    return 'profissional_inativo';
  end if;

  if exists (
    select 1 from public.pacientes p
    where p.id_paciente = p_paciente_id and (not p.ativo or p.falecido or p.ficticio)
  ) then
    return 'paciente_inativo';
  end if;

  if exists (
    select 1 from public.cadastros_pacientes_alta_clinica a
    where a.id_paciente_pulsar = p_paciente_id and a.ativo and a.data_alta_clinica <= p_data
  ) then
    return 'paciente_alta';
  end if;

  -- Feriado: integral fecha o dia; parcial fecha das horario_inicio às horario_fim.
  select f.tipo, f.horario_inicio, f.horario_fim into v_fer from public.feriados f where f.data = p_data;
  if found and (
       v_fer.tipo = 'integral'
       or nullif(v_fer.horario_inicio, '') is null
       or (nullif(v_fer.horario_inicio, '')::time < p_fim and coalesce(nullif(v_fer.horario_fim, ''), '23:59')::time > p_ini)
     ) then
    return 'feriado';
  end if;

  if exists (
    select 1 from public.grade_bloqueios b
    where b.profissional_id = p_profissional_id
      and b.situacao = 'ativo'
      and p_data >= b.data_inicio
      and (b.data_fim is null or p_data <= b.data_fim)
      and (b.dias_semana is null or extract(dow from p_data)::smallint = any(b.dias_semana))
      and (b.hora_inicio is null or (b.hora_inicio < p_fim and b.hora_fim > p_ini))
  ) then
    return 'bloqueio';
  end if;

  select * into v_faixa from public.sp_grade_faixa_do_horario(p_profissional_id, p_data, p_ini, p_fim);
  if not found then
    if p_checar_disponibilidade then
      return 'fora_da_disponibilidade';
    end if;
  elsif p_checar_disponibilidade and not exists (
    select 1 from public.profissionais_disponibilidade_faixa_terapias t
    where t.faixa_id = v_faixa.faixa_id and t.terapia_id = p_terapia_id
  ) then
    return 'terapia_fora_da_faixa';
  end if;

  -- Capacidade: só se sabe com faixa. Sem faixa (série antiga projetada), não há
  -- número para comparar.
  if v_faixa.faixa_id is not null then
    select count(*) into v_ocup
    from public.grade_agendamentos a
    where a.profissional_id = p_profissional_id
      and a.data = p_data
      and a.situacao = 'agendado'
      and a.hora_inicio < p_fim and a.hora_fim > p_ini;
    if v_ocup >= v_faixa.capacidade then
      return 'lotado';
    end if;
  end if;

  if exists (
    select 1 from public.grade_agendamentos a
    where a.paciente_id = p_paciente_id
      and a.data = p_data
      and a.situacao = 'agendado'
      and a.hora_inicio < p_fim and a.hora_fim > p_ini
  ) then
    return 'paciente_ocupado';
  end if;

  return null;
end $$;

-- Estende séries contínuas até o horizonte. Filtros opcionais (profissional OU
-- paciente) para a criação materializar o entorno antes de checar conflito —
-- senão uma série criada hoje poderia ocupar uma vaga que uma série antiga
-- ainda não projetou.
create or replace function public.sp_grade_estender(
  p_profissional_id bigint default null,
  p_paciente_id     bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s          record;
  d          date;
  c          text;
  v_horiz    date := public.sp_grade_horizonte();
  v_ate      date;
  v_criadas  integer := 0;
  v_series   integer := 0;
  v_puladas  jsonb := '[]'::jsonb;
begin
  for s in
    select x.*
    from public.grade_series x
    where x.situacao = 'ativa'
      and x.frequencia = 'semanal'
      and x.total_sessoes is null
      and coalesce(x.materializada_ate, x.data_inicio - 1) < least(coalesce(x.data_fim, v_horiz), v_horiz)
      and (
        (p_profissional_id is null and p_paciente_id is null)
        or x.profissional_id = p_profissional_id
        or x.paciente_id = p_paciente_id
      )
    order by x.criado_em
    for update skip locked
  loop
    v_ate := least(coalesce(s.data_fim, v_horiz), v_horiz);
    v_series := v_series + 1;

    for d in
      select dd from public.sp_grade_datas(s.data_inicio, s.intervalo_semanas, v_ate) dd
      where dd > coalesce(s.materializada_ate, s.data_inicio - 1)
        and dd >= public.hoje_brasilia()
    loop
      -- Já existe (ex.: veio do TiTa nessa data): não duplica.
      if exists (
        select 1 from public.grade_agendamentos a
        where a.serie_id = s.id and a.data = d and a.hora_inicio = s.hora_inicio
      ) then
        continue;
      end if;

      c := public.sp_grade_conflito(s.profissional_id, s.paciente_id, s.terapia_id, d, s.hora_inicio, s.hora_fim, false);
      if c is null then
        insert into public.grade_agendamentos (
          serie_id, data, hora_inicio, hora_fim,
          paciente_id, paciente_nome, profissional_id, profissional_nome,
          terapia_id, terapia_nome, terapia_exibicao_id, terapia_exibicao_nome,
          local_id, sala_nome, unidade_nome, origem, importacao_id,
          criado_por, criado_por_nome
        )
        select
          s.id, d, s.hora_inicio, s.hora_fim,
          s.paciente_id, pa.nome, s.profissional_id, pr.nome,
          s.terapia_id, s.terapia_nome, s.terapia_exibicao_id, s.terapia_exibicao_nome,
          s.local_id, s.sala_nome, s.unidade_nome, s.origem, s.importacao_id,
          null, 'Repetição automática'
        from public.pacientes pa, public.profissionais pr
        where pa.id_paciente = s.paciente_id and pr.id = s.profissional_id;
        v_criadas := v_criadas + 1;
      else
        v_puladas := v_puladas || jsonb_build_object('serie_id', s.id, 'data', d, 'motivo', c);
      end if;
    end loop;

    update public.grade_series set materializada_ate = v_ate where id = s.id;
  end loop;

  return jsonb_build_object('series', v_series, 'criadas', v_criadas, 'puladas', v_puladas);
end $$;

-- Lê e valida o payload de um agendamento. Devolve os campos normalizados.
create or replace function public.sp_grade_ler_payload(p jsonb)
returns table (
  paciente_id bigint, profissional_id bigint, terapia_id bigint, terapia_exibicao_id bigint,
  local_id uuid, data_inicio date, hora_inicio time, hora_fim time,
  frequencia text, intervalo_semanas smallint, data_fim date, total_sessoes smallint,
  permitir_paciente_simultaneo boolean, observacao text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pac   bigint   := (p ->> 'paciente_id')::bigint;
  v_prof  bigint   := (p ->> 'profissional_id')::bigint;
  v_ter   bigint   := (p ->> 'terapia_id')::bigint;
  v_exib  bigint   := nullif(p ->> 'terapia_exibicao_id', '')::bigint;
  v_local uuid     := nullif(p ->> 'local_id', '')::uuid;
  v_ini   date     := (p ->> 'data_inicio')::date;
  v_hi    time     := (p ->> 'hora_inicio')::time;
  v_hf    time     := (p ->> 'hora_fim')::time;
  v_freq  text     := coalesce(nullif(p ->> 'frequencia', ''), 'semanal');
  v_int   smallint := coalesce(nullif(p ->> 'intervalo_semanas', '')::smallint, 1);
  v_fim   date     := nullif(p ->> 'data_fim', '')::date;
  v_tot   smallint := nullif(p ->> 'total_sessoes', '')::smallint;
  v_perm  boolean  := coalesce((p ->> 'permitir_paciente_simultaneo')::boolean, false);
  v_obs   text     := nullif(btrim(coalesce(p ->> 'observacao', '')), '');
begin
  if jsonb_typeof(p) is distinct from 'object' then
    raise exception 'Agendamento em formato inválido.' using errcode = '22023';
  end if;
  if v_pac is null or not exists (select 1 from public.pacientes x where x.id_paciente = v_pac and not x.ficticio) then
    raise exception 'Paciente não encontrado.' using errcode = 'P0002';
  end if;
  if v_prof is null or not exists (select 1 from public.profissionais x where x.id = v_prof) then
    raise exception 'Profissional não encontrado.' using errcode = 'P0002';
  end if;
  if v_ter is null or not exists (select 1 from public.cadastro_terapias x where x.id = v_ter and x.ativo) then
    raise exception 'Terapia não encontrada ou inativa.' using errcode = 'P0002';
  end if;
  if v_exib is not null and not exists (select 1 from public.cadastro_terapias x where x.id = v_exib) then
    raise exception 'Terapia de exibição não encontrada.' using errcode = 'P0002';
  end if;
  if v_local is not null and not exists (select 1 from public.cronograma_salas x where x.id = v_local) then
    raise exception 'Sala não encontrada em Ocupação de Salas.' using errcode = 'P0002';
  end if;
  if v_ini is null then
    raise exception 'Informe a data.' using errcode = '22023';
  end if;
  if v_ini < public.hoje_brasilia() then
    raise exception 'Não é possível agendar em data passada.' using errcode = '22023';
  end if;
  if v_hi is null or v_hf is null or v_hf <= v_hi
     or extract(epoch from (v_hf - v_hi)) / 60 not between 15 and 240 then
    raise exception 'Horário inválido.' using errcode = '22023';
  end if;
  if v_freq not in ('unica', 'semanal') then
    raise exception 'Repetição inválida.' using errcode = '22023';
  end if;
  if v_int not between 1 and 8 then
    raise exception 'Intervalo de repetição deve ficar entre 1 e 8 semanas.' using errcode = '22023';
  end if;
  if v_fim is not null and v_fim < v_ini then
    raise exception 'O término é anterior ao início.' using errcode = '22023';
  end if;
  if v_tot is not null and v_tot not between 1 and 520 then
    raise exception 'Número de sessões inválido.' using errcode = '22023';
  end if;
  if v_fim is not null and v_tot is not null then
    raise exception 'Escolha término por data OU por número de sessões.' using errcode = '22023';
  end if;
  if coalesce(length(v_obs), 0) > 1000 then
    raise exception 'Observação longa demais (máximo 1000).' using errcode = '22023';
  end if;

  if v_freq = 'unica' then
    v_int := 1; v_fim := v_ini; v_tot := null;
  end if;

  return query select v_pac, v_prof, v_ter, coalesce(v_exib, v_ter), v_local, v_ini, v_hi, v_hf,
                      v_freq, v_int, v_fim, v_tot, v_perm, v_obs;
end $$;

-- As datas que o agendamento geraria, com o conflito de cada uma.
-- ok = sem conflito, ou paciente_ocupado aceito.
create or replace function public.sp_grade_planejar(p jsonb)
returns table (data date, conflito text, ok boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r        record;
  d        date;
  c        text;
  v_ate    date;
  v_ok     integer := 0;
begin
  select * into r from public.sp_grade_ler_payload(p);

  if r.frequencia = 'unica' then
    v_ate := r.data_inicio;
  elsif r.total_sessoes is not null then
    -- Conta sessões de verdade (datas puladas não contam); teto de 2 anos.
    v_ate := r.data_inicio + 730;
  else
    v_ate := least(coalesce(r.data_fim, public.sp_grade_horizonte()), public.sp_grade_horizonte());
  end if;

  for d in select dd from public.sp_grade_datas(r.data_inicio, r.intervalo_semanas, v_ate) dd loop
    c := public.sp_grade_conflito(r.profissional_id, r.paciente_id, r.terapia_id, d, r.hora_inicio, r.hora_fim, true);
    data := d;
    conflito := c;
    ok := c is null or (c = 'paciente_ocupado' and r.permitir_paciente_simultaneo);
    return next;
    if ok then
      v_ok := v_ok + 1;
    end if;
    exit when r.total_sessoes is not null and v_ok >= r.total_sessoes;
  end loop;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- B) Leitura
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.grade_profissionais()
returns table (
  id bigint, nome text, ativo boolean, data_saida date, terapia_focal_id bigint,
  foto_path text, tita_profissional_id bigint, terapias bigint[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.sp_grade_exigir_permissao();
  return query
  select p.id, p.nome, p.ativo, p.data_saida, p.terapia_focal_id, p.foto_path, p.tita_profissional_id,
         coalesce((select array_agg(h.terapia_id order by h.terapia_id)
                   from public.profissionais_terapias_habilitadas h
                   where h.profissional_id = p.id), '{}'::bigint[])
  from public.profissionais p
  order by p.nome;
end $$;

create or replace function public.grade_faixas(
  p_de            date,
  p_ate           date,
  p_profissionais bigint[] default null
)
returns table (
  profissional_id bigint, versao_id uuid, versao_numero integer, vigente_de date, vigente_ate date,
  dias_ativos smallint[], faixa_id uuid, dia_semana smallint, hora_inicio time, hora_fim time,
  duracao_min smallint, capacidade smallint, intervalo_ativo boolean, intervalo_inicio time,
  intervalo_fim time, local_id uuid, local_nome text, unidade_nome text, terapias jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.sp_grade_exigir_permissao();
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 120 then
    raise exception 'Período inválido (máximo 120 dias).' using errcode = '22023';
  end if;
  return query
  select v.profissional_id, v.id, v.numero, v.vigente_de, v.vigente_ate, v.dias_ativos,
         f.id, f.dia_semana, f.hora_inicio, f.hora_fim, f.duracao_min, f.capacidade,
         f.intervalo_ativo, f.intervalo_inicio, f.intervalo_fim, f.local_id, f.local_nome, f.unidade_nome,
         coalesce((select jsonb_agg(jsonb_build_object('id', t.terapia_id, 'nome', t.terapia_nome) order by t.terapia_nome)
                   from public.profissionais_disponibilidade_faixa_terapias t
                   where t.faixa_id = f.id), '[]'::jsonb)
  from public.profissionais_disponibilidade_versoes v
  join public.profissionais_disponibilidade_faixas f on f.versao_id = v.id
  where v.substituida_em is null
    and v.vigente_de <= p_ate
    and (v.vigente_ate is null or v.vigente_ate >= p_de)
    and (p_profissionais is null or v.profissional_id = any(p_profissionais))
  order by v.profissional_id, v.vigente_de, f.dia_semana, f.hora_inicio;
end $$;

create or replace function public.grade_feriados(p_de date, p_ate date)
returns table (data date, nome text, tipo text, horario_inicio text, horario_fim text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.sp_grade_exigir_permissao();
  return query
  select f.data, f.nome, f.tipo, f.horario_inicio, f.horario_fim
  from public.feriados f
  where f.data between p_de and p_ate
  order by f.data;
end $$;

-- Só as janelas (sem quem declarou nem telefone).
create or replace function public.grade_disponibilidade_paciente(p_paciente_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v record;
begin
  perform public.sp_grade_exigir_permissao();
  select * into v
  from public.pacientes_disponibilidade_versoes x
  where x.paciente_id = p_paciente_id
  order by x.numero_versao desc
  limit 1;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'numero_versao', v.numero_versao, 'criado_em', v.criado_em,
    'frequenta_escola', v.frequenta_escola, 'escola_inicio', v.escola_inicio, 'escola_fim', v.escola_fim,
    'seg_inicio', v.seg_inicio, 'seg_fim', v.seg_fim, 'ter_inicio', v.ter_inicio, 'ter_fim', v.ter_fim,
    'qua_inicio', v.qua_inicio, 'qua_fim', v.qua_fim, 'qui_inicio', v.qui_inicio, 'qui_fim', v.qui_fim,
    'sex_inicio', v.sex_inicio, 'sex_fim', v.sex_fim, 'sab_inicio', v.sab_inicio, 'sab_fim', v.sab_fim
  );
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- C) Criar
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.grade_simular_agendamento(p jsonb)
returns table (data date, conflito text, ok boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.sp_grade_exigir_permissao();
  return query select * from public.sp_grade_planejar(p);
end $$;

create or replace function public.grade_criar_agendamento(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          record;
  v_nome     text := public.sp_grade_usuario_nome();
  v_pac      record;
  v_prof     record;
  v_ter      record;
  v_exib     record;
  v_local    record;
  v_datas    date[];
  v_puladas  jsonb;
  v_ultima   date;
  v_serie    uuid := gen_random_uuid();
  v_primeira uuid;
  v_fim      date;
  v_mat      date;
  v_n        integer;
  v_resumo   text;
begin
  perform public.sp_grade_exigir_permissao();
  select * into r from public.sp_grade_ler_payload(p);

  -- Mesma ordem de travas em todo lugar: profissional, depois paciente.
  perform pg_advisory_xact_lock(hashtext('grade_prof'), r.profissional_id::integer);
  perform pg_advisory_xact_lock(hashtext('grade_pac'),  r.paciente_id::integer);

  -- Materializa o entorno antes de conferir vaga.
  perform public.sp_grade_estender(r.profissional_id, r.paciente_id);

  create temporary table tmp_grade_plano on commit drop as
  select * from public.sp_grade_planejar(p);

  select array_agg(t.data order by t.data) filter (where t.ok),
         coalesce(jsonb_agg(jsonb_build_object('data', t.data, 'motivo', t.conflito) order by t.data)
                    filter (where not t.ok), '[]'::jsonb),
         max(t.data)
    into v_datas, v_puladas, v_ultima
  from tmp_grade_plano t;

  if v_datas is null or cardinality(v_datas) = 0 then
    raise exception 'Nenhuma data pôde ser agendada: %.',
      coalesce((select public.sp_grade_rotulo_conflito(t.conflito) from tmp_grade_plano t order by t.data limit 1), 'sem datas')
      using errcode = '23P01';
  end if;

  select x.id_paciente, x.nome, x.tita_paciente_id into v_pac from public.pacientes x where x.id_paciente = r.paciente_id;
  select x.id, x.nome, x.tita_profissional_id into v_prof from public.profissionais x where x.id = r.profissional_id;
  select x.id, x.nome, x.tita_terapia_id into v_ter from public.cadastro_terapias x where x.id = r.terapia_id;
  select x.id, x.nome into v_exib from public.cadastro_terapias x where x.id = r.terapia_exibicao_id;

  if r.local_id is not null then
    select s.id as local_id, s.nome_exibicao as local_nome, s.unidade_nome into v_local
    from public.cronograma_salas s where s.id = r.local_id;
  else
    select f.local_id, f.local_nome, f.unidade_nome into v_local
    from public.sp_grade_faixa_do_horario(r.profissional_id, v_datas[1], r.hora_inicio, r.hora_fim) f;
  end if;

  -- Fim e horizonte da série.
  if r.frequencia = 'unica' then
    v_fim := r.data_inicio;  v_mat := r.data_inicio;
  elsif r.total_sessoes is not null then
    v_fim := v_datas[cardinality(v_datas)];  v_mat := v_fim;
  else
    v_fim := r.data_fim;
    v_mat := least(coalesce(r.data_fim, public.sp_grade_horizonte()), public.sp_grade_horizonte());
  end if;

  insert into public.grade_series (
    id, paciente_id, profissional_id, terapia_id, terapia_nome, terapia_exibicao_id, terapia_exibicao_nome,
    dia_semana, hora_inicio, hora_fim, local_id, sala_nome, unidade_nome,
    frequencia, intervalo_semanas, data_inicio, data_fim, total_sessoes, materializada_ate,
    origem, observacao, criado_por, criado_por_nome
  ) values (
    v_serie, r.paciente_id, r.profissional_id, r.terapia_id, v_ter.nome, v_exib.id, v_exib.nome,
    extract(dow from r.data_inicio)::smallint, r.hora_inicio, r.hora_fim,
    v_local.local_id, v_local.local_nome, v_local.unidade_nome,
    r.frequencia, r.intervalo_semanas, r.data_inicio, v_fim, r.total_sessoes, v_mat,
    'pulsar', r.observacao, auth.uid(), v_nome
  );

  insert into public.grade_agendamentos (
    serie_id, data, hora_inicio, hora_fim,
    paciente_id, paciente_nome, profissional_id, profissional_nome,
    terapia_id, terapia_nome, terapia_exibicao_id, terapia_exibicao_nome,
    local_id, sala_nome, unidade_nome, origem,
    tita_paciente_id, tita_profissional_id, tita_terapia_id,
    criado_por, criado_por_nome
  )
  select
    v_serie, d, r.hora_inicio, r.hora_fim,
    r.paciente_id, v_pac.nome, r.profissional_id, v_prof.nome,
    r.terapia_id, v_ter.nome, v_exib.id, v_exib.nome,
    v_local.local_id, v_local.local_nome, v_local.unidade_nome, 'pulsar',
    v_pac.tita_paciente_id, v_prof.tita_profissional_id, v_ter.tita_terapia_id,
    auth.uid(), v_nome
  from unnest(v_datas) d;
  get diagnostics v_n = row_count;

  select a.id into v_primeira from public.grade_agendamentos a where a.serie_id = v_serie order by a.data limit 1;

  v_resumo :=
    case when r.frequencia = 'unica'
         then 'Sessão única em ' || to_char(v_datas[1], 'DD/MM/YYYY')
         else 'Série ' || case when r.intervalo_semanas = 1 then 'semanal' else 'a cada ' || r.intervalo_semanas || ' semanas' end
              || case when r.data_fim is null and r.total_sessoes is null then ' (contínua)' else '' end
    end
    || ' ' || to_char(r.hora_inicio, 'HH24:MI') || '–' || to_char(r.hora_fim, 'HH24:MI')
    || ' — ' || v_pac.nome || ' × ' || v_prof.nome || ' (' || coalesce(v_exib.nome, v_ter.nome) || ')'
    || case when r.frequencia = 'unica' then ''
            else ': ' || v_n || ' sessão(ões) de ' || to_char(v_datas[1], 'DD/MM/YYYY') || ' a ' || to_char(v_datas[cardinality(v_datas)], 'DD/MM/YYYY') end
    || case when jsonb_array_length(v_puladas) > 0
            then '; ' || jsonb_array_length(v_puladas) || ' data(s) pulada(s)' else '' end;

  insert into public.grade_eventos
    (acao, agendamento_id, serie_id, profissional_id, paciente_id, quantidade, depois, resumo, feito_por, feito_por_nome)
  values (
    'criado', v_primeira, v_serie, r.profissional_id, r.paciente_id, v_n,
    jsonb_build_object(
      'payload', p, 'datas', to_jsonb(v_datas), 'puladas', v_puladas,
      'sala', v_local.local_nome, 'unidade', v_local.unidade_nome
    ),
    v_resumo, auth.uid(), v_nome
  );

  return jsonb_build_object(
    'serie_id', v_serie, 'criadas', v_n, 'puladas', v_puladas,
    'primeira', v_datas[1], 'ultima', v_datas[cardinality(v_datas)]
  );
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- D) Excluir
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.grade_excluir_agendamento(
  p_agendamento_id uuid,
  p_escopo         text,
  p_motivo         text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a        record;
  v_nome   text := public.sp_grade_usuario_nome();
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_lote   uuid := gen_random_uuid();
  v_hoje   date := public.hoje_brasilia();
  v_n      integer;
  v_ultima date;
  v_escopo text := p_escopo;
begin
  perform public.sp_grade_exigir_permissao();
  if v_escopo not in ('somente_esta', 'desta_em_diante') then
    raise exception 'Escolha excluir só esta sessão ou desta em diante.' using errcode = '22023';
  end if;
  if length(v_motivo) < 3 then
    raise exception 'Informe o motivo da exclusão.' using errcode = '22023';
  end if;
  if length(v_motivo) > 500 then
    raise exception 'Motivo longo demais (máximo 500).' using errcode = '22023';
  end if;

  select * into a from public.grade_agendamentos where id = p_agendamento_id;
  if not found then
    raise exception 'Agendamento não encontrado.' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('grade_prof'), a.profissional_id::integer);
  select * into a from public.grade_agendamentos where id = p_agendamento_id for update;

  if a.situacao <> 'agendado' then
    raise exception 'Esta sessão já foi excluída em % por %.',
      to_char(a.excluido_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'), a.excluido_por_nome
      using errcode = '22023';
  end if;
  if a.data < v_hoje then
    raise exception 'Sessão de % já passou: não pode ser excluída.', to_char(a.data, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  if a.serie_id is null then
    v_escopo := 'somente_esta';
  end if;

  if v_escopo = 'somente_esta' then
    update public.grade_agendamentos
       set situacao = 'excluido', excluido_em = now(), excluido_por = auth.uid(), excluido_por_nome = v_nome,
           motivo_exclusao = v_motivo, escopo_exclusao = 'somente_esta', lote_id = v_lote
     where id = a.id;
    v_n := 1;
    v_ultima := a.data;
  else
    with exc as (
      update public.grade_agendamentos x
         set situacao = 'excluido', excluido_em = now(), excluido_por = auth.uid(), excluido_por_nome = v_nome,
             motivo_exclusao = v_motivo, escopo_exclusao = 'desta_em_diante', lote_id = v_lote
       where x.serie_id = a.serie_id
         and x.situacao = 'agendado'
         and x.data >= a.data
      returning x.data
    )
    select count(*), max(data) into v_n, v_ultima from exc;

    update public.grade_series s
       set situacao = 'encerrada', encerrada_a_partir = a.data, encerrada_em = now(),
           encerrada_por = auth.uid(), encerrada_por_nome = v_nome, motivo_encerramento = v_motivo,
           data_fim = case when a.data - 1 >= s.data_inicio
                           then least(coalesce(s.data_fim, a.data - 1), a.data - 1)
                           else s.data_fim end
     where s.id = a.serie_id and s.situacao = 'ativa';
  end if;

  insert into public.grade_eventos
    (acao, agendamento_id, serie_id, lote_id, profissional_id, paciente_id, quantidade, antes, motivo, resumo, feito_por, feito_por_nome)
  values (
    'excluido', a.id, a.serie_id, v_lote, a.profissional_id, a.paciente_id, v_n,
    jsonb_build_object('data', a.data, 'hora_inicio', a.hora_inicio, 'hora_fim', a.hora_fim,
                       'paciente', a.paciente_nome, 'profissional', a.profissional_nome,
                       'terapia', coalesce(a.terapia_exibicao_nome, a.terapia_nome), 'sala', a.sala_nome,
                       'escopo', v_escopo, 'ate', v_ultima),
    v_motivo,
    case when v_escopo = 'somente_esta'
         then 'Excluída só a sessão de ' || to_char(a.data, 'DD/MM/YYYY')
         else 'Excluídas ' || v_n || ' sessão(ões) de ' || to_char(a.data, 'DD/MM/YYYY') || ' em diante (até ' || to_char(v_ultima, 'DD/MM/YYYY') || '); série encerrada'
    end
    || ' ' || to_char(a.hora_inicio, 'HH24:MI') || ' — ' || a.paciente_nome || ' × ' || a.profissional_nome
    || ' (' || coalesce(a.terapia_exibicao_nome, a.terapia_nome) || ') — motivo: ' || v_motivo,
    auth.uid(), v_nome
  );

  return jsonb_build_object('excluidas', v_n, 'de', a.data, 'ate', v_ultima, 'escopo', v_escopo);
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- E) Bloqueios
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.grade_criar_bloqueio(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome   text := public.sp_grade_usuario_nome();
  v_prof   bigint   := (p ->> 'profissional_id')::bigint;
  v_ini    date     := (p ->> 'data_inicio')::date;
  v_fim    date     := nullif(p ->> 'data_fim', '')::date;
  v_hi     time     := nullif(p ->> 'hora_inicio', '')::time;
  v_hf     time     := nullif(p ->> 'hora_fim', '')::time;
  v_dias   smallint[];
  v_tipo   text     := coalesce(nullif(p ->> 'tipo', ''), 'bloqueio');
  v_motivo text     := btrim(coalesce(p ->> 'motivo', ''));
  v_prof_nome text;
  v_id     uuid;
  v_afet   integer;
begin
  perform public.sp_grade_exigir_permissao();
  select x.nome into v_prof_nome from public.profissionais x where x.id = v_prof;
  if not found then
    raise exception 'Profissional não encontrado.' using errcode = 'P0002';
  end if;
  if v_ini is null or v_ini < public.hoje_brasilia() then
    raise exception 'O bloqueio começa hoje ou depois.' using errcode = '22023';
  end if;
  if jsonb_typeof(p -> 'dias_semana') = 'array' and jsonb_array_length(p -> 'dias_semana') > 0 then
    select array_agg(distinct (x #>> '{}')::smallint order by (x #>> '{}')::smallint) into v_dias
    from jsonb_array_elements(p -> 'dias_semana') x;
  end if;
  if length(v_motivo) < 2 then
    raise exception 'Informe o motivo do bloqueio.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('grade_prof'), v_prof::integer);

  insert into public.grade_bloqueios (
    profissional_id, data_inicio, data_fim, hora_inicio, hora_fim, dias_semana, tipo, motivo,
    origem, criado_por, criado_por_nome
  ) values (
    v_prof, v_ini, v_fim, v_hi, v_hf, v_dias, v_tipo, v_motivo, 'pulsar', auth.uid(), v_nome
  )
  returning id into v_id;

  -- Sessões que já estão agendadas dentro do bloqueio continuam (a tela avisa).
  select count(*) into v_afet
  from public.grade_agendamentos a
  where a.profissional_id = v_prof and a.situacao = 'agendado'
    and a.data >= v_ini and (v_fim is null or a.data <= v_fim)
    and (v_dias is null or a.dia_semana = any(v_dias))
    and (v_hi is null or (a.hora_inicio < v_hf and a.hora_fim > v_hi));

  insert into public.grade_eventos
    (acao, bloqueio_id, profissional_id, depois, motivo, resumo, feito_por, feito_por_nome)
  values (
    'bloqueio_criado', v_id, v_prof,
    jsonb_build_object('data_inicio', v_ini, 'data_fim', v_fim, 'hora_inicio', v_hi, 'hora_fim', v_hf,
                       'dias_semana', v_dias, 'tipo', v_tipo, 'sessoes_no_periodo', v_afet),
    v_motivo,
    'Bloqueio (' || v_tipo || ') de ' || v_prof_nome || ': ' || to_char(v_ini, 'DD/MM/YYYY')
      || case when v_fim is null then ' sem término' when v_fim <> v_ini then ' a ' || to_char(v_fim, 'DD/MM/YYYY') else '' end
      || case when v_hi is null then ', dia inteiro' else ', ' || to_char(v_hi, 'HH24:MI') || '–' || to_char(v_hf, 'HH24:MI') end
      || ' — ' || v_motivo,
    auth.uid(), v_nome
  );

  return jsonb_build_object('id', v_id, 'sessoes_no_periodo', v_afet);
end $$;

create or replace function public.grade_excluir_bloqueio(p_bloqueio_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b        record;
  v_nome   text := public.sp_grade_usuario_nome();
  v_hoje   date := public.hoje_brasilia();
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_modo   text;
  v_prof   text;
begin
  perform public.sp_grade_exigir_permissao();
  if length(v_motivo) < 3 or length(v_motivo) > 500 then
    raise exception 'Informe o motivo (3 a 500 caracteres).' using errcode = '22023';
  end if;
  select * into b from public.grade_bloqueios where id = p_bloqueio_id for update;
  if not found or b.situacao <> 'ativo' then
    raise exception 'Bloqueio não encontrado ou já excluído.' using errcode = 'P0002';
  end if;
  if b.data_fim is not null and b.data_fim < v_hoje then
    raise exception 'Este bloqueio já terminou.' using errcode = '22023';
  end if;

  if b.data_inicio >= v_hoje then
    update public.grade_bloqueios
       set situacao = 'excluido', excluido_em = now(), excluido_por = auth.uid(),
           excluido_por_nome = v_nome, motivo_exclusao = v_motivo
     where id = b.id;
    v_modo := 'excluido';
  else
    -- Já começou: os dias passados ficam como foram; termina ontem.
    update public.grade_bloqueios set data_fim = v_hoje - 1 where id = b.id;
    v_modo := 'encerrado';
  end if;

  select x.nome into v_prof from public.profissionais x where x.id = b.profissional_id;

  insert into public.grade_eventos
    (acao, bloqueio_id, profissional_id, antes, motivo, resumo, feito_por, feito_por_nome)
  values (
    'bloqueio_excluido', b.id, b.profissional_id,
    jsonb_build_object('data_inicio', b.data_inicio, 'data_fim', b.data_fim, 'hora_inicio', b.hora_inicio,
                       'hora_fim', b.hora_fim, 'tipo', b.tipo, 'motivo', b.motivo, 'modo', v_modo),
    v_motivo,
    case when v_modo = 'excluido' then 'Bloqueio excluído' else 'Bloqueio encerrado ontem' end
      || ' — ' || coalesce(v_prof, '?') || ' (' || b.motivo || ') — motivo: ' || v_motivo,
    auth.uid(), v_nome
  );

  return jsonb_build_object('modo', v_modo);
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- F) Estender séries (pg_cron)
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.grade_estender_series()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  -- Só o dono (pg_cron) e a service_role executam: sem EXECUTE para authenticated.
  v := public.sp_grade_estender(null, null);
  if (v ->> 'criadas')::integer > 0 or jsonb_array_length(v -> 'puladas') > 0 then
    insert into public.grade_eventos (acao, quantidade, depois, resumo, feito_por_nome)
    values (
      'estendido', (v ->> 'criadas')::integer, v,
      'Repetição automática: ' || (v ->> 'criadas') || ' sessão(ões) criada(s) em ' || (v ->> 'series') || ' série(s)'
        || case when jsonb_array_length(v -> 'puladas') > 0
                then '; ' || jsonb_array_length(v -> 'puladas') || ' data(s) pulada(s)' else '' end,
      'Repetição automática'
    );
  end if;
  return v - 'puladas' || jsonb_build_object('puladas', jsonb_array_length(v -> 'puladas'));
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- GRANTs — funções nascem com EXECUTE para PUBLIC (anon incluso): revogar.
-- ═════════════════════════════════════════════════════════════════════════════
revoke all on function public.sp_grade_usuario_nome()                                   from public, anon, authenticated;
revoke all on function public.sp_grade_exigir_permissao()                               from public, anon, authenticated;
revoke all on function public.sp_grade_horizonte()                                      from public, anon, authenticated;
revoke all on function public.sp_grade_rotulo_conflito(text)                            from public, anon, authenticated;
revoke all on function public.sp_grade_datas(date, smallint, date)                      from public, anon, authenticated;
revoke all on function public.sp_grade_faixa_do_horario(bigint, date, time, time)       from public, anon, authenticated;
revoke all on function public.sp_grade_conflito(bigint, bigint, bigint, date, time, time, boolean) from public, anon, authenticated;
revoke all on function public.sp_grade_estender(bigint, bigint)                         from public, anon, authenticated;
revoke all on function public.sp_grade_ler_payload(jsonb)                               from public, anon, authenticated;
revoke all on function public.sp_grade_planejar(jsonb)                                  from public, anon, authenticated;

revoke all on function public.grade_profissionais()                          from public, anon;
revoke all on function public.grade_faixas(date, date, bigint[])             from public, anon;
revoke all on function public.grade_feriados(date, date)                     from public, anon;
revoke all on function public.grade_disponibilidade_paciente(bigint)         from public, anon;
revoke all on function public.grade_simular_agendamento(jsonb)               from public, anon;
revoke all on function public.grade_criar_agendamento(jsonb)                 from public, anon;
revoke all on function public.grade_excluir_agendamento(uuid, text, text)    from public, anon;
revoke all on function public.grade_criar_bloqueio(jsonb)                    from public, anon;
revoke all on function public.grade_excluir_bloqueio(uuid, text)             from public, anon;
revoke all on function public.grade_estender_series()                        from public, anon, authenticated;

grant execute on function public.grade_profissionais()                       to authenticated;
grant execute on function public.grade_faixas(date, date, bigint[])          to authenticated;
grant execute on function public.grade_feriados(date, date)                  to authenticated;
grant execute on function public.grade_disponibilidade_paciente(bigint)      to authenticated;
grant execute on function public.grade_simular_agendamento(jsonb)            to authenticated;
grant execute on function public.grade_criar_agendamento(jsonb)              to authenticated;
grant execute on function public.grade_excluir_agendamento(uuid, text, text) to authenticated;
grant execute on function public.grade_criar_bloqueio(jsonb)                 to authenticated;
grant execute on function public.grade_excluir_bloqueio(uuid, text)          to authenticated;
grant execute on function public.grade_estender_series()                     to service_role;
