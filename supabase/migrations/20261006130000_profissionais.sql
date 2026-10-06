-- Cadastro de Profissionais (tela /cadastros/profissionais).
--
-- Até aqui o "cadastro" de um profissional era o que a TiTa mandava, espalhado:
-- nome/CPF/terapias em csv_grades_profissionais e telefone/CBO/registro
-- repetidos em cada agendamento de grade_profissionais_tita. Não havia onde
-- guardar e-mail, endereço nem a cor do card. Esta migration cria:
--
--   - public.profissionais: um registro por profissional, com chave PRÓPRIA
--     (id identity). O vínculo com a TiTa é tita_profissional_id, opcional —
--     contratação nova pode ser cadastrada antes de existir na TiTa;
--   - public.profissionais_terapias_habilitadas: o que o profissional pode
--     prestar. A disponibilidade (próxima migration) só aceita terapias daqui;
--   - public.vw_profissionais_terapias_grade: as terapias que cada profissional
--     tem na grade TiTa (90 dias para trás em diante), já separadas — a TiTa grava
--     "Aplicador ABA (AE), Arteterapia, Psicopedagogia" num horário só;
--   - RPC profissionais_importar_tita(): traz da TiTa quem ainda não está aqui e
--     completa campos VAZIOS dos que já estão. Nunca sobrescreve o que a equipe
--     editou; o último valor visto na TiTa fica em dados_tita para a tela mostrar
--     a divergência.
--
-- Dado pessoal (CPF, e-mail, celular, endereço): leitura e escrita só com a
-- permissão cadastros_profissionais. anon não tem grant nenhum. Sem DELETE:
-- profissional que sai é inativado. Idempotente.

-- ═════════════════════════════════════════════════════════════════════════════
-- A) Profissionais
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.profissionais (
  id                    bigint generated always as identity primary key,
  tita_profissional_id  bigint unique,
  origem                text not null default 'manual',

  nome                  text not null,
  cpf                   text,
  email                 text,
  celular               text,

  tipo_registro         text,
  uf_registro           text,
  codigo_registro       text,
  cbo                   text,

  cep                   text,
  logradouro            text,
  numero                text,
  complemento           text,
  bairro                text,
  cidade                text,
  uf                    text,

  terapia_focal_id      bigint references public.cadastro_terapias(id) on delete set null,
  ativo                 boolean not null default true,
  observacoes           text,

  -- Último retrato da TiTa (nome, cpf, celular, cbo, registro…), atualizado a
  -- cada importação. Não é o cadastro: é a referência para a tela dizer "a TiTa
  -- tem outro valor aqui".
  dados_tita            jsonb,
  sincronizado_tita_em  timestamptz,

  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now(),
  atualizado_por        uuid,

  constraint profissionais_origem_check check (origem in ('tita', 'manual')),
  constraint profissionais_nome_check check (length(btrim(nome)) between 2 and 200),
  constraint profissionais_cpf_check check (cpf is null or cpf ~ '^\d{11}$'),
  constraint profissionais_email_check
    check (email is null or (length(email) <= 200 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  constraint profissionais_celular_check check (celular is null or celular ~ '^\d{10,13}$'),
  constraint profissionais_uf_registro_check check (uf_registro is null or uf_registro ~ '^[A-Z]{2}$'),
  constraint profissionais_uf_check check (uf is null or uf ~ '^[A-Z]{2}$'),
  constraint profissionais_cep_check check (cep is null or cep ~ '^\d{8}$'),
  constraint profissionais_textos_curtos check (
        coalesce(length(tipo_registro), 0)   <= 30
    and coalesce(length(codigo_registro), 0) <= 40
    and coalesce(length(cbo), 0)             <= 10
    and coalesce(length(logradouro), 0)      <= 200
    and coalesce(length(numero), 0)          <= 20
    and coalesce(length(complemento), 0)     <= 100
    and coalesce(length(bairro), 0)          <= 100
    and coalesce(length(cidade), 0)          <= 100
    and coalesce(length(observacoes), 0)     <= 2000
  )
);

create index if not exists idx_profissionais_nome on public.profissionais (nome);

comment on table public.profissionais is
  'Cadastro de profissionais do Pulsar. Chave própria (id); tita_profissional_id é só o vínculo com a TiTa. Sem DELETE: inativar. Dado pessoal — só com a permissão cadastros_profissionais.';
comment on column public.profissionais.dados_tita is
  'Último valor visto na TiTa para nome/cpf/celular/cbo/registro (importação). Referência para mostrar divergência; o cadastro em si são as colunas.';

-- Normaliza e carimba quem/quando. CPF, celular e CEP viram só dígitos; UF e
-- tipo de registro, maiúsculas; texto vazio vira null (assim o CHECK não acusa
-- "" e a importação enxerga o campo como vazio).
create or replace function public.sp_profissionais_antes_gravar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.nome            := regexp_replace(btrim(new.nome), '\s+', ' ', 'g');
  new.cpf             := nullif(regexp_replace(coalesce(new.cpf, ''), '\D', '', 'g'), '');
  new.celular         := nullif(regexp_replace(coalesce(new.celular, ''), '\D', '', 'g'), '');
  new.cep             := nullif(regexp_replace(coalesce(new.cep, ''), '\D', '', 'g'), '');
  new.email           := nullif(lower(btrim(coalesce(new.email, ''))), '');
  new.tipo_registro   := nullif(btrim(coalesce(new.tipo_registro, '')), '');
  new.uf_registro     := nullif(upper(btrim(coalesce(new.uf_registro, ''))), '');
  new.uf              := nullif(upper(btrim(coalesce(new.uf, ''))), '');
  new.codigo_registro := nullif(btrim(coalesce(new.codigo_registro, '')), '');
  new.cbo             := nullif(btrim(coalesce(new.cbo, '')), '');
  new.logradouro      := nullif(btrim(coalesce(new.logradouro, '')), '');
  new.numero          := nullif(btrim(coalesce(new.numero, '')), '');
  new.complemento     := nullif(btrim(coalesce(new.complemento, '')), '');
  new.bairro          := nullif(btrim(coalesce(new.bairro, '')), '');
  new.cidade          := nullif(btrim(coalesce(new.cidade, '')), '');
  new.observacoes     := nullif(btrim(coalesce(new.observacoes, '')), '');
  new.atualizado_em   := now();
  new.atualizado_por  := auth.uid();
  if tg_op = 'INSERT' then
    new.criado_em := now();
  else
    new.criado_em := old.criado_em;
  end if;
  return new;
end $$;

drop trigger if exists trg_profissionais_antes_gravar on public.profissionais;
create trigger trg_profissionais_antes_gravar
  before insert or update on public.profissionais
  for each row execute function public.sp_profissionais_antes_gravar();

-- ═════════════════════════════════════════════════════════════════════════════
-- B) Terapias habilitadas
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.profissionais_terapias_habilitadas (
  profissional_id  bigint not null references public.profissionais(id) on delete cascade,
  terapia_id       bigint not null references public.cadastro_terapias(id),
  origem           text not null default 'manual',
  criado_em        timestamptz not null default now(),
  criado_por       uuid default auth.uid(),
  primary key (profissional_id, terapia_id),
  constraint prof_terapias_hab_origem_check check (origem in ('tita', 'manual'))
);

create index if not exists idx_prof_terapias_hab_terapia
  on public.profissionais_terapias_habilitadas (terapia_id);

comment on table public.profissionais_terapias_habilitadas is
  'Terapias que o profissional pode prestar. A disponibilidade só aceita terapias desta lista.';

-- ═════════════════════════════════════════════════════════════════════════════
-- C) Terapias que cada profissional tem na grade TiTa
-- ═════════════════════════════════════════════════════════════════════════════
-- security_invoker: respeita a RLS de quem consulta (csv_grades_profissionais
-- já é legível por todo logado; a view não abre nada novo).
create or replace view public.vw_profissionais_terapias_grade
with (security_invoker = true) as
select
  g.profissional_id,
  btrim(t.nome)  as terapia_nome,
  count(*)       as horarios,
  max(g.data)    as ultima_data
from public.csv_grades_profissionais g
cross join lateral regexp_split_to_table(coalesce(g.terapia_nome, ''), ',') as t(nome)
where g.ativo
  and g.profissional_id is not null
  and g.data >= current_date - 90
  and btrim(t.nome) <> ''
  and public.normalizar_nome_terapia(t.nome) <> 'ainda nao selecionado'
group by g.profissional_id, btrim(t.nome);

comment on view public.vw_profissionais_terapias_grade is
  'Terapias por profissional (id TiTa) na grade dos últimos 90 dias em diante, separando os horários com várias terapias. Base da cor do card e da sugestão de terapias habilitadas.';

-- ═════════════════════════════════════════════════════════════════════════════
-- D) Importação da TiTa
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.profissionais_importar_tita()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome_usuario text;
  v_novos        integer := 0;
  v_atualizados  integer := 0;
  v_terapias     integer := 0;
  v_vinculados   integer := 0;
begin
  if auth.uid() is null or not public.usuario_tem_permissao('cadastros_profissionais') then
    raise exception 'Sem permissão para importar profissionais.' using errcode = '42501';
  end if;

  -- Um import por vez: dois cliques simultâneos não duplicam nada (há unique),
  -- mas contariam "novos" em dobro.
  perform pg_advisory_xact_lock(hashtext('profissionais_importar_tita'));

  select u.nome into v_nome_usuario from public.usuarios u where u.id = auth.uid();

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

  -- Cadastrado à mão antes de existir na TiTa: quando o CPF aparece na grade,
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
    returning 1
  )
  select count(*) into v_vinculados from vinc;

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
    returning id, nome
  ),
  trilha as (
    insert into public.cadastros_auditoria
      (tabela, registro_id, acao, alvo_nome, resumo, usuario_id, usuario_nome)
    select 'profissional', ins.id::text, 'criar', ins.nome,
           'Importado da TiTa.', auth.uid(), v_nome_usuario
    from ins
    returning 1
  )
  select count(*) into v_novos from trilha;

  -- Existentes: completa só o que está vazio e renova o retrato da TiTa.
  with upd as (
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
            or (p.uf_registro is null and t.uf_registro is not null))
    returning 1
  )
  -- Os recém-inseridos não entram aqui: o dados_tita deles já é igual.
  select count(*) into v_atualizados from upd;

  -- Terapias habilitadas: semeadas da grade SÓ para quem ainda não tem nenhuma.
  -- Depois disso a lista é da equipe — reimportar não devolve uma terapia que
  -- alguém tirou de propósito. Terapias novas na grade aparecem na tela como
  -- "vistas na TiTa, não habilitadas".
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

  return jsonb_build_object(
    'novos', v_novos,
    'vinculados_por_cpf', v_vinculados,
    'atualizados', v_atualizados,
    'terapias_vinculadas', v_terapias,
    'vistos_na_tita', (select count(*) from pg_temp.tmp_tita)
  );
end $$;

comment on function public.profissionais_importar_tita() is
  'Botão "Importar da TiTa": cria quem falta (origem tita) e completa campos vazios; nunca sobrescreve edição. Semeia terapias habilitadas só de quem não tem nenhuma. Exige cadastros_profissionais.';

-- ═════════════════════════════════════════════════════════════════════════════
-- RLS e GRANTs
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.profissionais                      enable row level security;
alter table public.profissionais_terapias_habilitadas enable row level security;

do $$
declare pol record;
begin
  for pol in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('profissionais', 'profissionais_terapias_habilitadas')
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

create policy "profissionais_select" on public.profissionais
  for select to authenticated
  using (public.usuario_tem_permissao('cadastros_profissionais'));
create policy "profissionais_insert" on public.profissionais
  for insert to authenticated
  with check (public.usuario_tem_permissao('cadastros_profissionais'));
create policy "profissionais_update" on public.profissionais
  for update to authenticated
  using (public.usuario_tem_permissao('cadastros_profissionais'))
  with check (public.usuario_tem_permissao('cadastros_profissionais'));

create policy "prof_terapias_hab_select" on public.profissionais_terapias_habilitadas
  for select to authenticated
  using (public.usuario_tem_permissao('cadastros_profissionais'));
create policy "prof_terapias_hab_insert" on public.profissionais_terapias_habilitadas
  for insert to authenticated
  with check (public.usuario_tem_permissao('cadastros_profissionais'));
create policy "prof_terapias_hab_delete" on public.profissionais_terapias_habilitadas
  for delete to authenticated
  using (public.usuario_tem_permissao('cadastros_profissionais'));

revoke all on public.profissionais                      from public, anon, authenticated;
revoke all on public.profissionais_terapias_habilitadas from public, anon, authenticated;
revoke all on public.vw_profissionais_terapias_grade    from public, anon, authenticated;

grant select on public.profissionais to authenticated;
-- Conteúdo editável pela tela. tita_profissional_id, origem e dados_tita são da
-- importação; criado_em/atualizado_* do gatilho.
grant insert (nome, cpf, email, celular, tipo_registro, uf_registro, codigo_registro, cbo,
              cep, logradouro, numero, complemento, bairro, cidade, uf,
              terapia_focal_id, ativo, observacoes)
  on public.profissionais to authenticated;
grant update (nome, cpf, email, celular, tipo_registro, uf_registro, codigo_registro, cbo,
              cep, logradouro, numero, complemento, bairro, cidade, uf,
              terapia_focal_id, ativo, observacoes)
  on public.profissionais to authenticated;

grant select on public.profissionais_terapias_habilitadas to authenticated;
grant insert (profissional_id, terapia_id) on public.profissionais_terapias_habilitadas to authenticated;
grant delete on public.profissionais_terapias_habilitadas to authenticated;

grant select on public.vw_profissionais_terapias_grade to authenticated;

grant select, insert, update on public.profissionais                      to service_role;
grant select, insert, delete on public.profissionais_terapias_habilitadas to service_role;
grant select on public.vw_profissionais_terapias_grade                   to service_role;

revoke all on function public.profissionais_importar_tita()   from public, anon;
revoke all on function public.sp_profissionais_antes_gravar() from public, anon, authenticated;
grant execute on function public.profissionais_importar_tita() to authenticated;
