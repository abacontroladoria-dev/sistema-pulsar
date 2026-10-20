-- Fase 2b do app de evoluções (docs/app-evolucoes/PLANO_BACKEND.md), decidida
-- em 19/10/2026: a cobertura vem da Central de Terapeutas, e o agendado lê a
-- evolução da sessão coberta.
--
-- 1. Gatilho em controle_terapeutico — quando a equipe marca "substituído" na
--    Central (status 'substituido' + profissional_substituto_id), grava
--    grade_coberturas para a sessão da Grade com o mesmo tita_agendamento_id
--    (único entre as 'agendado'); quando desmarca, troca para outro status ou
--    apaga, remove. O substituto da Central é quem evolui no app.
--    - A Central guarda ids do TiTa: o substituto é achado por
--      profissionais.tita_profissional_id (único).
--    - Sessão que já tem registro não muda de cobertura: o registro fica com
--      quem o fez.
--    - Nunca derruba a gravação da Central: qualquer erro vira WARNING.
--    - grade_coberturas.origem diz de onde veio ('grade' = grade_definir_cobertura,
--      'central' = este gatilho). Desmarcar na Central só remove a 'central'.
--    Medido em 19/10: desde 12/10 as 32 substituições casaram 1:1 com a Grade;
--    as 193 anteriores são de dias que a Grade não tinha.
--
-- 2. sp_grade_pode_ler_evolucao — quem pode evoluir, ou o terapeuta AGENDADO da
--    sessão (mesmo coberta por outro: o paciente é dele). grade_detalhe_evolucao
--    passa a usá-la para devolver o texto. Gravar continua só com quem evolui.
--
-- 3. Carga inicial: substituições já marcadas em sessões sem registro.
--
-- Idempotente.

set lock_timeout = '5s';

-- ── Origem da cobertura ─────────────────────────────────────────────────────
alter table public.grade_coberturas
  add column if not exists origem text not null default 'grade';

alter table public.grade_coberturas drop constraint if exists grade_coberturas_origem_check;
alter table public.grade_coberturas
  add constraint grade_coberturas_origem_check check (origem in ('grade', 'central'));

comment on table public.grade_coberturas is
  'Cobertura: profissional que atende a sessão no lugar do agendado. Escrita por grade_definir_cobertura (origem grade) e pelo gatilho da Central de Terapeutas (origem central).';

-- Definição manual pela Grade passa a marcar a origem (resto igual a 20261019210000).
create or replace function public.grade_definir_cobertura(p_agendamento_id uuid, p_profissional_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a       record;
  pr      record;
  ant     record;
  v_autor record;
begin
  perform public.sp_grade_exigir_permissao();

  select ag.*, coalesce(pac.nome, ag.paciente_nome) as pac_nome_atual,
         coalesce(pa.nome, ag.profissional_nome) as prof_nome_atual
    into a
    from public.grade_agendamentos ag
    left join public.pacientes pac on pac.id_paciente = ag.paciente_id
    left join public.profissionais pa on pa.id = ag.profissional_id
   where ag.id = p_agendamento_id
   for update of ag;
  if not found then
    raise exception 'Sessão não encontrada.' using errcode = 'P0002';
  end if;
  if a.situacao = 'excluido' then
    raise exception 'Esta sessão foi excluída da Grade.' using errcode = '22023';
  end if;

  select p.id, p.nome into pr from public.profissionais p where p.id = p_profissional_id and p.ativo;
  if not found then
    raise exception 'Profissional não encontrado ou inativo.' using errcode = 'P0002';
  end if;
  if pr.id = a.profissional_id then
    raise exception 'O profissional escolhido já é o da sessão.' using errcode = '22023';
  end if;
  if exists (select 1 from public.grade_evolucoes e where e.agendamento_id = a.id) then
    raise exception 'Esta sessão já tem evolução ou falta registrada.' using errcode = '22023';
  end if;

  select * into v_autor from public.sp_grade_autor_evolucao();
  select c.*, p.nome as prof_nome into ant
    from public.grade_coberturas c left join public.profissionais p on p.id = c.profissional_id
   where c.agendamento_id = a.id;

  insert into public.grade_coberturas (agendamento_id, profissional_id, criado_por, criado_por_nome, criado_em, origem)
  values (a.id, pr.id, v_autor.usuario_id, v_autor.usuario_nome, now(), 'grade')
  on conflict (agendamento_id) do update
     set profissional_id = excluded.profissional_id,
         criado_por      = excluded.criado_por,
         criado_por_nome = excluded.criado_por_nome,
         criado_em       = excluded.criado_em,
         origem          = excluded.origem;

  insert into public.grade_eventos (
    acao, agendamento_id, serie_id, profissional_id, paciente_id, quantidade,
    antes, depois, resumo, feito_por, feito_por_nome
  ) values (
    'cobertura_definida', a.id, a.serie_id, a.profissional_id, a.paciente_id, 1,
    case when ant.agendamento_id is not null
      then jsonb_build_object('cobertura_profissional_id', ant.profissional_id, 'cobertura_profissional_nome', ant.prof_nome)
      else null end,
    jsonb_build_object('cobertura_profissional_id', pr.id, 'cobertura_profissional_nome', pr.nome),
    'Cobertura (' || to_char(a.data, 'DD/MM/YYYY') || ' ' || to_char(a.hora_inicio, 'HH24:MI') || ') — '
      || a.pac_nome_atual || ' × ' || a.prof_nome_atual || ' · coberta por ' || pr.nome,
    v_autor.usuario_id, v_autor.usuario_nome
  );

  return jsonb_build_object('agendamento_id', a.id, 'profissional_id', pr.id, 'profissional_nome', pr.nome);
end $$;

-- ── 1. Cobertura pela Central de Terapeutas ─────────────────────────────────
create or replace function public.sp_grade_cobertura_da_central()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tita       bigint;
  v_autor_id   uuid;
  v_autor_nome text;
  v_sub_id     bigint;
  v_sub_nome   text;
  v_ant_prof   bigint;
  v_ant_nome   text;
  v_ant_origem text;
  a            record;
begin
  if tg_op = 'DELETE' then
    v_tita := old.tita_agendamento_id;
  else
    v_tita := new.tita_agendamento_id;
    v_autor_id := new.confirmado_por;
    v_autor_nome := new.confirmado_por_nome;
  end if;

  begin
    select ag.id, ag.serie_id, ag.data, ag.hora_inicio, ag.profissional_id, ag.paciente_id,
           coalesce(pac.nome, ag.paciente_nome) as pac_nome_atual,
           coalesce(pa.nome, ag.profissional_nome) as prof_nome_atual
      into a
      from public.grade_agendamentos ag
      left join public.pacientes pac on pac.id_paciente = ag.paciente_id
      left join public.profissionais pa on pa.id = ag.profissional_id
     where ag.tita_agendamento_id = v_tita
       and ag.situacao = 'agendado';
    if not found then
      return null;  -- sessão fora da Grade
    end if;

    -- Já registrada: a cobertura fica como está.
    if exists (select 1 from public.grade_evolucoes e where e.agendamento_id = a.id) then
      return null;
    end if;

    if tg_op <> 'DELETE' and new.status = 'substituido' and new.profissional_substituto_id is not null then
      select p.id, p.nome into v_sub_id, v_sub_nome
        from public.profissionais p
       where p.tita_profissional_id = new.profissional_substituto_id;
      if v_sub_id = a.profissional_id then
        v_sub_id := null;  -- "substituto" é o próprio agendado
      end if;
    end if;

    select c.profissional_id, p.nome, c.origem into v_ant_prof, v_ant_nome, v_ant_origem
      from public.grade_coberturas c left join public.profissionais p on p.id = c.profissional_id
     where c.agendamento_id = a.id;

    if v_sub_id is not null then
      if v_ant_prof = v_sub_id then
        return null;  -- nada mudou (a Central regrava a linha a cada salvamento)
      end if;

      insert into public.grade_coberturas (agendamento_id, profissional_id, criado_por, criado_por_nome, criado_em, origem)
      values (a.id, v_sub_id, v_autor_id, coalesce(v_autor_nome, 'Central de Terapeutas'), now(), 'central')
      on conflict (agendamento_id) do update
         set profissional_id = excluded.profissional_id,
             criado_por      = excluded.criado_por,
             criado_por_nome = excluded.criado_por_nome,
             criado_em       = excluded.criado_em,
             origem          = excluded.origem;

      insert into public.grade_eventos (
        acao, agendamento_id, serie_id, profissional_id, paciente_id, quantidade,
        antes, depois, resumo, feito_por, feito_por_nome
      ) values (
        'cobertura_definida', a.id, a.serie_id, a.profissional_id, a.paciente_id, 1,
        case when v_ant_prof is not null
          then jsonb_build_object('cobertura_profissional_id', v_ant_prof, 'cobertura_profissional_nome', v_ant_nome)
          else null end,
        jsonb_build_object('cobertura_profissional_id', v_sub_id, 'cobertura_profissional_nome', v_sub_nome, 'origem', 'central'),
        'Cobertura pela Central de Terapeutas (' || to_char(a.data, 'DD/MM/YYYY') || ' ' || to_char(a.hora_inicio, 'HH24:MI')
          || ') — ' || a.pac_nome_atual || ' × ' || a.prof_nome_atual || ' · coberta por ' || v_sub_nome,
        v_autor_id, coalesce(v_autor_nome, 'Central de Terapeutas')
      );

    elsif v_ant_origem = 'central' then
      delete from public.grade_coberturas c where c.agendamento_id = a.id;

      insert into public.grade_eventos (
        acao, agendamento_id, serie_id, profissional_id, paciente_id, quantidade,
        antes, resumo, feito_por, feito_por_nome
      ) values (
        'cobertura_removida', a.id, a.serie_id, a.profissional_id, a.paciente_id, 1,
        jsonb_build_object('cobertura_profissional_id', v_ant_prof, 'cobertura_profissional_nome', v_ant_nome, 'origem', 'central'),
        'Cobertura removida pela Central de Terapeutas (' || to_char(a.data, 'DD/MM/YYYY') || ' '
          || to_char(a.hora_inicio, 'HH24:MI') || ') — ' || a.pac_nome_atual || ' × ' || a.prof_nome_atual,
        v_autor_id, coalesce(v_autor_nome, 'Central de Terapeutas')
      );
    end if;
  exception when others then
    raise warning 'Cobertura pela Central (tita_agendamento_id %) não aplicada: % (%)', v_tita, sqlerrm, sqlstate;
  end;

  return null;
end $$;

drop trigger if exists trg_controle_terapeutico_cobertura_grade on public.controle_terapeutico;
create trigger trg_controle_terapeutico_cobertura_grade
  after insert or update of status, profissional_substituto_id or delete on public.controle_terapeutico
  for each row execute function public.sp_grade_cobertura_da_central();

-- ── 2. Quem lê o texto da evolução ──────────────────────────────────────────
create or replace function public.sp_grade_pode_ler_evolucao(p_agendamento_id uuid default null)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.sp_grade_pode_evoluir(p_agendamento_id) then
    return true;
  end if;
  if auth.uid() is null or p_agendamento_id is null then
    return false;
  end if;

  -- Terapeuta agendado da sessão, mesmo coberta por outro.
  return exists (
    select 1
      from public.usuarios u
      join public.profissionais p on p.id = u.profissional_id and p.ativo
      join public.grade_agendamentos ag on ag.id = p_agendamento_id
     where u.id = auth.uid()
       and coalesce(u.ativo, false)
       and u.role = 'terapeuta'
       and ag.profissional_id = u.profissional_id
  );
end $$;

create or replace function public.grade_detalhe_evolucao(p_agendamento_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb := public.sp_grade_detalhe_evolucao_interno(p_agendamento_id);
begin
  if public.sp_grade_pode_ler_evolucao(p_agendamento_id) then
    return v;
  end if;

  return v || jsonb_build_object(
    'descricao_evolucao', null,
    'carimbo', null
  );
end $$;

revoke all on function public.sp_grade_cobertura_da_central()      from public, anon, authenticated;
revoke all on function public.sp_grade_pode_ler_evolucao(uuid)      from public, anon, authenticated;

-- ── 3. Carga inicial ────────────────────────────────────────────────────────
with alvo as (
  select ag.id, ag.serie_id, ag.data, ag.hora_inicio, ag.profissional_id, ag.paciente_id,
         coalesce(pac.nome, ag.paciente_nome) as pac_nome_atual,
         coalesce(pa.nome, ag.profissional_nome) as prof_nome_atual,
         sub.id as sub_id, sub.nome as sub_nome,
         ct.confirmado_por, coalesce(ct.confirmado_por_nome, 'Central de Terapeutas') as autor_nome
    from public.controle_terapeutico ct
    join public.grade_agendamentos ag
      on ag.tita_agendamento_id = ct.tita_agendamento_id and ag.situacao = 'agendado'
    join public.profissionais sub on sub.tita_profissional_id = ct.profissional_substituto_id
    left join public.pacientes pac on pac.id_paciente = ag.paciente_id
    left join public.profissionais pa on pa.id = ag.profissional_id
   where ct.status = 'substituido'
     and sub.id <> ag.profissional_id
     and not exists (select 1 from public.grade_evolucoes e where e.agendamento_id = ag.id)
     and not exists (select 1 from public.grade_coberturas c where c.agendamento_id = ag.id)
), gravadas as (
  insert into public.grade_coberturas (agendamento_id, profissional_id, criado_por, criado_por_nome, criado_em, origem)
  select id, sub_id, confirmado_por, autor_nome, now(), 'central' from alvo
  returning agendamento_id
)
insert into public.grade_eventos (
  acao, agendamento_id, serie_id, profissional_id, paciente_id, quantidade,
  depois, resumo, feito_por, feito_por_nome
)
select 'cobertura_definida', a.id, a.serie_id, a.profissional_id, a.paciente_id, 1,
       jsonb_build_object('cobertura_profissional_id', a.sub_id, 'cobertura_profissional_nome', a.sub_nome, 'origem', 'central'),
       'Cobertura pela Central de Terapeutas (' || to_char(a.data, 'DD/MM/YYYY') || ' ' || to_char(a.hora_inicio, 'HH24:MI')
         || ') — ' || a.pac_nome_atual || ' × ' || a.prof_nome_atual || ' · coberta por ' || a.sub_nome,
       a.confirmado_por, a.autor_nome
  from alvo a
  join gravadas g on g.agendamento_id = a.id;
