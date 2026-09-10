-- Move a permissão `tv_avisos` do grupo 'Administração' para 'Marketing'.
--
-- O seed original (20260831150100) a pôs em 'Administração' porque era onde a
-- tela ficava no Sidebar, e um grupo novo apareceria sozinho com uma linha só.
-- Agora existe o setor `marketing` (20260910120000) e o Sidebar tem um grupo
-- próprio para ele — deixar a permissão sob 'Administração' faria a
-- /admin/permissoes contar uma história diferente da do menu, e mandaria quem
-- procura "o acesso do marketing" abrir o card errado.
--
-- Só o rótulo muda. O código `tv_avisos` é o mesmo, e nenhuma concessão já
-- gravada em usuarios_permissoes é afetada: o `grupo` é agrupamento visual, não
-- entra em nenhuma checagem de acesso.

UPDATE public.permissoes
   SET grupo = 'Marketing'
 WHERE codigo = 'tv_avisos';
