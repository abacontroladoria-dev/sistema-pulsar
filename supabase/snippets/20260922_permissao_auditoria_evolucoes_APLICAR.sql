-- Auditoria de Evoluções no catálogo de permissões.
-- Rodar no SQL Editor do Supabase (produção). Idempotente: pode rodar de novo.
--
-- Espelha supabase/migrations/20260922140000_seed_permissao_auditoria_evolucoes.sql
-- Aplicar por aqui em vez de `db push`, que empurraria todo o pendente.

INSERT INTO public.permissoes (codigo, nome, rota, grupo, descricao) VALUES
  ('terapeutico_auditoria_evolucoes', 'Auditoria de Evoluções', '/terapeutico/auditoria-evolucoes', 'Terapêutico',
   'Revisão técnica das evoluções por IA — risco de glosa, checklist das quatro perguntas obrigatórias e cobrança por profissional')
ON CONFLICT (codigo) DO NOTHING;

-- Conferência: deve listar as 3 telas do grupo Terapêutico + a nova.
SELECT codigo, nome, rota, grupo
FROM public.permissoes
WHERE grupo = 'Terapêutico'
ORDER BY nome;
