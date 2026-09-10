-- CRM — grants explícitos de tabela (pré-requisito para expor o schema)
--
-- Depends on:
--   20260701020000_crm_schema.sql   (schema + alter default privileges)
--   20260701020100_crm_tables.sql   (as 6 tabelas)
--   20260701020300_crm_rls.sql      (policies admin/director)
--
-- ============================================================================
-- POR QUE ESTA MIGRATION EXISTE
--
-- 20260701020000 concedeu privilégios ao schema crm APENAS via
-- `alter default privileges`. Default privileges valem somente para objetos
-- criados DEPOIS do comando e apenas quando o role que cria é o mesmo que
-- rodou o ALTER — o que não se pode assumir num banco gerenciado, onde o
-- owner efetivo varia entre `postgres`, `supabase_admin` e o dono da conexão
-- que aplicou a migration.
--
-- O schema `central` não confiou nisso. 20260701000000_create_ca_schema.sql
-- faz o grant explícito e deixa o comentário C-1 (2026-06-17) registrando o
-- motivo:
--
--   "authenticated precisa de DML grants para que RLS funcione. PostgreSQL
--    verifica table-level grant ANTES de avaliar policies — sem DML grant em
--    authenticated, toda query autenticada falha com permission denied"
--
-- Ou seja: RLS impecável (e o do crm é) não substitui o grant de tabela. Um
-- schema com policies corretas e sem grant responde 403 em toda leitura.
-- Enquanto o crm esteve fechado no PostgREST isso ficou latente; ao expô-lo,
-- viraria erro em produção.
--
-- Ver também [[reference_grants_coluna_postgrest]]: REVOKE por coluna não
-- subtrai grant de tabela, e `select("*")` numa tabela com grant parcial dá
-- 403. Aqui o grant é de tabela inteira, então esse caso não se aplica — mas
-- vale a regra geral de conferir o grant efetivo, nunca o pretendido.
--
-- SEGURANÇA
--   Isto NÃO abre dados. `authenticated` continua barrado pelas policies de
--   20260701020300, que exigem organization_id = central.current_organization_id()
--   e central.ca_current_role() in ('admin','director'). O grant apenas permite
--   que o Postgres CHEGUE a avaliar a policy.
--   `anon` recebe somente USAGE no schema, nunca DML — idêntico ao central.
--
-- IDEMPOTENTE: grants repetidos são no-op. Seguro reaplicar.
--
-- ROLLBACK:
--   revoke select, insert, update, delete on all tables in schema crm from authenticated;
-- ============================================================================

-- Schema-level usage (já concedido em 20260701020000; repetido por segurança
-- para que esta migration seja autossuficiente se aplicada isoladamente)
grant usage on schema crm to authenticated, anon, service_role;

-- DML nas tabelas que JÁ EXISTEM — o que o default privileges não alcançou
grant select, insert, update, delete
  on all tables in schema crm
  to authenticated;

grant select, insert, update, delete
  on all tables in schema crm
  to service_role;

grant usage, select on all sequences in schema crm to authenticated;
grant usage, select on all sequences in schema crm to service_role;

-- Reafirma o default para tabelas futuras (mantém o comportamento pretendido
-- pela migration original, agora com o passo explícito acima ao lado)
alter default privileges in schema crm
  grant select, insert, update, delete on tables to authenticated;

alter default privileges in schema crm
  grant usage, select on sequences to authenticated;

alter default privileges in schema crm
  grant all on tables to service_role;

alter default privileges in schema crm
  grant all on sequences to service_role;

-- ============================================================================
-- VERIFICAÇÃO
--
-- Depois de aplicar, `supabase/snippets/crm_diagnostico_pre_exposicao.sql`
-- seção 1 deve listar as 6 tabelas com
-- "DELETE, INSERT, SELECT, UPDATE" na coluna `authenticated`.
-- ============================================================================
