-- Disponibilidade de AT Externo (Escola / Casa) + inativação de profissionais
-- marcados como INATIVO no TiTa (e Aline De Miranda Costa, ID TiTa 8647).
--
-- 1. "AT Externo Escola" e "AT Externo Casa" não são salas físicas da clínica
--    (listarSalas filtra unidade_nome <> 'AT Externo', então nunca aparecem em
--    Ocupação de Salas), mas precisam existir em cronograma_salas para que a
--    Disponibilidade dos profissionais de AT e a Grade (/cronograma/grade)
--    registrem e exibam normalmente os horários de Escola e Casa.
-- 2. Profissionais cujo nome no TiTa começa com "INATIVO" (ex.: "INATIVO - Nome"
--    ou "INATIVO-Nome") ficam inativos no Pulsar, inclusive em futuras cargas
--    de profissionais_importar_tita().
--
-- Idempotente.

set lock_timeout = '5s';

-- ═════════════════════════════════════════════════════════════════════════════
-- 1) Locais de AT Externo (Escola e Casa) para Disponibilidade e Grade
-- ═════════════════════════════════════════════════════════════════════════════
insert into public.cronograma_salas (
  unidade_nome, numero_sala, nome_exibicao, capacidade, status, sala_nome_referencia, observacoes
)
select v.unidade_nome, v.numero_sala, v.nome_exibicao, v.capacidade, v.status, v.ref, v.obs
from (values
  ('AT Externo', 'Escola', 'Escola', 'multiplo', 'adm', 'AT Externo Escola', 'Local virtual para disponibilidade e Grade de AT Externo (não aparece em Ocupação de Salas).'),
  ('AT Externo', 'Casa',   'Casa',   'multiplo', 'adm', 'AT Externo Casa',   'Local virtual para disponibilidade e Grade de AT Externo (não aparece em Ocupação de Salas).')
) as v(unidade_nome, numero_sala, nome_exibicao, capacidade, status, ref, obs)
where not exists (
  select 1 from public.cronograma_salas s
  where s.unidade_nome = v.unidade_nome and s.numero_sala = v.numero_sala
);

update public.cronograma_salas
   set nome_exibicao = numero_sala,
       capacidade = 'multiplo',
       status = 'adm',
       sala_nome_referencia = 'AT Externo ' || numero_sala
 where unidade_nome = 'AT Externo' and numero_sala in ('Escola', 'Casa');

-- ═════════════════════════════════════════════════════════════════════════════
-- 2) Inativação de quem já saiu (ID TiTa 8647 e prefixo INATIVO no nome)
-- ═════════════════════════════════════════════════════════════════════════════
update public.profissionais
   set ativo = false,
       data_saida = coalesce(data_saida, public.hoje_brasilia())
 where ativo
   and (tita_profissional_id = 8647 or btrim(nome) ilike 'INATIVO%');

-- ═════════════════════════════════════════════════════════════════════════════
-- 3) profissionais_importar_tita: respeita prefixo INATIVO vindo do TiTa
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
  if auth.uid() is not null and not public.usuario_tem_permissao('cadastros_profissionais') then
    raise exception 'Sem permissão para importar profissionais.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('profissionais_importar_tita'));

  select u.nome into v_nome_usuario from public.usuarios u where u.id = auth.uid();

  insert into public.tita_importacoes (id, alvo, situacao, usuario_id, usuario_nome)
  values (v_imp, 'profissionais', 'aplicando', auth.uid(), coalesce(v_nome_usuario, 'Usuário do Pulsar'));

  begin
    create temporary table pg_temp.tmp_tita on commit drop as
    with grade as (
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

    create temporary table pg_temp.tmp_mud (
      prof_id bigint, ordem integer, campo text, de text, para text
    ) on commit drop;

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

    create temporary table pg_temp.tmp_antes on commit drop as
    select p.id, p.nome, p.cpf, p.celular, p.cbo, p.codigo_registro, p.tipo_registro, p.uf_registro, p.dados_tita
    from public.profissionais p
    join pg_temp.tmp_tita t on t.profissional_id = p.tita_profissional_id;

    -- Novos (se já vier com prefixo INATIVO no nome, nasce inativo)
    with ins as (
      insert into public.profissionais (
        tita_profissional_id, origem, nome, cpf, celular, cbo, codigo_registro,
        tipo_registro, uf_registro, ativo, dados_tita, sincronizado_tita_em
      )
      select
        t.profissional_id, 'tita', t.nome, t.cpf, t.celular, t.cbo, t.codigo_registro,
        t.tipo_registro, t.uf_registro,
        not (btrim(t.nome) ilike 'INATIVO%'),
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

    -- Existentes: completa só o que está vazio, renova o retrato do TiTa e inativa
    -- quem passou a ter prefixo INATIVO no TiTa.
    update public.profissionais p
       set cpf             = coalesce(p.cpf, t.cpf),
           celular         = coalesce(p.celular, t.celular),
           cbo             = coalesce(p.cbo, t.cbo),
           codigo_registro = coalesce(p.codigo_registro, t.codigo_registro),
           tipo_registro   = coalesce(p.tipo_registro, t.tipo_registro),
           uf_registro     = coalesce(p.uf_registro, t.uf_registro),
           ativo           = case when btrim(t.nome) ilike 'INATIVO%' then false else p.ativo end,
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
            or (p.ativo and btrim(t.nome) ilike 'INATIVO%')
            or (p.cpf is null and t.cpf is not null)
            or (p.celular is null and t.celular is not null)
            or (p.cbo is null and t.cbo is not null)
            or (p.codigo_registro is null and t.codigo_registro is not null)
            or (p.tipo_registro is null and t.tipo_registro is not null)
            or (p.uf_registro is null and t.uf_registro is not null));

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

revoke all on function public.profissionais_importar_tita() from public, anon;
grant execute on function public.profissionais_importar_tita() to authenticated, service_role;
