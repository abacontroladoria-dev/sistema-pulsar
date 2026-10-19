-- ═════════════════════════════════════════════════════════════════════════════
-- PRÉ-CHECAGEM da branch feat/seguranca-falhas-dados — RESUMO NUMA CONSULTA SÓ.
-- SÓ LEITURA. Mesmos blocos de 20261019_seguranca_prechecagem_SO_LEITURA.sql,
-- mas numa consulta única: o SQL Editor mostra só o resultado da ÚLTIMA
-- consulta de um arquivo, então rodar o arquivo inteiro escondia os outros
-- blocos. Aqui sai uma linha por bloco, com o esperado ao lado.
--
-- Rode tudo de uma vez e mande o resultado (botão de copiar como JSON).
-- ═════════════════════════════════════════════════════════════════════════════

with efetivas as (
  select u.id, e.key as codigo
  from public.usuarios u
  join public.grupos_permissoes_membros m on m.usuario_id = u.id
  join public.grupos_permissoes g on g.id = m.grupo_id
  cross join lateral jsonb_each(g.modelo_permissoes) e(key, value)
  where e.value = 'true'::jsonb
  union
  select up.usuario_id, up.permissao_codigo from public.usuarios_permissoes up where up.permitido
  except
  select up.usuario_id, up.permissao_codigo from public.usuarios_permissoes up where not up.permitido
),
revogadas(tabela, coluna) as (values
  ('grade_profissionais_tita', 'cpf_profissional'), ('grade_profissionais_tita', 'numero_telefone'),
  ('grade_profissionais_tita', 'cbo_profissional'), ('grade_profissionais_tita', 'registro_profissional'),
  ('grade_profissionais_tita', 'tipo_registro_profissional'), ('grade_profissionais_tita', 'uf_registro_profissional'),
  ('grade_profissionais_tita', 'raw_json'), ('grade_profissionais_tita', 'observacoes_sala'),
  ('csv_grades_profissionais', 'profissional_cpf'), ('csv_grades_profissionais', 'sala_observacoes'),
  ('csv_grades_profissionais', 'descricao_evolucao')
),
b21 as (
  select count(*) n, string_agg(c.relname, ', ' order by c.relname) itens
  from pg_class c
  where c.relnamespace = 'central'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity
),
b22 as (
  select count(*) n, string_agg(x, ', ' order by x) itens from (
    select distinct vn.nspname || '.' || v.relname || ' → ' || r.tabela || '.' || r.coluna as x
    from revogadas r
    join pg_class t on t.relname = r.tabela and t.relnamespace = 'public'::regnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attname = r.coluna
    join pg_depend d on d.refobjid = t.oid and d.refobjsubid = a.attnum and d.classid = 'pg_rewrite'::regclass
    join pg_rewrite rw on rw.oid = d.objid
    join pg_class v on v.oid = rw.ev_class and v.oid <> t.oid
    join pg_namespace vn on vn.oid = v.relnamespace
  ) s
),
b23 as (
  select count(*) n, string_agg(distinct dv.relname, ', ') itens
  from pg_depend d
  join pg_rewrite rw on rw.oid = d.objid
  join pg_class dv on dv.oid = rw.ev_class
  where d.refobjid = to_regclass('public.vw_profissionais_disponiveis') and dv.relname <> 'vw_profissionais_disponiveis'
),
b25 as (
  select count(*) n, string_agg(p.oid::regprocedure::text, ', ') itens
  from pg_proc p
  where p.pronamespace in ('public'::regnamespace, 'central'::regnamespace)
    and not p.prosecdef and p.prokind = 'f'
    and p.prosrc ~ '(grade_profissionais_tita|csv_grades_profissionais)'
    and p.prosrc ~* '(cpf_profissional|numero_telefone|cbo_profissional|registro_profissional|observacoes_sala|profissional_cpf|sala_observacoes|descricao_evolucao|raw_json|\*)'
),
b26 as (
  select count(*) n
  from public.controle_terapeutico
  where created_at >= now() - interval '60 days' and confirmado_por_nome is null
),
b31 as (
  select count(*) n, string_agg(u.nome || ' (' || u.role || ', ' || u.central_role || ')', '; ' order by u.nome) itens
  from public.usuarios u
  where u.ativo and u.central_role is not null and u.role <> 'admin'
    and not exists (select 1 from efetivas e where e.id = u.id and e.codigo = 'connect')
),
b32 as (
  select count(*) n, string_agg(x, '; ' order by x) itens from (
    select u.nome || ' (' || u.role || ', ' || count(*) || ' gravações)' as x
    from public.controle_terapeutico ct
    join public.usuarios u on u.id = ct.confirmado_por
    where ct.confirmado_em >= now() - interval '60 days'
      and u.ativo and u.role not in ('admin', 'disponibilidade_terapeuta')
      and not exists (select 1 from efetivas e where e.id = u.id and e.codigo = 'escala_terapeutica')
    group by u.nome, u.role
  ) s
),
b51 as (
  select count(*) n, string_agg(
    u.nome || ' (' || u.role || coalesce(': ' || (
      select string_agg(e.codigo, ', ' order by e.codigo) from efetivas e
      where e.id = u.id and e.codigo in ('cronograma_grade', 'cronograma_ocupacao_paciente', 'indicadores_alimentar_bd',
                                         'connect', 'relacionamento_prestador_pep', 'robo_sharepoint', 'autorizacoes_avulsas')
    ), '') || ')', '; ' order by u.nome) itens
  from public.usuarios u
  where u.ativo and u.role not in ('admin', 'diretoria', 'cronograma')
    and not exists (select 1 from efetivas e where e.id = u.id and e.codigo = 'cadastros_pacientes')
),
b52 as (
  select count(*) n, string_agg(relname, ', ' order by relname) itens from (
    select distinct v.relname
    from pg_depend d
    join pg_rewrite rw on rw.oid = d.objid
    join pg_class v on v.oid = rw.ev_class
    where d.refobjid = 'public.pacientes'::regclass and v.oid <> 'public.pacientes'::regclass
      and coalesce((select bool_or(o in ('security_invoker=true', 'security_invoker=on')) from unnest(v.reloptions) o), false)
  ) s
),
b53 as (
  select count(*) n, string_agg(p.oid::regprocedure::text, ', ') itens
  from pg_proc p
  where p.pronamespace in ('public'::regnamespace, 'central'::regnamespace)
    and not p.prosecdef and p.prokind = 'f'
    and p.prosrc ~ '\mpacientes\M'
),
b54 as (
  select string_agg(p.proname || ' definer=' || p.prosecdef, ', ' order by p.proname) itens
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('pacientes_lista_basica', 'pacientes_buscar_para_pep', 'sp_pep_vincular_pasta_paciente',
                      'listar_pacientes_assim', 'sp_listar_pacientes_assim_interno')
)
select '2.1 central sem RLS' as bloco, 'só worker_tick_config' as esperado, n::text as qtd, itens as resultado from b21
union all select '2.2 views que leem colunas revogadas', 'só vw_profissionais_disponiveis', n::text, itens from b22
union all select '2.3 dependentes da view de cobertura', 'vazio', n::text, itens from b23
union all select '2.4 definição da view de cobertura', 'Livre e id_unidade = 280', null,
  pg_get_viewdef(to_regclass('public.vw_profissionais_disponiveis'), true)
union all select '2.5 funções invoker com colunas revogadas', 'vazio', n::text, itens from b25
union all select '2.6 inserções sem a Edge Function (60d)', '0', n::text, null from b26
union all select '3.1 papel da Central sem Connect', 'conferir nomes', n::text, itens from b31
union all select '3.2 gravam controle sem escala_terapeutica', 'vazio', n::text, itens from b32
union all select '5.1 deixam de ler pacientes direto', 'informativo: conferir nomes', n::text, itens from b51
union all select '5.2 views invoker sobre pacientes', 'vw_paciente_laudos_flat, vw_grade_execucao_pulsar', n::text, itens from b52
union all select '5.3 funções invoker que leem pacientes', 'vazio (160000 já aplicada)', n::text, itens from b53
union all select '5.4 funções da 160000', '5 funções, todas definer=true', null, itens from b54;
