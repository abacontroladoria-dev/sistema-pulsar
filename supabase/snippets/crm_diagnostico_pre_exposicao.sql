-- CRM — diagnóstico ANTES de expor o schema no PostgREST
--
-- Contexto: o schema `crm` (migrations 20260701020*) existe no banco desde
-- julho, mas NÃO está na lista de schemas expostos do PostgREST. Toda tentativa
-- de `.schema('crm')` devolve PGRST106 com HTTP 406:
--   "Only the following schemas are exposed: public, graphql_public, central"
--
-- Antes de expor, é preciso confirmar três coisas. Rode este arquivo inteiro
-- no SQL Editor e leia as quatro seções.
--
-- SOMENTE LEITURA — não altera nada.

-- ============================================================================
-- 1. GRANTS DE TABELA — o bug provável
--
-- 20260701020000_crm_schema.sql usou APENAS `alter default privileges`, que
-- só afeta tabelas criadas DEPOIS do comando. As tabelas nasceram na migration
-- seguinte (20260701020100), então deveriam ter herdado... mas default
-- privileges são por (role_que_cria, schema), e só valem se quem criou as
-- tabelas for o mesmo role que rodou o ALTER DEFAULT PRIVILEGES.
--
-- O schema `central` NÃO confiou nisso: 20260701000000 faz `grant ... on all
-- tables` explicitamente, com o comentário C-1 explicando que sem DML grant em
-- `authenticated` toda query autenticada falha com "permission denied" — o
-- grant de tabela é verificado ANTES das policies de RLS.
--
-- ESPERADO se estiver tudo certo: 6 tabelas × 4 privilégios = 24 linhas para
-- `authenticated`. Se vier vazio ou incompleto, expor o schema agora entrega
-- 403 em toda leitura, mesmo com o RLS correto.
-- ============================================================================
select
  t.tablename,
  coalesce(
    string_agg(distinct g.privilege_type, ', ' order by g.privilege_type)
      filter (where g.grantee = 'authenticated'),
    '(NENHUM — vai dar permission denied)'
  ) as authenticated,
  coalesce(
    string_agg(distinct g.privilege_type, ', ' order by g.privilege_type)
      filter (where g.grantee = 'service_role'),
    '(NENHUM)'
  ) as service_role
from pg_tables t
left join information_schema.role_table_grants g
  on g.table_schema = t.schemaname
 and g.table_name   = t.tablename
 and g.grantee in ('authenticated', 'service_role')
where t.schemaname = 'crm'
group by t.tablename
order by t.tablename;

-- ============================================================================
-- 2. RLS — está habilitado e com quantas policies?
--
-- 20260701020300_crm_rls.sql cria 4 policies por tabela (select/insert/update/
-- delete), com admin+director em deals e deal_activities, e admin-só para
-- estrutura (pipeline_stages, teams, team_functions).
--
-- ESPERADO: rls_ativo = true em todas as 6, e 4 policies em cada.
-- Tabela com rls_ativo = false e schema exposto = dado aberto a qualquer
-- usuário autenticado.
-- ============================================================================
select
  c.relname                          as tabela,
  c.relrowsecurity                   as rls_ativo,
  c.relforcerowsecurity              as rls_forcado,
  count(p.polname)                   as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'crm'
  and c.relkind = 'r'
group by c.relname, c.relrowsecurity, c.relforcerowsecurity
order by c.relname;

-- ============================================================================
-- 3. VOLUME — as tabelas têm dados?
--
-- Verificado por API em 2026-09-09: central.contacts tem 3 linhas, todas com
-- contact_type='other' (zero leads), e central.conversations tem 3. Ou seja, o
-- trigger crm.auto_create_deal_on_lead() nunca teve o que disparar.
--
-- Se deals = 0, a UI de /connect nasce vazia — o que é esperado nesta fase.
-- pipeline_stages > 0 é o que importa: sem estágios o Kanban não tem colunas.
-- 20260701020400_crm_seed.sql deveria tê-los criado.
-- ============================================================================
select 'crm.pipeline_stages' as tabela, count(*) as linhas from crm.pipeline_stages
union all select 'crm.deals',            count(*) from crm.deals
union all select 'crm.deal_activities',  count(*) from crm.deal_activities
union all select 'crm.teams',            count(*) from crm.teams
union all select 'crm.team_functions',   count(*) from crm.team_functions
union all select 'crm.team_members',     count(*) from crm.team_members
union all select 'central.contacts',     count(*) from central.contacts
union all select 'central.conversations',count(*) from central.conversations
order by tabela;

-- ============================================================================
-- 4. OS ESTÁGIOS DO FUNIL — quais são, e de qual organização
--
-- O Kanban desenha uma coluna por estágio, ordenada por `position`.
-- `auto_win`/`auto_lose`: mover um deal para esse estágio fecha-o
-- automaticamente como won/lost.
--
-- Atenção ao organization_id: as policies filtram por
-- central.current_organization_id(). Estágios semeados numa org diferente da
-- do usuário logado ficam invisíveis, e o sintoma é um Kanban sem colunas —
-- não um erro.
-- ============================================================================
select
  s.organization_id,
  o.name        as organizacao,
  s.position,
  s.title,
  s.color,
  s.is_system,
  s.is_active,
  s.auto_win,
  s.auto_lose
from crm.pipeline_stages s
left join central.organizations o on o.id = s.organization_id
order by s.organization_id, s.position;
