-- Grupo de permissões 'Marketing', na mesma linha dos grupos-semente de
-- 20260819120000 (um por papel, com o rótulo do ROLE_LABELS).
--
-- Não confundir com as OUTRAS duas coisas chamadas "grupo" que também ganharam
-- 'Marketing' nesta leva:
--   • permissoes.grupo  → agrupamento visual dos cards em /admin/permissoes
--                         (20260910120200);
--   • SidebarGroup      → o menu.
-- Este aqui é o de public.grupos_permissoes: uma lista de membros com um modelo
-- de permissões aplicável em lote.
--
-- `modelo_permissoes` fica VAZIO de propósito, como todo grupo-semente. O modelo
-- só passa a valer quando alguém clica "Aplicar" em /admin/permissoes, e gravar
-- um `{"tv_avisos": true}` aqui daria a impressão, na tela, de que o acesso já
-- está concedido — quando na verdade nada foi materializado em
-- usuarios_permissoes. Quem entra com papel `marketing` já tem a tela pelo
-- roleDefaults (routes.ts) e a escrita pelo ramo por papel da RLS
-- (20260910120100); o grupo é conveniência organizacional, não é o gate.

insert into public.grupos_permissoes (nome, descricao) values
  ('Marketing', 'Grupo inicial — marketing')
on conflict (nome) do nothing;

-- Membros: quem já estiver com role = 'marketing'. Na prática hoje isto não pega
-- ninguém (o papel acabou de ser criado em 20260910120000), mas mantém a
-- migration idempotente e correta se ela for reaplicada depois dos usuários
-- existirem — exatamente como o seed original fez com os outros papéis.
insert into public.grupos_permissoes_membros (grupo_id, usuario_id)
select g.id, u.id
  from public.grupos_permissoes g
  join public.usuarios u on u.role = 'marketing'
 where g.nome = 'Marketing'
on conflict (grupo_id, usuario_id) do nothing;
