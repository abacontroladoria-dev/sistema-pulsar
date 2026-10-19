-- ═════════════════════════════════════════════════════════════════════════════
-- PRÉ-CHECAGEM da branch feat/seguranca-falhas-dados — SÓ LEITURA.
-- Rodar no SQL Editor, bloco a bloco, ANTES de aplicar as migrations da branch.
-- Nada aqui altera o banco. Cada bloco diz o esperado; o que aparecer fora do
-- esperado, mande para conferirmos antes de aplicar.
--
-- "Telas efetivas" abaixo = mesma regra de permissoes_efetivas() (grupos +
-- ajustes individuais), escrita por extenso porque no SQL Editor não há usuário
-- logado para a função usar. admin vê tudo.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── FASE 2 (migration 20261019140000_seguranca_correcoes_diretas) ───────────

-- 2.1 Tabelas do schema central SEM RLS (qualquer login lê e escreve nelas).
--     Esperado: só worker_tick_config. Qualquer outra entra na migration.
select c.relname as tabela_sem_rls
from pg_class c
where c.relnamespace = 'central'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity
order by 1;

-- 2.2 Views que leem as colunas que o login vai deixar de ler. A migration
--     PARA se achar alguma (fora vw_profissionais_disponiveis, que ela recria).
--     Esperado: só vw_profissionais_disponiveis.
with revogadas(tabela, coluna) as (values
  ('grade_profissionais_tita', 'cpf_profissional'), ('grade_profissionais_tita', 'numero_telefone'),
  ('grade_profissionais_tita', 'cbo_profissional'), ('grade_profissionais_tita', 'registro_profissional'),
  ('grade_profissionais_tita', 'tipo_registro_profissional'), ('grade_profissionais_tita', 'uf_registro_profissional'),
  ('grade_profissionais_tita', 'raw_json'), ('grade_profissionais_tita', 'observacoes_sala'),
  ('csv_grades_profissionais', 'profissional_cpf'), ('csv_grades_profissionais', 'sala_observacoes'),
  ('csv_grades_profissionais', 'descricao_evolucao')
)
select distinct vn.nspname || '.' || v.relname as view, r.tabela || '.' || r.coluna as coluna
from revogadas r
join pg_class t on t.relname = r.tabela and t.relnamespace = 'public'::regnamespace
join pg_attribute a on a.attrelid = t.oid and a.attname = r.coluna
join pg_depend d on d.refobjid = t.oid and d.refobjsubid = a.attnum and d.classid = 'pg_rewrite'::regclass
join pg_rewrite rw on rw.oid = d.objid
join pg_class v on v.oid = rw.ev_class and v.oid <> t.oid
join pg_namespace vn on vn.oid = v.relnamespace
order by 1, 2;

-- 2.3 Quem depende de vw_profissionais_disponiveis (a migration a recria; com
--     dependente, o DROP falha). Esperado: vazio.
select distinct dv.relname as depende_da_view
from pg_depend d
join pg_rewrite rw on rw.oid = d.objid
join pg_class dv on dv.oid = rw.ev_class
where d.refobjid = 'public.vw_profissionais_disponiveis'::regclass and dv.relname <> 'vw_profissionais_disponiveis';

-- 2.4 Definição atual da view oficial de cobertura. Esperado: filtro
--     status_agendamento = 'Livre' AND id_unidade = 280.
select pg_get_viewdef('public.vw_profissionais_disponiveis'::regclass, true) as definicao_atual;

-- 2.5 Funções que NÃO são security definer e citam as colunas revogadas no
--     corpo (rodam como quem chama e passariam a dar "permission denied").
--     Esperado: vazio (o grep do repositório não achou nenhuma).
select p.oid::regprocedure as funcao
from pg_proc p
where p.pronamespace in ('public'::regnamespace, 'central'::regnamespace)
  and not p.prosecdef
  and p.prokind = 'f'
  and (p.prosrc ~ '(grade_profissionais_tita|csv_grades_profissionais)')
  and (p.prosrc ~* '(cpf_profissional|numero_telefone|cbo_profissional|registro_profissional|observacoes_sala|profissional_cpf|sala_observacoes|descricao_evolucao|raw_json|\*)')
order by 1;

-- 2.6 Inserções em controle_terapeutico feitas pelo navegador (sem passar pela
--     Edge Function, que grava confirmado_por_nome). Esperado: 0 nos últimos
--     60 dias — a policy `with check (true)` que some não está em uso.
select count(*) as insercoes_sem_nome_60d
from public.controle_terapeutico
where created_at >= now() - interval '60 days' and confirmado_por_nome is null;

-- ── FASE 3 (rotas /api e Edge Function — só código) ─────────────────────────

-- 3.1 Quem tem papel da Central (central_role) mas NÃO tem a tela Connect: perde
--     o acesso às rotas /api/central/* e /api/crm/*. Confira cada nome; para
--     manter, dê o Connect pelo grupo ou ajuste individual ANTES do redeploy.
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
)
select u.nome, u.email, u.role, u.central_role
from public.usuarios u
where u.ativo and u.central_role is not null and u.role <> 'admin'
  and not exists (select 1 from efetivas e where e.id = u.id and e.codigo = 'connect')
order by u.nome;

-- 3.2 Quem grava status na Central de Terapeutas / Disponibilidade do Terapeuta
--     e perderia a gravação: usuários ativos que gravaram nos últimos 60 dias e
--     não têm `escala_terapeutica` nem papel admin/disponibilidade_terapeuta.
--     Esperado: vazio.
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
)
select u.nome, u.email, u.role, count(*) as gravacoes_60d
from public.controle_terapeutico ct
join public.usuarios u on u.id = ct.confirmado_por
where ct.confirmado_em >= now() - interval '60 days'
  and u.ativo and u.role not in ('admin', 'disponibilidade_terapeuta')
  and not exists (select 1 from efetivas e where e.id = u.id and e.codigo = 'escala_terapeutica')
group by 1, 2, 3
order by 4 desc;

-- ── FASE 4 (migration 20261019170000_seguranca_evolucao_coluna) ─────────────
--    O bloco 2.2 já lista views sobre descricao_evolucao (esperado: nenhuma).
--    O bloco 2.5 lista funções invoker que citam a coluna (esperado: nenhuma).

-- ── FASE 5 (migrations 20261019180000 e 20261019180100) ─────────────────────

-- 5.1 Quem DEIXA de ler o cadastro de pacientes direto (hoje lê tudo pela
--     policy using (true)). Informativo: as telas de Grade, Ocupação Paciente,
--     Alimentar BD, Connect, PEP e Autorizações Avulsas continuam pela lista
--     básica para quem tem a permissão da tela. Confira se alguém aqui precisa
--     do cadastro INTEIRO (CPF, endereço, responsável): esse recebe
--     `cadastros_pacientes` pelo grupo antes de aplicar a 20261019180100.
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
)
select u.nome, u.email, u.role,
       (select string_agg(e.codigo, ', ' order by e.codigo) from efetivas e
         where e.id = u.id and e.codigo in ('cronograma_grade', 'cronograma_ocupacao_paciente',
               'indicadores_alimentar_bd', 'connect', 'relacionamento_prestador_pep', 'robo_sharepoint',
               'autorizacoes_avulsas')) as telas_com_caminho_estreito
from public.usuarios u
where u.ativo and u.role not in ('admin', 'diretoria', 'cronograma')
  and not exists (select 1 from efetivas e where e.id = u.id and e.codigo = 'cadastros_pacientes')
order by u.nome;

-- 5.2 Views que leem pacientes e rodam como quem consulta (security_invoker):
--     passam a voltar vazias para quem não tem Pacientes. Esperado (pelas
--     migrations): vw_paciente_laudos_flat e vw_grade_execucao_pulsar, as duas
--     sem leitor no frontend. Qualquer outra, mande para conferirmos.
select distinct v.relname as view
from pg_depend d
join pg_rewrite rw on rw.oid = d.objid
join pg_class v on v.oid = rw.ev_class
where d.refobjid = 'public.pacientes'::regclass and v.oid <> 'public.pacientes'::regclass
  and coalesce((select bool_or(o in ('security_invoker=true', 'security_invoker=on')) from unnest(v.reloptions) o), false)
order by 1;

-- 5.3 Funções que NÃO são security definer e leem pacientes (rodam como quem
--     chama). Esperado: só listar_pacientes_assim (a 20261019180000 a
--     transforma em invólucro com checagem). Qualquer outra, mande.
select p.oid::regprocedure as funcao
from pg_proc p
where p.pronamespace in ('public'::regnamespace, 'central'::regnamespace)
  and not p.prosecdef and p.prokind = 'f'
  and p.prosrc ~ '\mpacientes\M'
order by 1;

-- 5.4 Definição de listar_pacientes_assim em produção (a 20261019180000 a
--     preserva como sp_listar_pacientes_assim_interno). Esperado: o retorno
--     TABLE(paciente_id bigint, paciente_nome text, numero_carteirinha text,
--     crm text, crm_uf text, nome_medico text, ultima_sessao date).
select pg_get_function_result('public.listar_pacientes_assim()'::regprocedure) as retorno,
       (select prosecdef from pg_proc where oid = 'public.listar_pacientes_assim()'::regprocedure) as security_definer;
