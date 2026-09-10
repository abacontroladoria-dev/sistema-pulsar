-- ============================================================================
-- APLICAR EM PRODUÇÃO — CRM: grants explícitos de tabela
--
-- Empacota a migration 20260909150000_crm_grants_explicitos.sql para ser colada
-- de uma vez no SQL Editor. Não é uma migration: o arquivo canônico vive em
-- supabase/migrations/ e este aqui é o registro do que entrou em produção.
--
-- ---------------------------------------------------------------------------
-- ⚠ RODE PRIMEIRO O DIAGNÓSTICO: supabase/snippets/crm_diagnostico_pre_exposicao.sql
--
--   Ele é somente leitura e responde as duas perguntas que decidem se este
--   arquivo faz sentido:
--
--   a) As 6 tabelas do schema `crm` EXISTEM em produção?
--      O bloco base (20260701020000…020400) está registrado no README dos
--      snippets como "decidido como NÃO aplicar". Se a seção 1 do diagnóstico
--      vier VAZIA, não há tabela para receber grant — PARE, e decida antes se o
--      bloco base entra.
--
--   b) `crm.pipeline_stages` tem estágios (o seed 020400)?
--      Sem estágios o Kanban abre sem nenhuma coluna, mesmo com tudo o mais
--      correto.
-- ---------------------------------------------------------------------------
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- 20260701020000 concedeu privilégios ao schema `crm` APENAS via
-- `alter default privileges`, que só alcança objetos criados DEPOIS do comando e
-- somente quando o role que cria é o mesmo que rodou o ALTER — o que não se pode
-- assumir num banco gerenciado, onde o owner efetivo varia entre `postgres`,
-- `supabase_admin` e o dono da conexão que aplicou a migration.
--
-- O Postgres verifica o grant de TABELA antes de avaliar as policies de RLS.
-- Logo, um schema com RLS impecável (e o do `crm` é) e sem grant responde 403 em
-- toda leitura autenticada. Enquanto o `crm` esteve fechado no PostgREST isso
-- ficou latente; ao expô-lo, viraria erro em produção.
--
-- SEGURANÇA: isto NÃO abre dados. `authenticated` continua barrado pelas policies
-- de 20260701020300, que exigem organization_id = central.current_organization_id()
-- e central.ca_current_role() in ('admin','director'). O grant apenas permite que
-- o Postgres CHEGUE a avaliar a policy. `anon` recebe somente USAGE, nunca DML.
--
-- ⚠ ORDEM DO ROTEIRO COMPLETO:
--   1. crm_diagnostico_pre_exposicao.sql          (só lê)
--   2. este arquivo                                (SQL Editor)
--   3. expor o schema `crm` no PostgREST           (Dashboard → API → Exposed schemas)
--   4. deploy do frontend                          (rotas /api/crm/* e a UI)
--   5. crm_pos_exposicao_verificacao.sql           (contraprova)
--
--   Sem o passo 3 toda rota nova responde PGRST106 / HTTP 406:
--   "Only the following schemas are exposed: public, graphql_public, central"
--
-- IDEMPOTENTE: grants repetidos são no-op. Seguro reaplicar.
--
-- ROLLBACK:
--   revoke select, insert, update, delete on all tables in schema crm from authenticated;
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Guarda: se o schema não tiver tabela, aborta com mensagem em vez de aplicar
-- um grant vazio e registrar no livro-caixa uma migration que não fez nada.
-- ---------------------------------------------------------------------------
do $$
declare
  _n int;
begin
  select count(*) into _n from pg_tables where schemaname = 'crm';
  if _n = 0 then
    raise exception
      'O schema crm não tem tabelas. O bloco base 20260701020000..020400 não foi aplicado — rode crm_diagnostico_pre_exposicao.sql e decida sobre ele antes deste arquivo.';
  end if;
  raise notice 'schema crm: % tabelas encontradas', _n;
end $$;

-- ---------------------------------------------------------------------------
-- Bloco 1 — schema-level usage (já concedido em 20260701020000; repetido para
-- que este arquivo seja autossuficiente se aplicado isoladamente)
-- ---------------------------------------------------------------------------
grant usage on schema crm to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Bloco 2 — DML nas tabelas que JÁ EXISTEM: o que o default privileges não
-- alcançou. É este bloco que evita o 403.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete
  on all tables in schema crm
  to authenticated;

grant select, insert, update, delete
  on all tables in schema crm
  to service_role;

grant usage, select on all sequences in schema crm to authenticated;
grant usage, select on all sequences in schema crm to service_role;

-- ---------------------------------------------------------------------------
-- Bloco 3 — reafirma o default para tabelas futuras (mantém o comportamento
-- pretendido pela migration original, agora com o passo explícito ao lado)
-- ---------------------------------------------------------------------------
alter default privileges in schema crm
  grant select, insert, update, delete on tables to authenticated;

alter default privileges in schema crm
  grant usage, select on sequences to authenticated;

alter default privileges in schema crm
  grant all on tables to service_role;

alter default privileges in schema crm
  grant all on sequences to service_role;

-- ---------------------------------------------------------------------------
-- Livro-caixa — sem este INSERT, qualquer `supabase db push` futuro considera a
-- versão PENDENTE, e o push empurra o pendente INTEIRO, não só ela
-- (reference_db_push_blast_radius). Reaplicar esta migration seria inócuo, mas o
-- push levaria de carona todas as outras pendentes — essa é a parte perigosa.
-- ---------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, name)
values ('20260909150000', 'crm_grants_explicitos')
on conflict (version) do nothing;

commit;

-- ============================================================================
-- CONFERÊNCIA (só lê) — rodar DEPOIS do commit
-- ============================================================================

-- 1. Esperado: as 6 tabelas com "DELETE, INSERT, SELECT, UPDATE" em
--    `authenticated` e em `service_role`. Nenhuma linha com "(NENHUM…)".
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

-- 2. `anon` NÃO pode ter DML em lugar nenhum do schema. Esperado: 0 linhas.
select table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'crm'
  and grantee = 'anon'
  and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
order by table_name, privilege_type;

-- 3. RLS continua ligado em todas as 6 (o grant não substitui a policy).
--    Esperado: rls_ligado = true em todas, e n_policies > 0.
select
  c.relname,
  c.relrowsecurity as rls_ligado,
  (select count(*) from pg_policies p
    where p.schemaname = 'crm' and p.tablename = c.relname) as n_policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'crm' and c.relkind = 'r'
order by c.relname;

-- 4. A versão entrou no livro-caixa. Esperado: 1 linha.
select version, name
from supabase_migrations.schema_migrations
where version = '20260909150000';
