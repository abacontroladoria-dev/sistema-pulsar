-- Exportar Evoluções (Autorização → Exportar Evoluções).
--
-- Plano: docs/PLANO_EXPORTAR_EVOLUCOES.md. A tela junta as evoluções do TiTa
-- (cópia csv_grades_profissionais) com as do Pulsar (grade_evolucoes,
-- origem = 'pulsar') e exporta PDF/CSV para o convênio.
--
-- Quem chama: SÓ o servidor (rotas /api/exportar-evolucoes/*), com a
-- service_role, depois de conferir a permissão `exportar_evolucoes`
-- (exigirPermissao). Por isso as funções têm EXECUTE só para service_role:
-- nenhum login consegue chamá-las pelo REST, nem anon.
--
-- Decisões do usuário (19/10/2026):
--   D1  a permissão `exportar_evolucoes` libera o texto SÓ nesta tela (na Grade
--       continua só admin — 20261019120000);
--   D4  o convênio aparece no card e no CSV, não no PDF.
--
-- Regras (medidas em 19/10/2026, seção 14 do plano):
--   - TiTa: ativo, possui_tratativa, texto preenchido e status que não seja de
--     não realização ("Em Conflito" e o vazio dos "Sem agendamento" entram:
--     a sessão foi evoluída). Linhas idênticas do mesmo tita_agendamento_id
--     (9 casos) viram uma só.
--   - Pulsar: origem = 'pulsar', Realizado, texto preenchido. As linhas
--     'tita_importacao' são cópia do TiTa e ficam de fora (senão duplica).
--   - O mesmo atendimento não aparece duas vezes: havendo registro do Pulsar
--     para o tita_agendamento_id, a linha do TiTa sai.
--   - Terapia = de exibição; profissional = quem executou (substituto quando
--     houve troca), NUNCA grade_evolucoes.tratativa_profissional_nome (que grava
--     o nome do admin que digitou).
--
-- Idempotente: pode rodar de novo.

-- ═════════════════════════════════════════════════════════════════════════════
-- A) Registro de toda leitura de texto (visualização, PDF, CSV)
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.exportar_evolucoes_registro (
  id           bigint generated always as identity primary key,
  criado_em    timestamptz not null default now(),
  usuario_id   uuid,
  usuario_nome text not null,
  finalidade   text not null,
  quantidade   integer not null,
  periodo_de   date,
  periodo_ate  date,
  paciente_ids bigint[] not null default '{}',
  chaves       text[] not null default '{}',
  constraint exportar_evolucoes_registro_finalidade_check
    check (finalidade in ('visualizacao', 'pdf', 'csv'))
);

create index if not exists idx_exportar_evolucoes_registro_criado_em
  on public.exportar_evolucoes_registro (criado_em desc);

comment on table public.exportar_evolucoes_registro is
  'Quem leu o texto de quais evoluções na tela Exportar Evoluções, quando e para quê (visualizacao/pdf/csv). Gravada só pelo servidor (exportar_evolucoes_conteudo); leitura só admin.';

alter table public.exportar_evolucoes_registro enable row level security;
alter table public.exportar_evolucoes_registro force row level security;

revoke all on table public.exportar_evolucoes_registro from public, anon, authenticated;
grant select on table public.exportar_evolucoes_registro to authenticated;
grant all on table public.exportar_evolucoes_registro to service_role;

drop policy if exists exportar_evolucoes_registro_select_admin on public.exportar_evolucoes_registro;
create policy exportar_evolucoes_registro_select_admin
  on public.exportar_evolucoes_registro
  for select to authenticated
  using (public.is_admin());

-- ═════════════════════════════════════════════════════════════════════════════
-- B) Fonte única (interna): TiTa + Pulsar já unidos, com texto
-- ═════════════════════════════════════════════════════════════════════════════
-- Ou filtra por período (listagem), ou por chaves (conteúdo). Ninguém além das
-- duas funções abaixo a executa.
create or replace function public.sp_exportar_evolucoes_fonte(
  p_de         date,
  p_ate        date,
  p_tita_ids   uuid[] default null,
  p_pulsar_ids uuid[] default null
)
returns table (
  chave               text,
  origem              text,
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
  with tita as (
    select distinct on (g.tita_agendamento_id, case when g.tita_agendamento_id is null then g.id end)
      g.*
    from public.csv_grades_profissionais g
    where g.ativo is true
      and coalesce(g.unidade_id, 280) = 280
      and g.possui_tratativa is true
      and length(btrim(coalesce(g.descricao_evolucao, ''))) > 0
      and lower(coalesce(g.status_execucao, '')) !~ '(cancel|nao realizad|não realizad)'
      and (p_tita_ids is null or g.id = any (p_tita_ids))
      and (p_de is null or g.data >= p_de)
      and (p_ate is null or g.data <= p_ate)
      -- Havendo registro do Pulsar para o mesmo atendimento, vale o do Pulsar.
      and not (
        g.tita_agendamento_id is not null
        and (
          exists (
            select 1 from public.grade_evolucoes ge
             where ge.origem = 'pulsar' and ge.tita_agendamento_id = g.tita_agendamento_id
          )
          or exists (
            select 1
              from public.grade_evolucoes ge
              join public.grade_agendamentos ga on ga.id = ge.agendamento_id
             where ge.origem = 'pulsar' and ga.tita_agendamento_id = g.tita_agendamento_id
          )
        )
      )
    order by g.tita_agendamento_id, case when g.tita_agendamento_id is null then g.id end,
             g.updated_at desc nulls last, g.id
  )
  select
    'tita:' || t.id::text,
    'tita',
    t.data,
    t.hora_inicial,
    t.hora_final,
    pac.id_paciente,
    coalesce(nullif(btrim(pac.nome), ''), t.paciente_nome),
    pac.cpf,
    pac.data_nascimento,
    coalesce(nullif(btrim(t.convenio_nome), ''), pac.convenio_nome),
    coalesce(nullif(btrim(t.terapia_exibicao_nome), ''), t.terapia_nome),
    pe.id,
    coalesce(
      nullif(btrim(pe.nome), ''),
      case when t.tratativa_profissional_id is not null and t.tratativa_profissional_id <> t.profissional_id
           then t.tratativa_profissional_nome
           else t.profissional_nome end
    ),
    pe.tipo_registro,
    pe.uf_registro,
    pe.codigo_registro,
    pe.assinatura_path,
    (t.tratativa_profissional_id is not null and t.tratativa_profissional_id <> t.profissional_id),
    null::text,
    t.descricao_evolucao
  from tita t
  left join public.pacientes pac on pac.tita_paciente_id = t.paciente_id
  left join public.profissionais pe
    on pe.tita_profissional_id = coalesce(t.tratativa_profissional_id, t.profissional_id)

  union all

  select
    'pulsar:' || ge.agendamento_id::text,
    'pulsar',
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

revoke all on function public.sp_exportar_evolucoes_fonte(date, date, uuid[], uuid[]) from public, anon, authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- C) Listagem dos cards (SEM o texto)
-- ═════════════════════════════════════════════════════════════════════════════
-- Devolve um único jsonb (lista), e não linhas: o PostgREST corta respostas de
-- linhas em 1.000 sem avisar, e 3 meses de todos os pacientes passam de 20 mil.
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

-- ═════════════════════════════════════════════════════════════════════════════
-- D) Conteúdo (COM o texto) + registro de quem leu
-- ═════════════════════════════════════════════════════════════════════════════
-- Até 500 chaves por chamada (o front pede em lotes). Chave inexistente ou que
-- foge às regras é ignorada sem erro. A gravação do registro acontece na mesma
-- transação: sem registro, sem texto.
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
  v_tita   uuid[];
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
  select array_agg(substr(c, 6)::uuid) filter (where c ~* '^tita:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
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
