-- Sincronização do TiTa SOB DEMANDA — Etapa 0 + 1 do plano de independência do TiTa.
--
-- 1. tita_importacoes / tita_importacoes_itens: log comum das importações que
--    a pessoa dispara (cadastro de profissionais e disponibilidade em massa).
--    É o que alimenta o relatório "Sincronização do TiTa" (Novos · Alterados ·
--    No TiTa) e o histórico. Uma linha por mudança em tabela, não em jsonb:
--    a agenda (Etapa 2) passa de 20 mil linhas.
--
-- 2. "Gravar no Pulsar a disponibilidade do TiTa", para todos de uma vez, em três
--    passos como o "Importar do TiTa" da Grade:
--      tita_importacao_disponibilidade_previa(...)  — a tela calcula as faixas
--        de cada profissional com a MESMA função do botão individual
--        ("Preencher a partir da grade do TiTa") e grava aqui a prévia exata.
--        Nada muda na disponibilidade.
--      tita_importacao_disponibilidade_aplicar(id, profissionais[]) — aplica um
--        LOTE: para cada profissional cria a versão pela RPC de sempre
--        (profissional_disponibilidade_criar_versao, origem 'preenchido_tita').
--        Grava EXATAMENTE o que a prévia mostrou. Erro num profissional não
--        derruba o lote: fica anotado no item.
--      tita_importacao_concluir(id) — fecha ('sucesso' ou 'parcial').
--    Regra decidida em 15/10/2026: o TiTa PREVALECE. A versão editada à mão no
--    Pulsar sai de vigência e fica no histórico (restaurável). Terapias que a
--    grade do TiTa mostra e o profissional ainda não tem habilitadas são
--    habilitadas (origem 'tita'), senão a RPC recusaria a faixa.
--    Nenhum cron: só roda quando alguém clica.
--
-- 3. profissionais_importar_tita() passa a gravar o mesmo log (novos e
--    alterados campo a campo). A regra do cadastro NÃO muda: completa vazios,
--    nunca sobrescreve edição.
--
-- CPF nunca vai inteiro para o log (sp_mascarar_cpf).
-- Leitura: quem tem cadastros_profissionais. Escrita: só pelas RPCs.
-- Nada é lido da API do TiTa: só das cópias locais já sincronizadas.
-- Idempotente.

set lock_timeout = '5s';

-- ═════════════════════════════════════════════════════════════════════════════
-- A) Log
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.tita_importacoes (
  id              uuid        primary key default gen_random_uuid(),
  alvo            text        not null,
  situacao        text        not null default 'previa',
  origem          text        not null default 'manual',
  parametros      jsonb       not null default '{}'::jsonb,
  vistos_na_tita  integer     not null default 0,
  novos           integer     not null default 0,
  alterados       integer     not null default 0,
  iguais          integer     not null default 0,
  pendencias      integer     not null default 0,
  sem_grade       integer     not null default 0,
  aplicados       integer     not null default 0,
  erros           integer     not null default 0,
  extras          jsonb       not null default '{}'::jsonb,
  erro_mensagem   text,
  -- Sem FK para usuarios: o log não pode mudar se o usuário for removido.
  usuario_id      uuid,
  usuario_nome    text,
  iniciado_em     timestamptz not null default now(),
  finalizado_em   timestamptz,
  constraint tita_importacoes_alvo_check
    check (alvo in ('profissionais', 'disponibilidade')),
  constraint tita_importacoes_situacao_check
    check (situacao in ('previa', 'aplicando', 'sucesso', 'parcial', 'erro', 'descartada')),
  constraint tita_importacoes_origem_check
    check (origem in ('manual', 'cron'))
);

create index if not exists idx_tita_importacoes_alvo
  on public.tita_importacoes (alvo, iniciado_em desc);

comment on table public.tita_importacoes is
  'Execuções das importações do TiTa disparadas sob demanda (cadastro de profissionais, disponibilidade). Base do relatório "Sincronização do TiTa". Escrita só pelas RPCs.';

create table if not exists public.tita_importacoes_itens (
  id             bigint      generated always as identity primary key,
  importacao_id  uuid        not null references public.tita_importacoes(id) on delete cascade,
  tipo           text        not null,
  entidade_id    bigint,
  tita_id        bigint,
  nome           text        not null,
  resumo         text,
  -- [{campo, de, para}] — o que o relatório mostra em "Alterados".
  mudancas       jsonb       not null default '[]'::jsonb,
  etiquetas      text[]      not null default '{}',
  -- Disponibilidade: {dias, faixas, habilitar} exatamente como a prévia mostrou.
  payload        jsonb,
  aplicado_em    timestamptz,
  versao_id      uuid,
  erro           text,
  constraint tita_imp_itens_tipo_check
    check (tipo in ('novo', 'alterado', 'igual', 'pendencia', 'sem_grade'))
);

create unique index if not exists uq_tita_imp_itens_entidade
  on public.tita_importacoes_itens (importacao_id, entidade_id)
  where entidade_id is not null;
create index if not exists idx_tita_imp_itens_tipo
  on public.tita_importacoes_itens (importacao_id, tipo);

comment on table public.tita_importacoes_itens is
  'Uma linha por profissional de cada importação do TiTa: novo, alterado (com de→para), igual, pendência ou sem grade.';

-- CPF no log só mascarado: ***.456.789-**
create or replace function public.sp_mascarar_cpf(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when regexp_replace(coalesce(p, ''), '\D', '', 'g') ~ '^\d{11}$' then
      '***.' || substr(regexp_replace(p, '\D', '', 'g'), 4, 3) || '.'
             || substr(regexp_replace(p, '\D', '', 'g'), 7, 3) || '-**'
    when p is null then null
    else '***'
  end
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- B) Disponibilidade em massa — prévia
-- ═════════════════════════════════════════════════════════════════════════════
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
  if auth.uid() is null or not public.usuario_tem_permissao('cadastros_profissionais') then
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

comment on function public.tita_importacao_disponibilidade_previa(date, date, date, integer, jsonb) is
  'Grava a prévia de "Gravar no Pulsar a disponibilidade do TiTa" (nada muda na disponibilidade). Descarta a prévia anterior não aplicada. Exige cadastros_profissionais.';

-- ═════════════════════════════════════════════════════════════════════════════
-- C) Disponibilidade em massa — aplicar um lote
-- ═════════════════════════════════════════════════════════════════════════════
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
  if auth.uid() is null or not public.usuario_tem_permissao('cadastros_profissionais') then
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

comment on function public.tita_importacao_disponibilidade_aplicar(uuid, bigint[]) is
  'Aplica um lote da prévia: cria a versão de cada profissional (origem preenchido_tita) e habilita as terapias que o TiTa mostra. Prévia vale 6 horas. Exige cadastros_profissionais.';

-- ═════════════════════════════════════════════════════════════════════════════
-- D) Concluir
-- ═════════════════════════════════════════════════════════════════════════════
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
  if auth.uid() is null or not public.usuario_tem_permissao('cadastros_profissionais') then
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

comment on function public.tita_importacao_concluir(uuid) is
  'Fecha a importação de disponibilidade (sucesso, ou parcial quando algum profissional falhou). Exige cadastros_profissionais.';

-- ═════════════════════════════════════════════════════════════════════════════
-- E) Cadastro de profissionais: mesma importação de antes, agora com log
-- ═════════════════════════════════════════════════════════════════════════════
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
  if auth.uid() is null or not public.usuario_tem_permissao('cadastros_profissionais') then
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

comment on function public.profissionais_importar_tita() is
  'Botão "Importar do TiTa": cria quem falta (origem tita) e completa campos vazios; nunca sobrescreve edição. Semeia terapias habilitadas só de quem não tem nenhuma. Grava o relatório em tita_importacoes. Exige cadastros_profissionais.';

-- ═════════════════════════════════════════════════════════════════════════════
-- F) RLS e grants
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.tita_importacoes       enable row level security;
alter table public.tita_importacoes_itens enable row level security;

do $$
declare pol record;
begin
  -- Pelo catálogo, não pelo nome: uma policy permissiva esquecida anularia tudo.
  for pol in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in ('tita_importacoes', 'tita_importacoes_itens')
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

create policy "tita_importacoes_select" on public.tita_importacoes
  for select to authenticated using ((select public.usuario_tem_permissao('cadastros_profissionais')));
create policy "tita_importacoes_itens_select" on public.tita_importacoes_itens
  for select to authenticated using ((select public.usuario_tem_permissao('cadastros_profissionais')));

-- Sem policy nem grant de escrita: só as RPCs gravam.
revoke all on public.tita_importacoes       from public, anon, authenticated;
revoke all on public.tita_importacoes_itens from public, anon, authenticated;
grant select on public.tita_importacoes       to authenticated;
grant select on public.tita_importacoes_itens to authenticated;
grant select on public.tita_importacoes       to service_role;
grant select on public.tita_importacoes_itens to service_role;

-- Funções nascem com EXECUTE para PUBLIC (e anon é PUBLIC).
revoke all on function public.sp_mascarar_cpf(text) from public, anon, authenticated;
revoke all on function public.tita_importacao_disponibilidade_previa(date, date, date, integer, jsonb) from public, anon;
revoke all on function public.tita_importacao_disponibilidade_aplicar(uuid, bigint[]) from public, anon;
revoke all on function public.tita_importacao_concluir(uuid) from public, anon;
revoke all on function public.profissionais_importar_tita() from public, anon;
grant execute on function public.tita_importacao_disponibilidade_previa(date, date, date, integer, jsonb) to authenticated;
grant execute on function public.tita_importacao_disponibilidade_aplicar(uuid, bigint[]) to authenticated;
grant execute on function public.tita_importacao_concluir(uuid) to authenticated;
grant execute on function public.profissionais_importar_tita() to authenticated;
