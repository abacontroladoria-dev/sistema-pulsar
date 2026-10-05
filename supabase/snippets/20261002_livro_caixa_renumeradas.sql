-- Livro-caixa — os números novos das migrations renumeradas
--
-- Só REGISTRA. Reexecutável. Complemento de
-- 20261002_livro_caixa_migrations_aplicadas_sem_registro.sql.
--
-- Quatro migrations foram aplicadas pelo CLI com um número e depois
-- RENUMERADAS no repositório (o número antigo passou a outra migration). O
-- livro-caixa ficou com a linha antiga, no nome antigo:
--
--   versão no livro-caixa         nome registrado                 arquivo do repo hoje nessa versão
--   20260810120000                central_filas_lease             add_valor_pep_mensal_contratos_itens
--   20260810130000                usuarios_admin_central_role     create_pep_trilha_auditoria
--   20260819120000                tokens_mensal_auditoria_assim   create_grupos_permissoes
--   20260902100000                sync_tita_grade_horizonte_diario create_suspensao_temporaria
--
-- Conferido no catálogo em 02/10/2026: os QUATRO arquivos da coluna da direita
-- estão aplicados (tudo o que criam existe), e as quatro renumeradas também.
-- As linhas antigas NÃO são reescritas — guardam o `statements` de quem de fato
-- rodou naquele número —; só entram os números novos.
--
-- 20260929120000_catalogo_permissoes_espelha_sidebar é a cópia anterior de
-- 20260930130100 (mesmo nome, conteúdo diferente; a de 30/09 é a registrada).
-- O que a anterior cria existe; registrá-la impede que um db push a reexecute
-- por cima da versão de 30/09.

insert into supabase_migrations.schema_migrations (version, name)
values
  ('20260810120050', 'central_filas_lease'),
  ('20260810130050', 'usuarios_admin_central_role'),
  ('20260819120100', 'tokens_mensal_auditoria_assim'),
  ('20260902100050', 'sync_tita_grade_horizonte_diario'),
  ('20260929120000', 'catalogo_permissoes_espelha_sidebar')
on conflict (version) do nothing;

select version, name from supabase_migrations.schema_migrations
 where version in ('20260810120050','20260810130050','20260819120100','20260902100050','20260929120000')
 order by 1;
