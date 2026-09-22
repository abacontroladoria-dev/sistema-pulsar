-- Renomeia a permissão de /central-terapeutas: "Escala Terapêutica" passa a
-- "Central de Terapeutas", que é como a tela aparece no menu.
-- Rodar no SQL Editor do Supabase (produção). Idempotente: pode rodar de novo.
--
-- Espelha supabase/migrations/20260922190000_renomear_permissao_central_terapeutas.sql
-- Aplicar por aqui em vez de `db push`, que empurraria todo o pendente.
--
-- Só o rótulo muda. O código 'escala_terapeutica' fica como está: é a chave das
-- concessões já gravadas em usuarios_permissoes.

UPDATE public.permissoes
SET nome = 'Central de Terapeutas',
    descricao = 'Escala, disponibilidade e cobertura dos terapeutas — inclui o relatório .xlsx por período'
WHERE codigo = 'escala_terapeutica';

-- Conferência: a linha deve vir com o nome novo e a rota /central-terapeutas.
SELECT codigo, nome, rota, grupo
FROM public.permissoes
WHERE grupo = 'Terapêutico'
ORDER BY nome;
