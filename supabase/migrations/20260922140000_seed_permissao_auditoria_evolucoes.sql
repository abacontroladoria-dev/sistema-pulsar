-- Cadastra a Auditoria de Evoluções no catálogo de permissões — pedido do
-- usuário (22/09/2026): liberar a visualização para a diretoria e fazer a tela
-- aparecer em /admin/permissoes.
--
-- As duas coisas se resolvem aqui. `terapeutico_auditoria_evolucoes` já existe
-- em roleDefaults (admin, diretoria e terapeutico) e em CODIGO_PARA_ROTAS desde
-- que a tela nasceu, mas NÃO estava em public.permissoes — e é essa tabela que
-- o catálogo de /admin/permissoes lista (services/permissoes.service.ts). Sem a
-- linha, quem administra não conseguia conceder nem revogar a tela para
-- ninguém: ela existia no código e era invisível na administração.
--
-- Grupo 'Terapêutico' para cair junto das outras três telas do setor (Gestão,
-- Análise de Evolução, PDI) — a mesma ordem do Sidebar.

INSERT INTO public.permissoes (codigo, nome, rota, grupo, descricao) VALUES
  ('terapeutico_auditoria_evolucoes', 'Auditoria de Evoluções', '/terapeutico/auditoria-evolucoes', 'Terapêutico',
   'Revisão técnica das evoluções por IA — risco de glosa, checklist das quatro perguntas obrigatórias e cobrança por profissional')
ON CONFLICT (codigo) DO NOTHING;
