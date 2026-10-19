-- Exportar Evoluções passa a ler SÓ da grade_evolucoes (decisão do usuário,
-- 19/10/2026): a do TiTa vem do arquivo (linhas sem sessão na Grade, origem
-- tita_importacao — 20261019200300, desde 01/01/2026 com a carga histórica) e a
-- do Pulsar das linhas origem = 'pulsar'. Antes a fonte do TiTa era a cópia
-- csv_grades_profissionais, que só guarda o texto dos últimos ~45 dias.
--
-- A chave do card muda de 'tita:<uuid da cópia>' para 'tita:<id da
-- grade_evolucoes>'. Quem estiver com a tela aberta só precisa recarregar.
-- Regras iguais às de antes: terapia de exibição, profissional = quem executou,
-- o mesmo atendimento não aparece duas vezes (vale o do Pulsar).
-- Idempotente: pode rodar de novo.

do $$
begin
  if to_regprocedure('public.exportar_evolucoes_listar(date, date, bigint[], text[])') is null then
    raise exception 'Aplique antes a 20261019200000_exportar_evolucoes.sql.';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'grade_evolucoes' and column_name = 'chave_tita'
  ) then
    raise exception 'Aplique antes a 20261019200300_grade_evolucoes_historico_tita.sql.';
  end if;
end $$;

drop function if exists public.sp_exportar_evolucoes_fonte(date, date, uuid[], uuid[]);
drop function if exists public.sp_exportar_evolucoes_fonte(date, date, bigint[], uuid[]);

create function public.sp_exportar_evolucoes_fonte(
  p_de         date,
  p_ate        date,
  p_tita_ids   bigint[] default null,
  p_pulsar_ids uuid[] default null
)
returns table (
  chave               text,
  origem              text,
  agendamento_id      text,
  data                date,
  hora_inicio         time,
  hora_fim            time,
  paciente_id         bigint,
  paciente_nome       text,
  paciente_cpf        text,
  paciente_nascimento date,
  convenio            text,
  terapia             text,
  profissional_id     bigint,
  profissional_nome   text,
  tipo_registro       text,
  uf_registro         text,
  codigo_registro     text,
  assinatura_path     text,
  substituicao        boolean,
  registrado_por_nome text,
  descricao           text
)
language sql
stable
security definer
set search_path = ''
as $$
  -- TiTa: o arquivo (linhas sem sessão na Grade).
  select
    'tita:' || e.id::text,
    'tita',
    e.tita_agendamento_id::text,
    e.data,
    e.hora_inicio,
    e.hora_fim,
    pac.id_paciente,
    coalesce(nullif(btrim(pac.nome), ''), e.paciente_nome),
    pac.cpf,
    pac.data_nascimento,
    coalesce(nullif(btrim(e.convenio_nome), ''), pac.convenio_nome),
    coalesce(nullif(btrim(e.terapia_exibicao_nome), ''), e.terapia_nome),
    pe.id,
    coalesce(nullif(btrim(pe.nome), ''), e.tratativa_profissional_nome, e.profissional_nome),
    pe.tipo_registro,
    pe.uf_registro,
    pe.codigo_registro,
    pe.assinatura_path,
    (e.tita_tratativa_profissional_id is distinct from e.tita_profissional_id),
    null::text,
    e.descricao_evolucao
  from public.grade_evolucoes e
  left join public.pacientes pac on pac.tita_paciente_id = e.tita_paciente_id
  left join public.profissionais pe on pe.tita_profissional_id = e.tita_tratativa_profissional_id
  where e.agendamento_id is null
    and e.origem = 'tita_importacao'
    and length(btrim(coalesce(e.descricao_evolucao, ''))) > 0
    and (p_tita_ids is null or e.id = any (p_tita_ids))
    and (p_de is null or e.data >= p_de)
    and (p_ate is null or e.data <= p_ate)
    -- Havendo registro do Pulsar para o mesmo atendimento, vale o do Pulsar.
    and not (
      e.tita_agendamento_id is not null
      and (
        exists (
          select 1 from public.grade_evolucoes gp
           where gp.origem = 'pulsar' and gp.tita_agendamento_id = e.tita_agendamento_id
        )
        or exists (
          select 1
            from public.grade_evolucoes gp
            join public.grade_agendamentos ga on ga.id = gp.agendamento_id
           where gp.origem = 'pulsar' and ga.tita_agendamento_id = e.tita_agendamento_id
        )
      )
    )

  union all

  select
    'pulsar:' || ge.agendamento_id::text,
    'pulsar',
    coalesce(ga.tita_agendamento_id::text, ge.tita_agendamento_id::text, ga.id::text),
    ga.data,
    ga.hora_inicio,
    ga.hora_fim,
    pac.id_paciente,
    coalesce(nullif(btrim(pac.nome), ''), ga.paciente_nome),
    pac.cpf,
    pac.data_nascimento,
    pac.convenio_nome,
    coalesce(nullif(btrim(ct.nome), ''), nullif(btrim(ga.terapia_exibicao_nome), ''), ga.terapia_nome),
    pe.id,
    -- Nome do cadastro pelo id; tratativa_profissional_nome NÃO (é o admin que digitou).
    coalesce(nullif(btrim(pe.nome), ''), ga.profissional_nome),
    pe.tipo_registro,
    pe.uf_registro,
    pe.codigo_registro,
    pe.assinatura_path,
    (ge.tratativa_profissional_id is not null and ge.tratativa_profissional_id is distinct from ga.profissional_id),
    ge.registrado_por_nome,
    ge.descricao_evolucao
  from public.grade_evolucoes ge
  join public.grade_agendamentos ga on ga.id = ge.agendamento_id
  left join public.pacientes pac on pac.id_paciente = ga.paciente_id
  left join public.cadastro_terapias ct on ct.id = ga.terapia_exibicao_id
  left join public.profissionais pe on pe.id = coalesce(ge.tratativa_profissional_id, ga.profissional_id)
  where ge.origem = 'pulsar'
    and ge.status_execucao = 'Realizado'
    and length(btrim(coalesce(ge.descricao_evolucao, ''))) > 0
    and (p_pulsar_ids is null or ge.agendamento_id = any (p_pulsar_ids))
    and (p_de is null or ga.data >= p_de)
    and (p_ate is null or ga.data <= p_ate)
$$;

revoke all on function public.sp_exportar_evolucoes_fonte(date, date, bigint[], uuid[]) from public, anon, authenticated, service_role;

create or replace function public.exportar_evolucoes_listar(
  p_de          date,
  p_ate         date,
  p_paciente_ids bigint[] default null,
  p_terapias    text[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if p_de is null or p_ate is null then
    raise exception 'Informe o período.' using errcode = '22023';
  end if;
  if p_ate < p_de then
    raise exception 'A data final é anterior à inicial.' using errcode = '22023';
  end if;
  if p_ate > (p_de + interval '12 months' - interval '1 day')::date then
    raise exception 'O período pode ter no máximo 12 meses.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'chave', f.chave,
           'origem', f.origem,
           'agendamento_id', f.agendamento_id,
           'data', f.data,
           'hora_inicio', to_char(f.hora_inicio, 'HH24:MI'),
           'hora_fim', to_char(f.hora_fim, 'HH24:MI'),
           'paciente_id', f.paciente_id,
           'paciente_nome', f.paciente_nome,
           'convenio', f.convenio,
           'terapia', f.terapia,
           'profissional_id', f.profissional_id,
           'profissional_nome', f.profissional_nome,
           'tem_assinatura', f.assinatura_path is not null,
           'substituicao', f.substituicao
         ) order by lower(f.paciente_nome), f.paciente_id, f.data, f.hora_inicio, f.chave), '[]'::jsonb)
    into v
    from public.sp_exportar_evolucoes_fonte(p_de, p_ate, null, null) f
   where (p_paciente_ids is null or cardinality(p_paciente_ids) = 0 or f.paciente_id = any (p_paciente_ids))
     and (p_terapias is null or cardinality(p_terapias) = 0 or f.terapia = any (p_terapias));

  return v;
end $$;

revoke all on function public.exportar_evolucoes_listar(date, date, bigint[], text[]) from public, anon, authenticated;
grant execute on function public.exportar_evolucoes_listar(date, date, bigint[], text[]) to service_role;

create or replace function public.exportar_evolucoes_conteudo(
  p_chaves       text[],
  p_usuario_id   uuid,
  p_usuario_nome text,
  p_finalidade   text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tita   bigint[];
  v_pulsar uuid[];
  v        jsonb;
  v_qtd    integer;
  v_de     date;
  v_ate    date;
  v_pacs   bigint[];
  v_chaves text[];
begin
  if p_finalidade is null or p_finalidade not in ('visualizacao', 'pdf', 'csv') then
    raise exception 'Finalidade inválida.' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_chaves), 0) = 0 then
    return '[]'::jsonb;
  end if;
  if cardinality(p_chaves) > 500 then
    raise exception 'No máximo 500 evoluções por pedido.' using errcode = '22023';
  end if;

  -- Só chaves bem formadas viram uuid; o resto é ignorado.
  select array_agg(substr(c, 6)::bigint) filter (where c ~ '^tita:[0-9]{1,18}$'),
         array_agg(substr(c, 8)::uuid) filter (where c ~* '^pulsar:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    into v_tita, v_pulsar
    from unnest(p_chaves) c;

  if v_tita is null and v_pulsar is null then
    return '[]'::jsonb;
  end if;

  with f as (
    select *
      from public.sp_exportar_evolucoes_fonte(null, null, coalesce(v_tita, '{}'), coalesce(v_pulsar, '{}'))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'chave', f.chave,
           'origem', f.origem,
           'agendamento_id', f.agendamento_id,
           'data', f.data,
           'hora_inicio', to_char(f.hora_inicio, 'HH24:MI'),
           'hora_fim', to_char(f.hora_fim, 'HH24:MI'),
           'paciente_id', f.paciente_id,
           'paciente_nome', f.paciente_nome,
           'paciente_cpf', f.paciente_cpf,
           'paciente_nascimento', f.paciente_nascimento,
           'convenio', f.convenio,
           'terapia', f.terapia,
           'profissional_id', f.profissional_id,
           'profissional_nome', f.profissional_nome,
           'tipo_registro', f.tipo_registro,
           'uf_registro', f.uf_registro,
           'codigo_registro', f.codigo_registro,
           'tem_assinatura', f.assinatura_path is not null,
           'substituicao', f.substituicao,
           'registrado_por_nome', f.registrado_por_nome,
           'descricao', f.descricao
         ) order by lower(f.paciente_nome), f.paciente_id, f.data, f.hora_inicio, f.chave), '[]'::jsonb),
         count(*)::integer,
         min(f.data),
         max(f.data),
         coalesce(array_agg(distinct f.paciente_id) filter (where f.paciente_id is not null), '{}'),
         coalesce(array_agg(f.chave), '{}')
    into v, v_qtd, v_de, v_ate, v_pacs, v_chaves
    from f;

  if v_qtd > 0 then
    insert into public.exportar_evolucoes_registro (
      usuario_id, usuario_nome, finalidade, quantidade, periodo_de, periodo_ate, paciente_ids, chaves
    ) values (
      p_usuario_id,
      coalesce(nullif(btrim(p_usuario_nome), ''), 'Usuário do Pulsar'),
      p_finalidade, v_qtd, v_de, v_ate, v_pacs, v_chaves
    );
  end if;

  return v;
end $$;

revoke all on function public.exportar_evolucoes_conteudo(text[], uuid, text, text) from public, anon, authenticated;
grant execute on function public.exportar_evolucoes_conteudo(text[], uuid, text, text) to service_role;
