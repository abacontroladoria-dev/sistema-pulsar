-- Renomeia a permissão de /central-terapeutas no catálogo — pedido do usuário
-- (22/09/2026): "central-terapeutas não aparece em /admin/permissoes".
--
-- Ela sempre apareceu: a linha existe desde o seed de 29/05/2026
-- (20260529110000_create_permissoes_tables.sql) e o código `escala_terapeutica`
-- está em CODIGO_PARA_ROTAS e nos roleDefaults de admin, diretoria, terapeutico
-- e rp. O gate nunca esteve quebrado.
--
-- O problema era só de rótulo: na tela ela se chama "Escala Terapêutica", nome
-- que não remete à rota /central-terapeutas nem ao que o menu mostra, então
-- quem administra não a reconhecia na lista.
--
-- Só o texto muda. `codigo` continua 'escala_terapeutica' — é a chave usada por
-- usuarios_permissoes, pelos grupos de permissão (20260819130100) e pelo
-- resolver; renomear o código quebraria as concessões já gravadas.

UPDATE public.permissoes
SET nome = 'Central de Terapeutas',
    descricao = 'Escala, disponibilidade e cobertura dos terapeutas — inclui o relatório .xlsx por período'
WHERE codigo = 'escala_terapeutica';
