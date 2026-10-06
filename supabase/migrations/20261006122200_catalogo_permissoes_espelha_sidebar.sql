-- Catálogo de permissões alinhado ao menu — GERADO por
-- frontend/scripts/gerar-catalogo-permissoes.mjs a partir de lib/permissions/menu.ts.
-- Não edite à mão: mude o menu e gere de novo.
--
-- Idempotente. Não muda o acesso de ninguém: só cadastra códigos novos e acerta
-- nome, grupo, rota e ordem. Um código NOVO nasce sem estar em grupo nenhum —
-- depois de aplicar, marque-o no modelo dos grupos que devem ter a tela
-- (/admin/permissoes → Por grupo).

-- 1. Códigos novos (os que já existem ficam como estão).
INSERT INTO public.permissoes (codigo, nome, grupo, rota, ordem)
SELECT v.codigo, v.nome, v.grupo, v.rota, v.ordem
FROM (VALUES
  ('dashboard', 'Dashboard', 'Geral', '/', 10),
  ('atendimentos', 'Atendimentos', 'Pacientes', '/solicitar', 20),
  ('gestao', 'Gestão Recepção', 'Pacientes', '/central-pacientes', 30),
  ('autorizacoes_avulsas', 'Autorizações Avulsas', 'Pacientes', '/autorizacoes-avulsas', 40),
  ('acompanhamento_laudos', 'Status Laudos e Senhas', 'Pacientes', '/acompanhamento/laudos', 50),
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
  ('cadastros_profissionais', 'Profissionais', 'Cadastros', '/cadastros/profissionais', 310),
  ('cadastros_terapias', 'Terapias', 'Cadastros', '/cadastros/terapias', 320),
  ('cadastros_convenios', 'Convênios', 'Cadastros', '/cadastros/convenios', 330),
  ('cronograma_valores_convenio', 'Cadastro de Valores', 'Cadastros', '/cadastros/cadastro-valores', 340),
  ('cadastros_feriados', 'Feriados', 'Cadastros', '/cadastros/feriados', 350),
  ('cadastros_taxas', 'Variáveis & Taxas', 'Cadastros', '/cadastros/taxas-e-parametros', 360),
  ('cadastros_contratos', 'Contratos', 'Cadastros', '/cadastros/contratos', 370),
  ('cronograma_ocupacao_salas', 'Ocupação de Salas', 'Relacionamento Prestador', '/relacionamento-prestador/ocupacao-salas', 380),
  ('cronograma_solicitacoes', 'Simulação de Novo Prestador', 'Relacionamento Prestador', '/relacionamento-prestador/solicitacoes', 390),
  ('cronograma_disponibilidade_interna', 'Ocupar Profissionais Disponíveis', 'Relacionamento Prestador', '/relacionamento-prestador/ocupar-profissionais-disponiveis', 400),
  ('relacionamento_prestador_analise', 'Rem. Mês - Previsão', 'Relacionamento Prestador', '/relacionamento-prestador/analise', 410),
  ('relacionamento_prestador_rp', 'Remuneração Total', 'Relacionamento Prestador', '/relacionamento-prestador/rp', 420),
  ('relacionamento_prestador_individual', 'Remuneração Individual', 'Relacionamento Prestador', '/relacionamento-prestador/individual', 430),
  ('relacionamento_prestador_pep', 'Entregas PEP', 'Relacionamento Prestador', '/relacionamento-prestador/pep', 440),
  ('relacionamento_prestador_pep_historico', 'PEP - Histórico', 'Relacionamento Prestador', '/relacionamento-prestador/pep-historico', 450),
  ('tv_avisos', 'TV da Recepção', 'Marketing', '/tv-avisos', 460),
  ('usuarios', 'Usuários', 'Administração', '/admin', 470),
  ('permissoes', 'Permissões', 'Administração', '/admin/permissoes', 480),
  ('api_integracao', 'API', 'Administração', '/admin/api', 490),
  ('robo_sharepoint', 'Robô SharePoint', 'Administração', '/admin/robo-sharepoint', 500),
  ('connect', 'Pulsar Connect', 'Geral', '/connect', 510)
) AS v(codigo, nome, grupo, rota, ordem)
ON CONFLICT (codigo) DO NOTHING;

-- 2. Nome, grupo, rota e ordem iguais ao menu.
UPDATE public.permissoes p
SET nome = v.nome, grupo = v.grupo, rota = v.rota, ordem = v.ordem
FROM (VALUES
  ('dashboard', 'Dashboard', 'Geral', '/', 10),
  ('atendimentos', 'Atendimentos', 'Pacientes', '/solicitar', 20),
  ('gestao', 'Gestão Recepção', 'Pacientes', '/central-pacientes', 30),
  ('autorizacoes_avulsas', 'Autorizações Avulsas', 'Pacientes', '/autorizacoes-avulsas', 40),
  ('acompanhamento_laudos', 'Status Laudos e Senhas', 'Pacientes', '/acompanhamento/laudos', 50),
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
  ('cadastros_profissionais', 'Profissionais', 'Cadastros', '/cadastros/profissionais', 310),
  ('cadastros_terapias', 'Terapias', 'Cadastros', '/cadastros/terapias', 320),
  ('cadastros_convenios', 'Convênios', 'Cadastros', '/cadastros/convenios', 330),
  ('cronograma_valores_convenio', 'Cadastro de Valores', 'Cadastros', '/cadastros/cadastro-valores', 340),
  ('cadastros_feriados', 'Feriados', 'Cadastros', '/cadastros/feriados', 350),
  ('cadastros_taxas', 'Variáveis & Taxas', 'Cadastros', '/cadastros/taxas-e-parametros', 360),
  ('cadastros_contratos', 'Contratos', 'Cadastros', '/cadastros/contratos', 370),
  ('cronograma_ocupacao_salas', 'Ocupação de Salas', 'Relacionamento Prestador', '/relacionamento-prestador/ocupacao-salas', 380),
  ('cronograma_solicitacoes', 'Simulação de Novo Prestador', 'Relacionamento Prestador', '/relacionamento-prestador/solicitacoes', 390),
  ('cronograma_disponibilidade_interna', 'Ocupar Profissionais Disponíveis', 'Relacionamento Prestador', '/relacionamento-prestador/ocupar-profissionais-disponiveis', 400),
  ('relacionamento_prestador_analise', 'Rem. Mês - Previsão', 'Relacionamento Prestador', '/relacionamento-prestador/analise', 410),
  ('relacionamento_prestador_rp', 'Remuneração Total', 'Relacionamento Prestador', '/relacionamento-prestador/rp', 420),
  ('relacionamento_prestador_individual', 'Remuneração Individual', 'Relacionamento Prestador', '/relacionamento-prestador/individual', 430),
  ('relacionamento_prestador_pep', 'Entregas PEP', 'Relacionamento Prestador', '/relacionamento-prestador/pep', 440),
  ('relacionamento_prestador_pep_historico', 'PEP - Histórico', 'Relacionamento Prestador', '/relacionamento-prestador/pep-historico', 450),
  ('tv_avisos', 'TV da Recepção', 'Marketing', '/tv-avisos', 460),
  ('usuarios', 'Usuários', 'Administração', '/admin', 470),
  ('permissoes', 'Permissões', 'Administração', '/admin/permissoes', 480),
  ('api_integracao', 'API', 'Administração', '/admin/api', 490),
  ('robo_sharepoint', 'Robô SharePoint', 'Administração', '/admin/robo-sharepoint', 500),
  ('connect', 'Pulsar Connect', 'Geral', '/connect', 510)
) AS v(codigo, nome, grupo, rota, ordem)
WHERE p.codigo = v.codigo;
