-- Permissão da aba "Preencher Receitas Faturadas"
-- (/cronograma/indicadores?tab=alimentar-bd).
--
-- Grupo 'Indicadores', junto de indicadores_previsao_receitas e
-- indicadores_historico_receitas — mesmos papéis (admin, diretoria) por
-- decisão do usuário em 2026-09-23.
--
-- ⚠️ Os grupos de permissão são ADITIVOS e a união dos modelos só é
-- materializada no "Aplicar" de /admin/permissoes. Inserir o código aqui NÃO
-- concede acesso a ninguém: quem entra por papel entra pelos roleDefaults do
-- frontend + o ramo por papel das policies (20260923140100), e quem tem
-- override explícito em usuarios_permissoes precisa receber o código lá.

INSERT INTO public.permissoes (codigo, nome, rota, grupo, descricao) VALUES
  ('indicadores_alimentar_bd', 'Preencher Receitas Faturadas', '/cronograma/indicadores?tab=alimentar-bd', 'Indicadores',
   'Lançamento manual de pagamentos/NF recebidos por paciente e competência, usado para apurar Efetivado real vs. Indefinido (Glosa ou Receita)')
ON CONFLICT (codigo) DO NOTHING;
