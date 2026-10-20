-- Reverte 20261019220000_app_cobertura_pela_central: tira o gatilho da Central,
-- devolve grade_detalhe_evolucao e grade_definir_cobertura às definições de
-- produção anteriores (20261019120000 / 20261019210000), apaga as coberturas e
-- os eventos de origem central e a coluna origem.
begin;
set local lock_timeout = '5s';

drop trigger if exists trg_controle_terapeutico_cobertura_grade on public.controle_terapeutico;
drop function if exists public.sp_grade_cobertura_da_central();

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
  if public.sp_grade_pode_evoluir(p_agendamento_id) then
    return v;
  end if;

  return v || jsonb_build_object(
    'descricao_evolucao', null,
    'carimbo', null
  );
end $$;

drop function if exists public.sp_grade_pode_ler_evolucao(uuid);

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

  insert into public.grade_coberturas (agendamento_id, profissional_id, criado_por, criado_por_nome, criado_em)
  values (a.id, pr.id, v_autor.usuario_id, v_autor.usuario_nome, now())
  on conflict (agendamento_id) do update
     set profissional_id = excluded.profissional_id,
         criado_por      = excluded.criado_por,
         criado_por_nome = excluded.criado_por_nome,
         criado_em       = excluded.criado_em;

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

delete from public.grade_eventos
 where acao in ('cobertura_definida', 'cobertura_removida')
   and (depois ->> 'origem' = 'central' or antes ->> 'origem' = 'central');
delete from public.grade_coberturas where origem = 'central';

alter table public.grade_coberturas drop constraint if exists grade_coberturas_origem_check;
alter table public.grade_coberturas drop column if exists origem;
comment on table public.grade_coberturas is
  'Cobertura planejada: profissional que vai atender a sessão no lugar do agendado. Escrita só por grade_definir_cobertura/grade_remover_cobertura.';

delete from supabase_migrations.schema_migrations where version = '20261019220000';

commit;

select not exists (select 1 from pg_trigger where tgname = 'trg_controle_terapeutico_cobertura_grade') as gatilho_removido,
       to_regprocedure('public.sp_grade_pode_ler_evolucao(uuid)') is null as leitura_removida,
       not exists (select 1 from information_schema.columns where table_name = 'grade_coberturas' and column_name = 'origem') as coluna_removida;
