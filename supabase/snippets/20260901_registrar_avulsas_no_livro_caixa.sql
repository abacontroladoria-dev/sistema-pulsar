-- =============================================================================
-- Livro-caixa — registrar 20260825130000 e 20260825140000 (autorizações avulsas)
-- =============================================================================
-- CONTEXTO: o diagnóstico de 2026-09-01 provou que as duas migrations JÁ ESTÃO
-- APLICADAS em produção (colunas, índice, as duas RPCs com EXECUTE, o catálogo de
-- permissão e a view com o filtro `avulsa` preservando `numero_autorizacao_origem`).
-- Foram coladas à mão e só o INSERT no livro-caixa ficou para trás.
--
-- POR QUE IMPORTA: enquanto a versão estiver ausente de
-- supabase_migrations.schema_migrations, qualquer `supabase db push` futuro
-- considera as duas PENDENTES e tenta reaplicá-las. A 130000 faz
-- DROP VIEW + CREATE VIEW em vw_central_pacientes — reaplicar derruba os grants de
-- novo e a /central-pacientes pode abrir vazia, com 403, sem erro visível.
--
-- ⚠️ ATUALIZAÇÃO 2026-09-14 — o DROP VIEW faz pior que derrubar grant:
-- leva junto o `security_invoker` (reloptions morrem no DROP). Foi essa a causa
-- dos 2 ERRORS do advisor de 2026-09-14. O bloco 2 abaixo, que em 01/09 "restaurou"
-- o grant do anon, virou exposição por causa disso — leia o aviso lá.
--
-- Se a 20260825130000 alguma vez for reaplicada, ela precisa ganhar
--     alter view public.vw_central_pacientes set (security_invoker = true);
-- junto dos GRANTs, e NÃO deve conceder nada a `anon`. O arquivo dela ainda
-- declara `GRANT ... TO anon` e ainda não repõe o security_invoker: reaplicar
-- hoje reintroduz a regressão inteira.
--
-- Este snippet NÃO reaplica nada. Só registra o que já está no ar.
-- Idempotente: `on conflict do nothing`.

begin;

-- ---------------------------------------------------------------------------
-- Bloco 1 — o registro que faltou
-- ---------------------------------------------------------------------------
insert into supabase_migrations.schema_migrations (version, name)
values
  ('20260825130000', 'autorizacoes_avulsas'),
  ('20260825140000', 'terapias_tuss_sem_a_view')
on conflict (version) do nothing;

-- ---------------------------------------------------------------------------
-- Bloco 2 — o grant do `anon` que o DROP VIEW levou
-- ---------------------------------------------------------------------------
-- A 20260825130000 concede a `anon, authenticated, service_role`, mas hoje a view
-- só tem service_role, authenticated e postgres: o DROP levou o grant do anon e a
-- aplicação manual não o devolveu.
--
-- ⚠️ ESTE GRANT FOI UM ERRO. REVOGADO EM 20260914120000. NÃO REEXECUTAR.
--
-- A justificativa abaixo era esta, e a premissa dela é FALSA:
--
--     "Restaura exatamente o que a migration declara — não amplia acesso para
--      papel nenhum além do que o arquivo já previa. A view é SECURITY INVOKER e
--      a RLS das tabelas de base continua valendo, então isto não expõe linha
--      que o anon já não pudesse ver por essas policies."
--
-- A view NÃO era mais SECURITY INVOKER quando este snippet rodou. O mesmo DROP
-- VIEW que levou o grant (bloco 2, acima) levou também o `security_invoker` posto
-- em 2026-08-17 — reloptions morrem no DROP, exatamente como proconfig morre no
-- CREATE OR REPLACE de função. A view voltou a DEFINER em 2026-08-25, e este
-- snippet, em 2026-09-01, raciocinou sobre um estado que já não existia.
--
-- Com a view DEFINER, ela roda como o dono e IGNORA a RLS das bases. Então o
-- grant não devolveu "o que a migration declarava": deu leitura irrestrita de
-- vw_central_pacientes à chave anônima, que é pública no bundle do browser.
-- Ficou assim em produção de 2026-09-01 até 2026-09-14, e foi o que apareceu
-- como ERROR security_definer_view no advisor.
--
-- LIÇÃO: "a view é invoker" é estado, não propriedade do arquivo. Antes de
-- grantar qualquer coisa a `anon`, MEÇA:
--   select coalesce((select option_value from pg_options_to_table(c.reloptions)
--                     where option_name = 'security_invoker'), '(DEFINER)')
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname = 'vw_central_pacientes';
--
-- A resposta certa à dúvida das linhas originais ("devolver ou não ao anon?") é
-- NÃO devolver: a tela é autenticada, passa pela RPC listar_central_pacientes, e
-- nada depende do anon aqui. Quem descreve a realidade é a 20260914120000.
--
-- grant select on public.vw_central_pacientes to anon;  -- NÃO REATIVAR

commit;

-- ---------------------------------------------------------------------------
-- Conferência (rodar depois; só lê)
-- ---------------------------------------------------------------------------
-- Esperado: as duas versões presentes, e 3 grants de SELECT na view —
-- `authenticated, postgres, service_role`. (Eram 4 na redação original, que
-- contava o `anon`; ele foi revogado em 20260914120000 e NÃO deve voltar.
-- Conferido em produção em 2026-09-14: exatamente esses 3.)
select 'livro-caixa' as o_que, string_agg(version, ', ') as valor
from supabase_migrations.schema_migrations
where version in ('20260825130000', '20260825140000')
union all
select 'grants da view', string_agg(grantee, ', ' order by grantee)
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name   = 'vw_central_pacientes'
  and privilege_type = 'SELECT';
