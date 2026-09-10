-- =============================================================================
-- Livro-caixa — registrar 20260701020100 / 020200 / 020300 (bloco CRM)
-- =============================================================================
-- CONTEXTO: o bloco CRM (20260701020000…020400) está em produção — medido por
-- crm_diagnostico_pre_exposicao.sql em 2026-09-10: 6 tabelas, grants completos
-- em `authenticated`, RLS com 4 policies cada, 6 estágios semeados, 3 teams e
-- 5 team_functions.
--
-- Mas o livro-caixa só tem DUAS das cinco versões:
--
--   20260701020000  crm_schema     ← registrada
--   20260701020100  crm_tables     ← AUSENTE (as 6 tabelas estão no banco)
--   20260701020200  crm_indexes    ← AUSENTE (os 11 índices estão no banco)
--   20260701020300  crm_rls        ← AUSENTE (as 24 policies estão no banco)
--   20260701020400  crm_seed       ← registrada
--
-- Aplicado no banco e registrado no livro-caixa são coisas diferentes. Estas
-- três entraram sem o INSERT correspondente.
--
-- POR QUE IMPORTA: enquanto a versão estiver ausente, qualquer `supabase db
-- push` futuro a considera PENDENTE — e o push empurra o pendente INTEIRO, não
-- só ela (reference_db_push_blast_radius). Aqui as três são reexecutáveis, então
-- reaplicá-las seria inócuo em si:
--
--   - 020100: `create table if not exists` (12x) e todo `create trigger` é
--     precedido de `drop trigger if exists`;
--   - 020200: `create index if not exists` (11x);
--   - 020300: 25 `drop policy if exists` cobrindo as 24 `create policy`, e
--     `enable row level security` é idempotente.
--
-- O perigo não é a reaplicação destas três — é o resto do pendente que o push
-- levaria de carona. Registrá-las aqui reduz esse conjunto.
--
-- ⚠ ATENÇÃO — 020300 tem uma janela: os `drop policy if exists` derrubam as 24
--   policies e as recriam na mesma transação. Enquanto a transação não commita,
--   ninguém fica sem RLS (as tabelas seguem com `enable row level security` e o
--   default de RLS sem policy é NEGAR tudo). Mas é motivo de sobra para não
--   reaplicar de propósito num horário de uso.
--
-- Este snippet NÃO reaplica nada. Só registra o que já está no ar.
-- Idempotente: `on conflict (version) do nothing`.
-- =============================================================================

begin;

insert into supabase_migrations.schema_migrations (version, name)
values
  ('20260701020100', 'crm_tables'),
  ('20260701020200', 'crm_indexes'),
  ('20260701020300', 'crm_rls')
on conflict (version) do nothing;

commit;

-- ---------------------------------------------------------------------------
-- Conferência 1 (só lê) — esperado: as CINCO versões do bloco presentes,
-- em ordem, sem buraco.
-- ---------------------------------------------------------------------------
select version, name
from supabase_migrations.schema_migrations
where version like '2026070102%'
order by version;

-- ---------------------------------------------------------------------------
-- Conferência 2 (só lê) — o que o livro-caixa agora afirma continua batendo
-- com o banco. Esperado, medido em produção em 2026-09-10:
--   tabelas = 6 · policies = 24 · rls_desligado = 0 · estagios = 6
--
-- rls_desligado > 0 é o único resultado que exige ação imediata: tabela sem
-- RLS num schema exposto é dado aberto a qualquer usuário autenticado.
-- ---------------------------------------------------------------------------
select
  (select count(*) from pg_tables  where schemaname = 'crm')            as tabelas,
  (select count(*) from pg_policies where schemaname = 'crm')           as policies,
  (select count(*) from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'crm' and c.relkind = 'r'
      and not c.relrowsecurity)                                         as rls_desligado,
  (select count(*) from crm.pipeline_stages where is_active)            as estagios;
