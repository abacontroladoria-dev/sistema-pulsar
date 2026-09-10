-- Contraprova de 20260910_APLICAR_tv_avisos_e_papel_marketing.sql.
--
-- Rodar DEPOIS de aplicar o pacote. Cada seção deve bater com o valor
-- esperado indicado no comentário; se algo vier vazio/zero onde não deveria,
-- o bloco correspondente não entrou (ou o bucket/objects ficou de fora por
-- causa do "must be owner of table objects" e precisa ser recriado pelo
-- Dashboard).

-- 1) Tabela tv_avisos existe, com trigger e RLS forçada
select
  to_regclass('public.tv_avisos') is not null as tabela_existe,
  (select count(*) from pg_trigger
     where tgrelid = 'public.tv_avisos'::regclass
       and tgname = 'trg_tv_avisos_atualizado') as trigger_presente, -- esperado 1
  (select relrowsecurity and relforcerowsecurity
     from pg_class where oid = 'public.tv_avisos'::regclass) as rls_forcada; -- esperado true

-- 2) Policies da tabela: 4 (select/insert/update/delete), já com o papel marketing
select policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename = 'tv_avisos'
 order by policyname;
-- esperado: 4 linhas, qual/with_check contendo "marketing"

-- 3) Bucket tv-avisos: público, 10 MiB, 3 mime types
select id, public, file_size_limit, allowed_mime_types
  from storage.buckets
 where id = 'tv-avisos';
-- esperado: public=true, file_size_limit=10485760, allowed_mime_types com jpeg/png/webp

-- 4) Policies de storage.objects para o bucket: 4 (select/insert/update/delete)
select policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and policyname like 'tv_avisos_objects_%'
 order by policyname;
-- esperado: 4 linhas; a de select é "to public"; insert/update/delete contêm "marketing"

-- 5) Permissão tv_avisos cadastrada e no grupo visual certo
select codigo, nome, rota, grupo
  from public.permissoes
 where codigo = 'tv_avisos';
-- esperado: 1 linha, grupo = 'Marketing'

-- 6) Papel marketing aceito no constraint de usuarios.role
select conname, pg_get_constraintdef(oid)
  from pg_constraint
 where conrelid = 'public.usuarios'::regclass
   and conname = 'usuarios_role_check';
-- esperado: definição contendo 'marketing'

-- 7) Grupo de permissões semente 'Marketing'
select id, nome, descricao
  from public.grupos_permissoes
 where nome = 'Marketing';
-- esperado: 1 linha

-- 8) Livro-caixa: as 6 versões registradas
select version
  from supabase_migrations.schema_migrations
 where version in (
   '20260831150000','20260831150100','20260910120000',
   '20260910120100','20260910120200','20260910120300'
 )
 order by version;
-- esperado: 6 linhas

-- 9) As duas imagens de teste já persistidas (se o upload foi refeito depois do pacote)
select id, caminho, titulo, ordem, ativo, criado_em
  from public.tv_avisos
 order by ordem, criado_em;
