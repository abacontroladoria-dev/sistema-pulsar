-- Livro-caixa — registra as duas edições de get_tokens_mensal de 25/09/2026
--
-- Só REGISTRA; não executa SQL de migration nenhuma. As duas foram aplicadas
-- pelo SQL Editor sem a linha em supabase_migrations.schema_migrations.
--
-- Conferido no banco em 02/10/2026, em pg_get_functiondef de get_tokens_mensal:
--   • 20260925150000 — APLICADA: o corpo vivo tem a marca e
--     `vinculo_agenda AS MATERIALIZED`.
--   • 20260925140000 — sem marca no corpo, e é o esperado: a 150000 substitui o
--     trecho inteiro de `chaves_vinculo` onde a 140000 tinha mexido (o próprio
--     cabeçalho da 150000 registra que a 140000 rodou e "não adiantou"). O que a
--     140000 queria — paciente e data antes de tuss_da_sessao — está contido no
--     corpo atual.
--
-- Por que registrar a 140000 também: reexecutada hoje ela FALHA ("join de
-- vinculos_mes esperado 1x, achei 0"), porque o join que ela procura não existe
-- mais. Fora do livro-caixa, um `db push` futuro tentaria rodá-la e abortaria.
--
-- Reexecutável.

insert into supabase_migrations.schema_migrations (version, name)
values
  ('20260925140000', 'tokens_mensal_vinculo_sem_varrer_agenda'),
  ('20260925150000', 'tokens_mensal_vinculo_materializado')
on conflict (version) do nothing;

select version, name
  from supabase_migrations.schema_migrations
 where version in ('20260925140000', '20260925150000')
 order by version;
