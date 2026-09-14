-- Advisors ERRORS 2026-09-14 — as 2 views que restaram das 17 de 2026-08-17.
--
-- Estado medido em produção antes desta migration:
--
--   vw_central_pacientes      (DEFINER)  anon_pode_ler = true   <- REGRESSÃO
--   vw_paciente_laudos_flat   (DEFINER)  anon_pode_ler = false  <- nunca flipada
--
-- ── vw_central_pacientes: por que regrediu ───────────────────────────────────
-- Foi flipada para invoker em 2026-08-17 (Passo 5a do mutirão, registrado em
-- supabase/snippets/20260817_advisors_fix_fase2_security_invoker.sql).
-- A 20260825010000_origem_da_guia_nas_leituras.sql faz DROP VIEW + CREATE VIEW
-- (não `create or replace`), e o DROP leva junto reloptions — inclusive
-- security_invoker. A migration documenta que refaz GRANT e COMMENT, mas não
-- security_invoker, porque quem a escreveu não sabia do flip de agosto.
-- 20260825130000_autorizacoes_avulsas.sql repete o padrão.
--
-- MESMA FAMÍLIA do que já está registrado para funções: CREATE OR REPLACE perde
-- proconfig. Aqui é DROP+CREATE perdendo reloptions. Vale para as outras 16
-- views do mutirão: qualquer uma que for recriada volta a DEFINER, calada.
--
-- Impacto do flip: inerte. vw_central_pacientes não é lida como dado por
-- ninguém — listar_central_pacientes(date) a usa só como RETURNS SETOF, ou seja,
-- como TIPO de retorno. (Por isso também não pode ser dropada.)
--
-- ── vw_paciente_laudos_flat: nunca foi flipada ───────────────────────────────
-- Nasceu em 20260827100000 / 20260827100100, depois do mutirão. Bases:
--   cadastros_pacientes_laudos                 RLS on, FORCE on, 3 policies
--   cadastros_pacientes_laudo_especialidades   RLS on, FORCE on, 4 policies
--   pacientes                                  RLS on, sem FORCE, 3 policies
--
-- A policy de SELECT das duas primeiras é idêntica e é função do PAPEL, não da
-- linha:
--     usuario_tem_permissao('cadastros_pacientes')
--     OR remuneracao_has_role(array['admin','diretoria','cronograma'])
-- Ou libera tudo, ou nada — nunca resultado parcial. Quem abre o Acompanhamento
-- de Laudos já passa por essa permissão, então o flip não esvazia a tela.
--
-- E há um motivo mais forte para o flip ser seguro aqui: com FORCE ROW LEVEL
-- SECURITY, nem o dono escapa da RLS. A view DEFINER JÁ está sendo filtrada
-- hoje. Invoker não subtrai nada novo.
--
-- ATENÇÃO DE MÉTODO, para quem validar isto ou o resto do lote: o FORCE não
-- existia em 2026-08-17 — o mutirão inteiro se apoiou em `relforcerowsecurity`
-- vazio no schema. Onde há FORCE, validar comparando "lido como dono" contra
-- "lido como usuário" NÃO VALE: o dono também é filtrado, e a igualdade vira
-- tautologia (o mesmo erro que fez o Passo 4 se dar por aprovado sem ter sido
-- aplicado). Valide contra a tela, ou com um papel sem a permissão.

begin;

alter view public.vw_central_pacientes    set (security_invoker = true);
alter view public.vw_paciente_laudos_flat set (security_invoker = true);

-- O anon aqui NÃO é herança de default privilege: o default do `postgres` para
-- tabelas/views já não inclui anon, e a assinatura confirma — anon tinha só
-- SELECT, enquanto authenticated e service_role têm os 7 privilégios. Grant
-- explícito, portanto. A origem é
-- supabase/snippets/20260901_registrar_avulsas_no_livro_caixa.sql:46, aplicado em
-- 2026-09-01 para "restaurar o que a migration declara" — sob a premissa, já
-- falsa naquele dia, de que a view era SECURITY INVOKER. Ela havia voltado a
-- DEFINER no DROP VIEW de 2026-08-25. Ou seja: o grant deu ao anon leitura
-- IRRESTRITA (definer ignora a RLS das bases), não a leitura filtrada que o
-- snippet supunha. Detalhe completo no cabeçalho daquele arquivo.
revoke all on public.vw_central_pacientes from anon;

commit;

-- ===== CONFERÊNCIA =====
-- Rodar NO MESMO script do ALTER (o SQL Editor devolve só o último statement).
-- Um ALTER que não executou se disfarça de teste aprovado quando a conferência
-- vem em execução separada — foi o que aconteceu no Passo 4 do mutirão.
select c.relname,
       coalesce((select option_value from pg_options_to_table(c.reloptions)
                  where option_name = 'security_invoker'), '(DEFINER)') as security_invoker,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_pode_ler
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('vw_central_pacientes', 'vw_paciente_laudos_flat');
-- Esperado: as duas com security_invoker = true e anon_pode_ler = false.

-- VALIDAR na tela, como usuário NÃO-admin (admin passa por is_admin() e não
-- testa nada):
--   [ ] /central-pacientes carrega e lista (RPC listar_central_pacientes)
--   [ ] Acompanhamento de Laudos lista os laudos (vw_paciente_laudos_flat)
