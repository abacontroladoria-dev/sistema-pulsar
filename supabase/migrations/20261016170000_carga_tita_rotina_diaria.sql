-- Rotina diária das 04:00: "Carregar o Pulsar segundo o TiTa" sem ninguém
-- clicar (decisão de 16/10/2026: as 4 etapas, todo dia).
--
-- Quem roda: a rota /api/tita/carga-diaria do site (Next), chamada pelo
-- pg_cron com um segredo (o agendamento é ligado DEPOIS do deploy, por
-- docs/ATIVAR_CARGA_TITA_DIARIA.sql — com trava). Ela usa a chave de serviço:
-- auth.uid() é nulo. Por isso:
--
--   A. As funções das etapas aceitam a chamada interna (auth.uid() nulo), como
--      pacientes_importar_tita já aceitava. Só a service_role e o dono chegam
--      aqui sem usuário: o anon não tem EXECUTE (revogado em todas). Quem fez
--      aparece como "Rotina do TiTa (04:00)". Só a linha da permissão muda em
--      cada função; o resto é idêntico às versões vigentes.
--   B. Logs das importações marcam origem 'cron' quando não há usuário.
--   C. tita_cargas: uma linha por carga (etapas, situação, erro). A página
--      Carregar do TiTa mostra a última; falha abre o alerta carga_tita_falhou.
--
-- Idempotente.

set lock_timeout = '5s';

-- ═════════════════════════════════════════════════════════════════════════════
-- A) Funções das etapas: aceitam a chamada interna
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
  -- Chamada interna (rotina das 04:00, service_role: auth.uid() nulo) é permitida.
  if auth.uid() is not null and not public.usuario_tem_permissao('cadastros_profissionais') then
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
  if auth.uid() is null then v_nome := 'Rotina do TiTa (04:00)'; end if;

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

create or replace function public.profissionais_locais()
returns table (
  id uuid,
  nome_exibicao text,
  unidade_nome text,
  numero_sala text,
  capacidade text,
  status text,
  sala_nome_referencia text,
  exclusividades jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.usuario_tem_permissao('cadastros_profissionais') then
    raise exception 'Sem permissão para listar os locais.' using errcode = '42501';
  end if;

  return query
  select
    s.id, s.nome_exibicao, s.unidade_nome, s.numero_sala, s.capacidade, s.status, s.sala_nome_referencia,
    coalesce((
      select jsonb_agg(jsonb_build_object('terapia_id', e.terapia_id, 'terapia_nome', e.terapia_nome, 'modo', e.modo))
      from public.cronograma_salas_terapias_exclusivas e
      where e.sala_id = s.id
    ), '[]'::jsonb)
  from public.cronograma_salas s
  order by s.unidade_nome, s.nome_exibicao;
end $$;

create or replace function public.tita_importacao_disponibilidade_previa(
  p_vigente_de  date,
  p_semana_de   date,
  p_semana_ate  date,
  p_vistos      integer,
  p_itens       jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid := gen_random_uuid();
  v_nome  text;
  v_hoje  date := public.hoje_brasilia();
  i       jsonb;
  v_tipo  text;
  v_prof  record;
  v_pl    jsonb;
begin
  -- Chamada interna (rotina das 04:00, service_role: auth.uid() nulo) é permitida.
  if auth.uid() is not null and not public.usuario_tem_permissao('cadastros_profissionais') then
    raise exception 'Sem permissão para gravar a disponibilidade.' using errcode = '42501';
  end if;
  if p_vigente_de is null or p_vigente_de < v_hoje then
    raise exception 'A data de início não pode ser no passado.' using errcode = '22023';
  end if;
  if p_vigente_de > v_hoje + 366 then
    raise exception 'A data de início está longe demais (máximo 1 ano).' using errcode = '22023';
  end if;
  if jsonb_typeof(p_itens) is distinct from 'array' or jsonb_array_length(p_itens) > 3000 then
    raise exception 'Prévia em formato inválido.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('tita_importacao_disponibilidade'));
  select u.nome into v_nome from public.usuarios u where u.id = auth.uid();

  -- Uma prévia aberta por vez: a anterior que ninguém aplicou fica descartada.
  update public.tita_importacoes
     set situacao = 'descartada', finalizado_em = now()
   where alvo = 'disponibilidade' and situacao = 'previa';

  insert into public.tita_importacoes (id, alvo, situacao, parametros, vistos_na_tita, usuario_id, usuario_nome)
  values (
    v_id, 'disponibilidade', 'previa',
    jsonb_build_object('vigente_de', p_vigente_de, 'semana_de', p_semana_de, 'semana_ate', p_semana_ate),
    greatest(coalesce(p_vistos, 0), 0), auth.uid(), coalesce(v_nome, 'Usuário do Pulsar')
  );

  for i in select * from jsonb_array_elements(p_itens) loop
    v_tipo := i ->> 'tipo';
    if v_tipo is null or v_tipo not in ('novo', 'alterado', 'igual', 'pendencia', 'sem_grade') then
      raise exception 'Tipo de item inválido na prévia.' using errcode = '22023';
    end if;
    -- Nome e id do TiTa vêm do banco, não da tela.
    select p.id, p.nome, p.tita_profissional_id into v_prof
    from public.profissionais p
    where p.id = (i ->> 'profissional_id')::bigint;
    if not found then
      raise exception 'Profissional % não encontrado.', i ->> 'profissional_id' using errcode = 'P0002';
    end if;
    if jsonb_typeof(coalesce(i -> 'mudancas', '[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(i -> 'mudancas', '[]'::jsonb)) > 200 then
      raise exception 'Mudanças em formato inválido (%).', v_prof.nome using errcode = '22023';
    end if;

    v_pl := null;
    if v_tipo in ('novo', 'alterado') then
      v_pl := i -> 'payload';
      if jsonb_typeof(v_pl -> 'faixas') is distinct from 'array'
         or jsonb_array_length(v_pl -> 'faixas') not between 1 and 60
         or jsonb_typeof(v_pl -> 'dias') is distinct from 'array' then
        raise exception 'Faixas em formato inválido (%).', v_prof.nome using errcode = '22023';
      end if;
      v_pl := jsonb_build_object(
        'dias', v_pl -> 'dias',
        'faixas', v_pl -> 'faixas',
        'habilitar', case when jsonb_typeof(v_pl -> 'habilitar') = 'array' then v_pl -> 'habilitar' else '[]'::jsonb end
      );
    end if;

    insert into public.tita_importacoes_itens
      (importacao_id, tipo, entidade_id, tita_id, nome, resumo, mudancas, etiquetas, payload)
    values (
      v_id, v_tipo, v_prof.id, v_prof.tita_profissional_id, v_prof.nome,
      left(i ->> 'resumo', 1000),
      coalesce(i -> 'mudancas', '[]'::jsonb),
      coalesce(array(
        select left(x, 200)
        from jsonb_array_elements_text(
          case when jsonb_typeof(i -> 'etiquetas') = 'array' then i -> 'etiquetas' else '[]'::jsonb end
        ) x
        limit 20
      ), '{}'),
      v_pl
    );
  end loop;

  update public.tita_importacoes t
     set novos      = c.novos,
         alterados  = c.alterados,
         iguais     = c.iguais,
         pendencias = c.pendencias,
         sem_grade  = c.sem_grade
    from (
      select
        count(*) filter (where tipo = 'novo')      as novos,
        count(*) filter (where tipo = 'alterado')  as alterados,
        count(*) filter (where tipo = 'igual')     as iguais,
        count(*) filter (where tipo = 'pendencia') as pendencias,
        count(*) filter (where tipo = 'sem_grade') as sem_grade
      from public.tita_importacoes_itens
      where importacao_id = v_id
    ) c
   where t.id = v_id;

  return v_id;
end $$;

create or replace function public.tita_importacao_disponibilidade_aplicar(
  p_importacao_id  uuid,
  p_profissionais  bigint[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_imp     record;
  v_item    record;
  v_versao  uuid;
  v_de      date;
  v_hoje    date := public.hoje_brasilia();
  v_motivo  text;
  v_aplic   integer := 0;
  v_err     integer := 0;
begin
  -- Chamada interna (rotina das 04:00, service_role: auth.uid() nulo) é permitida.
  if auth.uid() is not null and not public.usuario_tem_permissao('cadastros_profissionais') then
    raise exception 'Sem permissão para gravar a disponibilidade.' using errcode = '42501';
  end if;
  if coalesce(array_length(p_profissionais, 1), 0) > 50 then
    raise exception 'Lote grande demais (máximo 50 profissionais).' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('tita_importacao_disponibilidade'));

  select * into v_imp from public.tita_importacoes where id = p_importacao_id for update;
  if not found or v_imp.alvo <> 'disponibilidade' then
    raise exception 'Importação não encontrada.' using errcode = 'P0002';
  end if;
  if v_imp.situacao not in ('previa', 'aplicando') then
    raise exception 'Esta prévia já foi concluída ou descartada. Gere outra.' using errcode = '22023';
  end if;
  -- Prévia velha não grava: o TiTa pode ter mudado desde então.
  if v_imp.iniciado_em < now() - interval '6 hours' then
    raise exception 'A prévia tem mais de 6 horas. Gere outra para gravar o retrato atual do TiTa.' using errcode = '22023';
  end if;
  v_de := (v_imp.parametros ->> 'vigente_de')::date;
  if v_de is null or v_de < v_hoje then
    raise exception 'A data de início desta prévia já passou. Gere outra.' using errcode = '22023';
  end if;

  update public.tita_importacoes set situacao = 'aplicando' where id = p_importacao_id and situacao = 'previa';

  v_motivo := 'Importação em massa do TiTa ('
              || to_char(v_imp.iniciado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || ')';

  for v_item in
    select *
    from public.tita_importacoes_itens
    where importacao_id = p_importacao_id
      and entidade_id = any(p_profissionais)
      and tipo in ('novo', 'alterado')
      and aplicado_em is null
    order by id
  loop
    begin
      -- O TiTa prevalece: terapia que a grade mostra passa a ser habilitada.
      insert into public.profissionais_terapias_habilitadas (profissional_id, terapia_id, origem, criado_por)
      select v_item.entidade_id, c.id, 'tita', auth.uid()
      from jsonb_array_elements_text(coalesce(v_item.payload -> 'habilitar', '[]'::jsonb)) h(t)
      join public.cadastro_terapias c on c.id = h.t::bigint and c.ativo
      on conflict do nothing;

      v_versao := public.profissional_disponibilidade_criar_versao(
        v_item.entidade_id,
        v_de,
        null,
        array(select (d)::smallint from jsonb_array_elements_text(v_item.payload -> 'dias') d),
        v_item.payload -> 'faixas',
        v_motivo,
        'preenchido_tita',
        true,
        null
      );

      update public.tita_importacoes_itens
         set aplicado_em = now(), versao_id = v_versao, erro = null
       where id = v_item.id;
      v_aplic := v_aplic + 1;
    exception when others then
      -- Um profissional com problema não derruba o lote.
      update public.tita_importacoes_itens set erro = left(sqlerrm, 500) where id = v_item.id;
      v_err := v_err + 1;
    end;
  end loop;

  return jsonb_build_object('aplicados', v_aplic, 'erros', v_err);
end $$;

create or replace function public.tita_importacao_concluir(p_importacao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_imp    record;
  v_aplic  integer;
  v_err    integer;
  v_sit    text;
begin
  -- Chamada interna (rotina das 04:00, service_role: auth.uid() nulo) é permitida.
  if auth.uid() is not null and not public.usuario_tem_permissao('cadastros_profissionais') then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('tita_importacao_disponibilidade'));

  select * into v_imp from public.tita_importacoes where id = p_importacao_id for update;
  if not found or v_imp.alvo <> 'disponibilidade' then
    raise exception 'Importação não encontrada.' using errcode = 'P0002';
  end if;
  if v_imp.situacao not in ('previa', 'aplicando') then
    raise exception 'Esta importação já foi concluída ou descartada.' using errcode = '22023';
  end if;

  select count(*) filter (where aplicado_em is not null),
         count(*) filter (where aplicado_em is null and erro is not null)
    into v_aplic, v_err
  from public.tita_importacoes_itens
  where importacao_id = p_importacao_id and tipo in ('novo', 'alterado');

  v_sit := case when v_err > 0 then 'parcial' else 'sucesso' end;
  update public.tita_importacoes
     set situacao = v_sit, aplicados = v_aplic, erros = v_err, finalizado_em = now()
   where id = p_importacao_id;

  return jsonb_build_object('situacao', v_sit, 'aplicados', v_aplic, 'erros', v_err);
end $$;

create or replace function public.profissionais_importar_tita()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome_usuario text;
  v_imp          uuid := gen_random_uuid();
  v_novos        integer := 0;
  v_atualizados  integer := 0;
  v_terapias     integer := 0;
  v_vinculados   integer := 0;
  v_vistos       integer := 0;
begin
  -- Chamada interna (rotina das 04:00, service_role: auth.uid() nulo) é permitida.
  if auth.uid() is not null and not public.usuario_tem_permissao('cadastros_profissionais') then
    raise exception 'Sem permissão para importar profissionais.' using errcode = '42501';
  end if;

  -- Um import por vez: dois cliques simultâneos não duplicam nada (há unique),
  -- mas contariam "novos" em dobro.
  perform pg_advisory_xact_lock(hashtext('profissionais_importar_tita'));

  select u.nome into v_nome_usuario from public.usuarios u where u.id = auth.uid();

  -- Fora do bloco abaixo: se a importação falhar, o registro do erro fica.
  insert into public.tita_importacoes (id, alvo, situacao, usuario_id, usuario_nome)
  values (v_imp, 'profissionais', 'aplicando', auth.uid(), coalesce(v_nome_usuario, 'Usuário do Pulsar'));

  begin
    create temporary table pg_temp.tmp_tita on commit drop as
    with grade as (
      -- Mesmas exclusões de vw_grade_base (profissionais de teste).
      select g.profissional_id, g.profissional_nome, g.profissional_cpf, g.data
      from public.csv_grades_profissionais g
      where g.ativo
        and g.profissional_id is not null
        and g.data >= current_date - 90
        and coalesce(g.profissional_nome, '') not in ('', 'Profissional Teste')
        and g.profissional_nome not ilike 'Testes Técnicos%'
        and g.profissional_nome not ilike 'Combinar Consulta%'
    ),
    base as (
      select
        profissional_id,
        (array_agg(btrim(profissional_nome) order by data desc))[1] as nome,
        (array_agg(regexp_replace(profissional_cpf, '\D', '', 'g') order by data desc)
          filter (where regexp_replace(coalesce(profissional_cpf, ''), '\D', '', 'g') ~ '^\d{11}$'))[1] as cpf
      from grade
      group by profissional_id
    ),
    extra as (
      select
        gp.profissional_id,
        (array_agg(regexp_replace(gp.numero_telefone, '\D', '', 'g') order by gp.data desc)
          filter (where regexp_replace(coalesce(gp.numero_telefone, ''), '\D', '', 'g') ~ '^\d{10,13}$'))[1] as celular,
        (array_agg(btrim(gp.cbo_profissional) order by gp.data desc)
          filter (where nullif(btrim(gp.cbo_profissional), '') is not null
                    and length(btrim(gp.cbo_profissional)) <= 10))[1] as cbo,
        (array_agg(btrim(gp.registro_profissional) order by gp.data desc)
          filter (where nullif(btrim(gp.registro_profissional), '') is not null
                    and length(btrim(gp.registro_profissional)) <= 40))[1] as codigo_registro,
        (array_agg(btrim(gp.tipo_registro_profissional) order by gp.data desc)
          filter (where nullif(btrim(gp.tipo_registro_profissional), '') is not null
                    and length(btrim(gp.tipo_registro_profissional)) <= 30))[1] as tipo_registro,
        (array_agg(upper(btrim(gp.uf_registro_profissional)) order by gp.data desc)
          filter (where upper(btrim(coalesce(gp.uf_registro_profissional, ''))) ~ '^[A-Z]{2}$'))[1] as uf_registro
      from public.grade_profissionais_tita gp
      where gp.profissional_id in (select profissional_id from base)
      group by gp.profissional_id
    )
    select
      b.profissional_id, left(b.nome, 200) as nome, b.cpf,
      e.celular, e.cbo, e.codigo_registro, e.tipo_registro, e.uf_registro
    from base b
    left join extra e on e.profissional_id = b.profissional_id
    where length(btrim(coalesce(b.nome, ''))) >= 2;

    select count(*) into v_vistos from pg_temp.tmp_tita;

    -- Mudanças por profissional, montadas ao longo da importação e gravadas
    -- no log no fim (um item por profissional).
    create temporary table pg_temp.tmp_mud (
      prof_id bigint, ordem integer, campo text, de text, para text
    ) on commit drop;

    -- Cadastrado à mão antes de existir no TiTa: quando o CPF aparece na grade,
    -- VINCULA o cadastro existente em vez de criar um segundo profissional.
    with vinc as (
      update public.profissionais p
         set tita_profissional_id = t.profissional_id
        from (
          select distinct on (t.cpf) t.cpf, t.profissional_id
          from pg_temp.tmp_tita t
          where t.cpf is not null
            and not exists (
              select 1 from public.profissionais x where x.tita_profissional_id = t.profissional_id
            )
          order by t.cpf, t.profissional_id
        ) t
       where p.tita_profissional_id is null
         and p.cpf = t.cpf
      returning p.id, t.profissional_id
    )
    insert into pg_temp.tmp_mud (prof_id, ordem, campo, de, para)
    select vinc.id, 0, 'Vínculo com o TiTa', null, 'ID TiTa ' || vinc.profissional_id || ' (mesmo CPF)'
    from vinc;
    get diagnostics v_vinculados = row_count;

    -- Retrato de antes, para o de→para.
    create temporary table pg_temp.tmp_antes on commit drop as
    select p.id, p.nome, p.cpf, p.celular, p.cbo, p.codigo_registro, p.tipo_registro, p.uf_registro, p.dados_tita
    from public.profissionais p
    join pg_temp.tmp_tita t on t.profissional_id = p.tita_profissional_id;

    -- Novos
    with ins as (
      insert into public.profissionais (
        tita_profissional_id, origem, nome, cpf, celular, cbo, codigo_registro,
        tipo_registro, uf_registro, dados_tita, sincronizado_tita_em
      )
      select
        t.profissional_id, 'tita', t.nome, t.cpf, t.celular, t.cbo, t.codigo_registro,
        t.tipo_registro, t.uf_registro,
        jsonb_strip_nulls(jsonb_build_object(
          'nome', t.nome, 'cpf', t.cpf, 'celular', t.celular, 'cbo', t.cbo,
          'codigo_registro', t.codigo_registro, 'tipo_registro', t.tipo_registro,
          'uf_registro', t.uf_registro)),
        now()
      from pg_temp.tmp_tita t
      where not exists (
        select 1 from public.profissionais p where p.tita_profissional_id = t.profissional_id
      )
      on conflict (tita_profissional_id) do nothing
      returning id, nome, tita_profissional_id, cpf
    ),
    trilha as (
      -- CTE que grava executa sempre, mesmo sem ser lida adiante.
      insert into public.cadastros_auditoria
        (tabela, registro_id, acao, alvo_nome, resumo, usuario_id, usuario_nome)
      select 'profissional', ins.id::text, 'criar', ins.nome,
             'Importado do TiTa.', auth.uid(), v_nome_usuario
      from ins
    )
    insert into public.tita_importacoes_itens (importacao_id, tipo, entidade_id, tita_id, nome, resumo)
    select v_imp, 'novo', ins.id, ins.tita_profissional_id, ins.nome,
           case when ins.cpf is not null then 'CPF ' || public.sp_mascarar_cpf(ins.cpf) end
    from ins;
    get diagnostics v_novos = row_count;

    -- Existentes: completa só o que está vazio e renova o retrato do TiTa.
    update public.profissionais p
       set cpf             = coalesce(p.cpf, t.cpf),
           celular         = coalesce(p.celular, t.celular),
           cbo             = coalesce(p.cbo, t.cbo),
           codigo_registro = coalesce(p.codigo_registro, t.codigo_registro),
           tipo_registro   = coalesce(p.tipo_registro, t.tipo_registro),
           uf_registro     = coalesce(p.uf_registro, t.uf_registro),
           dados_tita      = jsonb_strip_nulls(jsonb_build_object(
             'nome', t.nome, 'cpf', t.cpf, 'celular', t.celular, 'cbo', t.cbo,
             'codigo_registro', t.codigo_registro, 'tipo_registro', t.tipo_registro,
             'uf_registro', t.uf_registro)),
           sincronizado_tita_em = now()
      from pg_temp.tmp_tita t
     where p.tita_profissional_id = t.profissional_id
       and (   p.dados_tita is distinct from jsonb_strip_nulls(jsonb_build_object(
                 'nome', t.nome, 'cpf', t.cpf, 'celular', t.celular, 'cbo', t.cbo,
                 'codigo_registro', t.codigo_registro, 'tipo_registro', t.tipo_registro,
                 'uf_registro', t.uf_registro))
            or (p.cpf is null and t.cpf is not null)
            or (p.celular is null and t.celular is not null)
            or (p.cbo is null and t.cbo is not null)
            or (p.codigo_registro is null and t.codigo_registro is not null)
            or (p.tipo_registro is null and t.tipo_registro is not null)
            or (p.uf_registro is null and t.uf_registro is not null));

    -- De→para: o que mudou no Pulsar (campo vazio preenchido) ou, quando o
    -- Pulsar manteve o seu, o que mudou no retrato do TiTa.
    insert into pg_temp.tmp_mud (prof_id, ordem, campo, de, para)
    select a.id, x.ordem, x.campo, x.de, x.para
    from pg_temp.tmp_antes a
    join public.profissionais p on p.id = a.id
    cross join lateral (values
      (1, 'Nome',             a.nome,            p.nome,            a.dados_tita ->> 'nome',            p.dados_tita ->> 'nome'),
      (2, 'CPF',              public.sp_mascarar_cpf(a.cpf), public.sp_mascarar_cpf(p.cpf),
                              public.sp_mascarar_cpf(a.dados_tita ->> 'cpf'), public.sp_mascarar_cpf(p.dados_tita ->> 'cpf')),
      (3, 'Celular',          a.celular,         p.celular,         a.dados_tita ->> 'celular',         p.dados_tita ->> 'celular'),
      (4, 'CBO',              a.cbo,             p.cbo,             a.dados_tita ->> 'cbo',             p.dados_tita ->> 'cbo'),
      (5, 'Registro',         a.codigo_registro, p.codigo_registro, a.dados_tita ->> 'codigo_registro', p.dados_tita ->> 'codigo_registro'),
      (6, 'Tipo de registro', a.tipo_registro,   p.tipo_registro,   a.dados_tita ->> 'tipo_registro',   p.dados_tita ->> 'tipo_registro'),
      (7, 'UF do registro',   a.uf_registro,     p.uf_registro,     a.dados_tita ->> 'uf_registro',     p.dados_tita ->> 'uf_registro')
    ) as v(ordem, campo, pul_de, pul_para, tita_de, tita_para)
    cross join lateral (
      select v.ordem, v.campo, v.pul_de as de, v.pul_para as para
       where v.pul_de is distinct from v.pul_para
      union all
      select v.ordem, v.campo || ' (no TiTa; o do Pulsar foi mantido)', v.tita_de, v.tita_para
       where v.pul_de is not distinct from v.pul_para
         and a.dados_tita is not null
         and v.tita_de is distinct from v.tita_para
    ) x;

    select count(distinct prof_id) into v_atualizados from pg_temp.tmp_mud where ordem > 0;

    insert into public.tita_importacoes_itens (importacao_id, tipo, entidade_id, tita_id, nome, mudancas)
    select v_imp, 'alterado', p.id, p.tita_profissional_id, p.nome,
           jsonb_agg(jsonb_build_object('campo', m.campo, 'de', m.de, 'para', m.para) order by m.ordem)
    from pg_temp.tmp_mud m
    join public.profissionais p on p.id = m.prof_id
    group by p.id, p.tita_profissional_id, p.nome;

    -- Terapias habilitadas: semeadas da grade SÓ para quem ainda não tem nenhuma.
    -- Depois disso a lista é da equipe — reimportar não devolve uma terapia que
    -- alguém tirou de propósito. (A importação de DISPONIBILIDADE habilita as
    -- terapias que a grade mostra: lá o TiTa prevalece.)
    with sem_lista as (
      select p.id, p.tita_profissional_id
      from public.profissionais p
      where p.tita_profissional_id is not null
        and not exists (
          select 1 from public.profissionais_terapias_habilitadas h where h.profissional_id = p.id
        )
    ),
    ins as (
      insert into public.profissionais_terapias_habilitadas (profissional_id, terapia_id, origem, criado_por)
      select distinct s.id, c.id, 'tita', auth.uid()
      from sem_lista s
      join public.vw_profissionais_terapias_grade vg on vg.profissional_id = s.tita_profissional_id
      join public.cadastro_terapias c
        on c.nome_normalizado = public.normalizar_nome_terapia(vg.terapia_nome)
       and c.ativo
      on conflict do nothing
      returning 1
    )
    select count(*) into v_terapias from ins;

  exception when others then
    update public.tita_importacoes
       set situacao = 'erro', erro_mensagem = left(sqlerrm, 1000), finalizado_em = now()
     where id = v_imp;
    return jsonb_build_object('erro', sqlerrm, 'importacao_id', v_imp);
  end;

  update public.tita_importacoes
     set situacao       = 'sucesso',
         vistos_na_tita = v_vistos,
         novos          = v_novos,
         alterados      = (select count(*) from public.tita_importacoes_itens
                            where importacao_id = v_imp and tipo = 'alterado'),
         extras         = jsonb_build_object('vinculados_por_cpf', v_vinculados, 'terapias_habilitadas', v_terapias),
         finalizado_em  = now()
   where id = v_imp;

  return jsonb_build_object(
    'importacao_id', v_imp,
    'novos', v_novos,
    'vinculados_por_cpf', v_vinculados,
    'atualizados', v_atualizados,
    'terapias_vinculadas', v_terapias,
    'vistos_na_tita', v_vistos
  );
end $$;

create or replace function public.sp_grade_exigir_permissao()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Chamada interna (rotina das 04:00, service_role: auth.uid() nulo) é permitida.
  if auth.uid() is not null and not public.usuario_tem_permissao('cronograma_grade') then
    raise exception 'Sem permissão para a Grade.' using errcode = '42501';
  end if;
end $$;

create or replace function public.sp_grade_usuario_nome()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select u.nome from public.usuarios u where u.id = auth.uid()), case when auth.uid() is null then 'Rotina do TiTa (04:00)' else 'Usuário do Pulsar' end)
$$;

-- Funções nascem/continuam com EXECUTE para PUBLIC (e anon é PUBLIC): reafirma.
revoke all on function public.profissional_disponibilidade_criar_versao(bigint, date, date, smallint[], jsonb, text, text, boolean, uuid) from public, anon;
revoke all on function public.profissionais_locais() from public, anon;
revoke all on function public.tita_importacao_disponibilidade_previa(date, date, date, integer, jsonb) from public, anon;
revoke all on function public.tita_importacao_disponibilidade_aplicar(uuid, bigint[]) from public, anon;
revoke all on function public.tita_importacao_concluir(uuid) from public, anon;
revoke all on function public.profissionais_importar_tita() from public, anon;
revoke all on function public.sp_grade_exigir_permissao() from public, anon, authenticated;
revoke all on function public.sp_grade_usuario_nome() from public, anon, authenticated;

-- Quem chama sem usuário é a service_role (a rota) — explícito.
grant execute on function public.profissional_disponibilidade_criar_versao(bigint, date, date, smallint[], jsonb, text, text, boolean, uuid) to service_role;
grant execute on function public.profissionais_locais() to service_role;
grant execute on function public.tita_importacao_disponibilidade_previa(date, date, date, integer, jsonb) to service_role;
grant execute on function public.tita_importacao_disponibilidade_aplicar(uuid, bigint[]) to service_role;
grant execute on function public.tita_importacao_concluir(uuid) to service_role;
grant execute on function public.profissionais_importar_tita() to service_role;
grant execute on function public.grade_importar_tita_previa(date, date) to service_role;
grant execute on function public.grade_importar_tita_aplicar(uuid, boolean, bigint[]) to service_role;
grant execute on function public.grade_importar_tita_concluir(uuid) to service_role;
do $$
begin
  if to_regprocedure('public.pacientes_importar_tita(text)') is not null then
    grant execute on function public.pacientes_importar_tita(text) to service_role;
  end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- B) Origem "rotina" nos logs das importações
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.grade_importacoes add column if not exists origem text not null default 'manual';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'grade_importacoes_origem_check') then
    alter table public.grade_importacoes add constraint grade_importacoes_origem_check check (origem in ('manual', 'cron'));
  end if;
end $$;

create or replace function public.sp_importacao_origem_rotina()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    new.origem := 'cron';
    if tg_table_name = 'tita_importacoes' then
      new.usuario_nome := 'Rotina do TiTa (04:00)';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.sp_importacao_origem_rotina() from public, anon, authenticated;

drop trigger if exists trg_origem_rotina on public.tita_importacoes;
create trigger trg_origem_rotina before insert on public.tita_importacoes
  for each row execute function public.sp_importacao_origem_rotina();
drop trigger if exists trg_origem_rotina on public.grade_importacoes;
create trigger trg_origem_rotina before insert on public.grade_importacoes
  for each row execute function public.sp_importacao_origem_rotina();

-- ═════════════════════════════════════════════════════════════════════════════
-- C) Registro de cada carga
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.tita_cargas (
  id             uuid        primary key default gen_random_uuid(),
  origem         text        not null default 'cron',
  situacao       text        not null default 'rodando',
  -- [{etapa, situacao, resumo[], aviso, erro, importacao_id}]
  etapas         jsonb       not null default '[]'::jsonb,
  erro_mensagem  text,
  iniciado_em    timestamptz not null default now(),
  finalizado_em  timestamptz,
  constraint tita_cargas_origem_check   check (origem in ('cron', 'manual')),
  constraint tita_cargas_situacao_check check (situacao in ('rodando', 'sucesso', 'parcial', 'erro'))
);
create index if not exists idx_tita_cargas_iniciado on public.tita_cargas (iniciado_em desc);

comment on table public.tita_cargas is
  'Cada execução de "Carregar o Pulsar segundo o TiTa" pela rotina diária (04:00): as 4 etapas e o resultado. Escrita só pela service_role (rota /api/tita/carga-diaria).';

alter table public.tita_cargas enable row level security;
drop policy if exists "tita_cargas_select" on public.tita_cargas;
create policy "tita_cargas_select" on public.tita_cargas
  for select to authenticated using ((select public.usuario_tem_permissao('carregar_tita')));
revoke all on public.tita_cargas from public, anon, authenticated;
grant select on public.tita_cargas to authenticated;
grant select, insert, update on public.tita_cargas to service_role;

-- Alerta quando a rotina falhar (mesma régua do sync de pacientes).
insert into public.alertas_regras (codigo, modulo, nome, setor_destino, prioridade, tolerancia_minutos)
values ('carga_tita_falhou', 'sync', 'Carga diária do TiTa (04:00) falhou', 'admin', 'alta', 0)
on conflict (codigo) do nothing;
