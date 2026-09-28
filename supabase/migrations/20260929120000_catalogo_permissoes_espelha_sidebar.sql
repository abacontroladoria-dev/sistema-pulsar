-- Catálogo de permissões passa a espelhar o Sidebar — pedido do usuário
-- (29/09/2026): "Permissões por módulo × Sidebar deixe perfeito (alterando o
-- Permissões por módulo conforme o Sidebar)" e "cada item do sidebar precisa de
-- uma permissão própria".
--
-- Fonte: frontend/lib/permissions/menu.ts (a mesma lista que o Sidebar e
-- /admin/permissoes leem). Este arquivo foi GERADO a partir dela — se o menu
-- mudar, gere de novo em vez de editar à mão. menu.test.ts confere o lado do
-- código.
--
-- Estado medido no banco antes (28/09/2026, 48 linhas):
--   * faltavam 4 códigos que existem no código e no menu: api_integracao,
--     reposicao_faltas, cadastros_convenios, terapeutico_auditoria_evolucoes
--     (a seed 20260922140000 desta última nunca foi aplicada). Sem a linha,
--     ninguém conseguia conceder nem retirar essas telas em /admin/permissoes;
--   * sobravam 5 sem tela: autorizacoes (descontinuada em 26/08),
--     indicadores_historico_receitas (a aba não existe), cronograma_por_paciente,
--     cronograma_por_profissional e cadastros_profissionais (as páginas nunca
--     foram criadas). Nenhuma policy usa esses códigos (grep em supabase/);
--   * 15 nomes e 4 grupos divergiam do menu.
--
-- Idempotente: pode rodar de novo sem efeito.

-- 1. Ordem do menu — /admin/permissoes ordena por ela.
ALTER TABLE public.permissoes ADD COLUMN IF NOT EXISTS ordem integer;

-- 2. Códigos novos. `reconciliacao_assim` nasce aqui: a aba Reconciliação
--    ganhou código próprio, separado da Conferência ASSIM. Quem recebe o
--    acesso é o snippet 20260929_materializar_permissoes_APLICAR.sql, que copia
--    para cada pessoa o valor que ela tem em `auditoria_assim`.
INSERT INTO public.permissoes (codigo, nome, rota, grupo, descricao) VALUES
  ('api_integracao', 'API', '/admin/api', 'Administração', 'Documentação da API de integração de faltas — somente leitura, não mostra token'),
  ('reposicao_faltas', 'Reposição de Faltas', '/cronograma/reposicao', 'Cronograma', 'Reposição de faltas do cronograma'),
  ('cadastros_convenios', 'Convênios', '/cadastros/convenios', 'Cadastros', 'Cadastro nativo de convênios e planos de saúde'),
  ('terapeutico_auditoria_evolucoes', 'Auditoria de Evoluções', '/terapeutico/auditoria-evolucoes', 'Terapêutico', 'Revisão técnica das evoluções por IA — risco de glosa, checklist das quatro perguntas obrigatórias e cobrança por profissional'),
  ('reconciliacao_assim', 'Reconciliação ASSIM', '/auditoria-assim?tab=reconciliacao', 'Autorização', 'Aba Reconciliação de /auditoria-assim: autorizações, faltas, cancelamentos e glosas. Quem vincula continua decidido pelo papel nas RPCs')
ON CONFLICT (codigo) DO NOTHING;

-- 3. Nome, grupo, rota e ordem de TODOS os códigos, iguais ao menu.
UPDATE public.permissoes p
SET nome = v.nome,
    grupo = v.grupo,
    rota = v.rota,
    ordem = v.ordem
FROM (VALUES
  ('dashboard', 'Dashboard', 'Geral', '/', 10),
  ('atendimentos', 'Atendimentos', 'Pacientes', '/solicitar', 20),
  ('gestao', 'Gestão Recepção', 'Pacientes', '/central-pacientes', 30),
  ('autorizacoes_avulsas', 'Autorizações Avulsas', 'Pacientes', '/autorizacoes-avulsas', 40),
  ('acompanhamento_laudos', 'Status dos Laudos', 'Pacientes', '/acompanhamento/laudos', 50),
  ('outros_convenios', 'Outros Convênios', 'Pacientes', '/outros-convenios', 60),
  ('escala_terapeutica', 'Gestão', 'Terapêutico', '/central-terapeutas', 70),
  ('analise_tratativas', 'Análise de Evolução', 'Terapêutico', '/analise-tratativas', 80),
  ('terapeutico_auditoria_evolucoes', 'Auditoria de Evoluções', 'Terapêutico', '/terapeutico/auditoria-evolucoes', 90),
  ('terapeutico_pdi', 'PDI - Controle', 'Terapêutico', '/terapeutico/prazos-pdi', 100),
  ('terapeutico_pdi_painel', 'PDI - Painel', 'Terapêutico', '/terapeutico/pdi-painel-analista', 110),
  ('cco', 'Conciliação ASSIM', 'Autorização', '/cco', 120),
  ('auditoria_assim', 'Conferência ASSIM', 'Autorização', '/auditoria-assim?tab=auditoria', 130),
  ('reconciliacao_assim', 'Reconciliação ASSIM', 'Autorização', '/auditoria-assim?tab=reconciliacao', 140),
  ('conferencia_guias', 'Conferência de Guias', 'Autorização', '/conferencia-guias', 150),
  ('preauditoria', 'Pré-auditoria', 'Autorização', '/preauditoria', 160),
  ('insumos', 'Solicitações', 'Suprimentos', '/insumos', 170),
  ('cronograma_saida_profissional', 'Saída Profissional', 'Cronograma', '/cronograma/saida-profissional', 180),
  ('cronograma_ocupacao_paciente', 'Ocupação Paciente', 'Cronograma', '/cronograma/ocupacao-paciente', 190),
  ('reposicao_faltas', 'Reposição de Faltas', 'Cronograma', '/cronograma/reposicao', 200),
  ('ocupacao_clinica', 'Oportunidades recusadas', 'Cronograma', '/cronograma/ocupacao?tab=oportunidades-recusadas', 210),
  ('ocupacao_clinica_gaps', 'Diferença: Laudo e Oferta', 'Cronograma', '/cronograma/ocupacao?tab=gaps', 220),
  ('ocupacao_clinica_inconsistencias', 'Inconsistências e Exceções', 'Cronograma', '/cronograma/ocupacao?tab=inconsistencias', 230),
  ('ocupacao_profissionais', 'Ocupação de Profissionais', 'Indicadores', '/cronograma/indicadores?tab=profissionais', 240),
  ('indicadores_ocupacao_unidades', 'Ocupação Clínica', 'Indicadores', '/cronograma/indicadores?tab=unidades', 250),
  ('indicadores_pacientes', 'Dashboard de Pacientes', 'Indicadores', '/cronograma/indicadores?tab=pacientes', 260),
  ('indicadores_previsao_receitas', 'Previsão de Receitas', 'Indicadores', '/cronograma/indicadores?tab=previsao-receitas', 270),
  ('indicadores_alimentar_bd', 'Preencher Receitas Faturadas', 'Indicadores', '/cronograma/indicadores?tab=alimentar-bd', 280),
  ('indicadores_comparativo_sessoes', 'Comparativo de Sessões', 'Indicadores', '/cronograma/indicadores?tab=comparativo-sessoes', 290),
  ('cadastros_pacientes', 'Pacientes', 'Cadastros', '/cadastros/pacientes', 300),
  ('cadastros_convenios', 'Convênios', 'Cadastros', '/cadastros/convenios', 310),
  ('cronograma_valores_convenio', 'Cadastro de Valores', 'Cadastros', '/cadastros/cadastro-valores', 320),
  ('cadastros_feriados', 'Feriados', 'Cadastros', '/cadastros/feriados', 330),
  ('cadastros_taxas', 'Variáveis & Taxas', 'Cadastros', '/cadastros/taxas-e-parametros', 340),
  ('cadastros_contratos', 'Contratos', 'Cadastros', '/cadastros/contratos', 350),
  ('cronograma_ocupacao_salas', 'Ocupação de Salas', 'Relacionamento Prestador', '/relacionamento-prestador/ocupacao-salas', 360),
  ('cronograma_solicitacoes', 'Simulação de Novo Prestador', 'Relacionamento Prestador', '/relacionamento-prestador/solicitacoes', 370),
  ('cronograma_disponibilidade_interna', 'Ocupar Profissionais Disponíveis', 'Relacionamento Prestador', '/relacionamento-prestador/ocupar-profissionais-disponiveis', 380),
  ('relacionamento_prestador_analise', 'Rem. Mês - Previsão', 'Relacionamento Prestador', '/relacionamento-prestador/analise', 390),
  ('relacionamento_prestador_rp', 'Remuneração Total', 'Relacionamento Prestador', '/relacionamento-prestador/rp', 400),
  ('relacionamento_prestador_individual', 'Remuneração Individual', 'Relacionamento Prestador', '/relacionamento-prestador/individual', 410),
  ('relacionamento_prestador_pep', 'Entregas PEP', 'Relacionamento Prestador', '/relacionamento-prestador/pep', 420),
  ('relacionamento_prestador_pep_historico', 'PEP - Histórico', 'Relacionamento Prestador', '/relacionamento-prestador/pep-historico', 430),
  ('tv_avisos', 'TV da Recepção', 'Marketing', '/tv-avisos', 440),
  ('usuarios', 'Usuários', 'Administração', '/admin', 450),
  ('permissoes', 'Permissões', 'Administração', '/admin/permissoes', 460),
  ('api_integracao', 'API', 'Administração', '/admin/api', 470),
  ('connect', 'Pulsar Connect', 'Geral', '/connect', 480)
) AS v(codigo, nome, grupo, rota, ordem)
WHERE p.codigo = v.codigo;

-- 4. Códigos sem tela saem. O FK de usuarios_permissoes é ON DELETE CASCADE
--    (20260529110000), então as exceções individuais desses códigos saem junto;
--    o modelo dos grupos (jsonb) é limpo à parte para o alerta "fora do modelo"
--    não comparar código que não existe mais.
UPDATE public.grupos_permissoes
SET modelo_permissoes = modelo_permissoes - ARRAY['autorizacoes', 'indicadores_historico_receitas', 'cronograma_por_paciente', 'cronograma_por_profissional', 'cadastros_profissionais']::text[],
    updated_at = now()
WHERE modelo_permissoes ?| ARRAY['autorizacoes', 'indicadores_historico_receitas', 'cronograma_por_paciente', 'cronograma_por_profissional', 'cadastros_profissionais']::text[];

DELETE FROM public.permissoes
WHERE codigo IN ('autorizacoes', 'indicadores_historico_receitas', 'cronograma_por_paciente', 'cronograma_por_profissional', 'cadastros_profissionais');
