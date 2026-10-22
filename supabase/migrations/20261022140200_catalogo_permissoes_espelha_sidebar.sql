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
  ('status_contratos', 'Status Contratos', 'Pacientes', '/acompanhamento/contratos', 60),
  ('outros_convenios', 'Outros Convênios', 'Pacientes', '/outros-convenios', 70),
  ('escala_terapeutica', 'Gestão', 'Terapêutico', '/central-terapeutas', 80),
  ('analise_tratativas', 'Análise de Evolução', 'Terapêutico', '/analise-tratativas', 90),
  ('terapeutico_auditoria_evolucoes', 'Auditoria de Evoluções', 'Terapêutico', '/terapeutico/auditoria-evolucoes', 100),
  ('terapeutico_pdi', 'PDI - Controle', 'Terapêutico', '/terapeutico/prazos-pdi', 110),
  ('terapeutico_pdi_painel', 'PDI - Painel', 'Terapêutico', '/terapeutico/pdi-painel-analista', 120),
  ('cronograma_ocupacao_salas', 'Ocupação de Salas', 'Terapêutico', '/relacionamento-prestador/ocupacao-salas', 130),
  ('auditoria_assim', 'Conferência ASSIM', 'Autorização', '/auditoria-assim?tab=auditoria', 140),
  ('reconciliacao_assim', 'Reconciliação ASSIM', 'Autorização', '/auditoria-assim?tab=reconciliacao', 150),
  ('conferencia_guias', 'Conferência de Guias', 'Autorização', '/conferencia-guias', 160),
  ('exportar_evolucoes', 'Exportar Evoluções', 'Autorização', '/exportar-evolucoes', 170),
  ('insumos', 'Solicitações', 'Suprimentos', '/insumos', 180),
  ('cronograma_grade', 'Grade', 'Cronograma', '/cronograma/grade', 190),
  ('cronograma_saida_profissional', 'Saída Profissional', 'Cronograma', '/cronograma/saida-profissional', 200),
  ('cronograma_ocupacao_paciente', 'Ocupação Paciente', 'Cronograma', '/cronograma/ocupacao-paciente', 210),
  ('reposicao_faltas', 'Reposição de Faltas', 'Cronograma', '/cronograma/reposicao', 220),
  ('ocupacao_clinica', 'Oportunidades recusadas', 'Cronograma', '/cronograma/ocupacao?tab=oportunidades-recusadas', 230),
  ('ocupacao_clinica_gaps', 'Diferença: Laudo e Oferta', 'Cronograma', '/cronograma/ocupacao?tab=gaps', 240),
  ('ocupacao_clinica_inconsistencias', 'Inconsistências e Exceções', 'Cronograma', '/cronograma/ocupacao?tab=inconsistencias', 250),
  ('ocupacao_profissionais', 'Ocupação de Profissionais', 'Indicadores', '/cronograma/indicadores?tab=profissionais', 260),
  ('indicadores_ocupacao_unidades', 'Ocupação Clínica', 'Indicadores', '/cronograma/indicadores?tab=unidades', 270),
  ('indicadores_pacientes', 'Dashboard de Pacientes', 'Indicadores', '/cronograma/indicadores?tab=pacientes', 280),
  ('indicadores_previsao_receitas', 'Previsão de Receitas', 'Indicadores', '/cronograma/indicadores?tab=previsao-receitas', 290),
  ('indicadores_comparativo_sessoes', 'Comparativo de Sessões', 'Indicadores', '/cronograma/indicadores?tab=comparativo-sessoes', 300),
  ('indicadores_entrada_convenio', 'Entrada de Pacientes (Convênio)', 'Indicadores', '/cronograma/indicadores?tab=entrada-convenio', 310),
  ('cronograma_solicitacoes', 'Simulação de Novo Prestador', 'Relacionamento Prestador', '/relacionamento-prestador/solicitacoes', 320),
  ('cronograma_disponibilidade_interna', 'Ocupar Profissionais Disponíveis', 'Relacionamento Prestador', '/relacionamento-prestador/ocupar-profissionais-disponiveis', 330),
  ('relacionamento_prestador_analise', 'Rem. Mês - Previsão', 'Relacionamento Prestador', '/relacionamento-prestador/analise', 340),
  ('relacionamento_prestador_rp', 'Remuneração Total', 'Relacionamento Prestador', '/relacionamento-prestador/rp', 350),
  ('relacionamento_prestador_individual', 'Remuneração Individual', 'Relacionamento Prestador', '/relacionamento-prestador/individual', 360),
  ('relacionamento_prestador_pep', 'Entregas PEP', 'Relacionamento Prestador', '/relacionamento-prestador/pep', 370),
  ('relacionamento_prestador_pep_historico', 'PEP - Histórico', 'Relacionamento Prestador', '/relacionamento-prestador/pep-historico', 380),
  ('relacionamento_prestador_auditoria_documentos', 'Auditoria de Documentos PEP', 'Relacionamento Prestador', '/relacionamento-prestador/auditoria-documentos', 390),
  ('tv_avisos', 'TV da Recepção', 'Marketing', '/tv-avisos', 400),
  ('cadastros_pacientes', 'Pacientes', 'Cadastros', '/cadastros/pacientes', 410),
  ('cadastros_profissionais', 'Profissionais', 'Cadastros', '/cadastros/profissionais', 420),
  ('cadastros_terapias', 'Terapias', 'Cadastros', '/cadastros/terapias', 430),
  ('cadastros_convenios', 'Convênios', 'Cadastros', '/cadastros/convenios', 440),
  ('cronograma_valores_convenio', 'Cadastro de Valores', 'Cadastros', '/cadastros/cadastro-valores', 450),
  ('cadastros_feriados', 'Feriados', 'Cadastros', '/cadastros/feriados', 460),
  ('cadastros_taxas', 'Variáveis & Taxas', 'Cadastros', '/cadastros/taxas-e-parametros', 470),
  ('cadastros_contratos', 'Contratos', 'Cadastros', '/cadastros/contratos', 480),
  ('usuarios', 'Usuários', 'Configurações', '/admin', 490),
  ('permissoes', 'Permissões', 'Configurações', '/admin/permissoes', 500),
  ('api_integracao', 'API', 'Configurações', '/admin/api', 510),
  ('robo_sharepoint', 'Robô SharePoint', 'Configurações', '/admin/robo-sharepoint', 520),
  ('carregar_tita', 'Carregar do TiTa', 'Configurações', '/admin/carregar-tita', 530),
  ('connect', 'Pulsar Connect', 'Geral', '/connect', 540)
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
  ('status_contratos', 'Status Contratos', 'Pacientes', '/acompanhamento/contratos', 60),
  ('outros_convenios', 'Outros Convênios', 'Pacientes', '/outros-convenios', 70),
  ('escala_terapeutica', 'Gestão', 'Terapêutico', '/central-terapeutas', 80),
  ('analise_tratativas', 'Análise de Evolução', 'Terapêutico', '/analise-tratativas', 90),
  ('terapeutico_auditoria_evolucoes', 'Auditoria de Evoluções', 'Terapêutico', '/terapeutico/auditoria-evolucoes', 100),
  ('terapeutico_pdi', 'PDI - Controle', 'Terapêutico', '/terapeutico/prazos-pdi', 110),
  ('terapeutico_pdi_painel', 'PDI - Painel', 'Terapêutico', '/terapeutico/pdi-painel-analista', 120),
  ('cronograma_ocupacao_salas', 'Ocupação de Salas', 'Terapêutico', '/relacionamento-prestador/ocupacao-salas', 130),
  ('auditoria_assim', 'Conferência ASSIM', 'Autorização', '/auditoria-assim?tab=auditoria', 140),
  ('reconciliacao_assim', 'Reconciliação ASSIM', 'Autorização', '/auditoria-assim?tab=reconciliacao', 150),
  ('conferencia_guias', 'Conferência de Guias', 'Autorização', '/conferencia-guias', 160),
  ('exportar_evolucoes', 'Exportar Evoluções', 'Autorização', '/exportar-evolucoes', 170),
  ('insumos', 'Solicitações', 'Suprimentos', '/insumos', 180),
  ('cronograma_grade', 'Grade', 'Cronograma', '/cronograma/grade', 190),
  ('cronograma_saida_profissional', 'Saída Profissional', 'Cronograma', '/cronograma/saida-profissional', 200),
  ('cronograma_ocupacao_paciente', 'Ocupação Paciente', 'Cronograma', '/cronograma/ocupacao-paciente', 210),
  ('reposicao_faltas', 'Reposição de Faltas', 'Cronograma', '/cronograma/reposicao', 220),
  ('ocupacao_clinica', 'Oportunidades recusadas', 'Cronograma', '/cronograma/ocupacao?tab=oportunidades-recusadas', 230),
  ('ocupacao_clinica_gaps', 'Diferença: Laudo e Oferta', 'Cronograma', '/cronograma/ocupacao?tab=gaps', 240),
  ('ocupacao_clinica_inconsistencias', 'Inconsistências e Exceções', 'Cronograma', '/cronograma/ocupacao?tab=inconsistencias', 250),
  ('ocupacao_profissionais', 'Ocupação de Profissionais', 'Indicadores', '/cronograma/indicadores?tab=profissionais', 260),
  ('indicadores_ocupacao_unidades', 'Ocupação Clínica', 'Indicadores', '/cronograma/indicadores?tab=unidades', 270),
  ('indicadores_pacientes', 'Dashboard de Pacientes', 'Indicadores', '/cronograma/indicadores?tab=pacientes', 280),
  ('indicadores_previsao_receitas', 'Previsão de Receitas', 'Indicadores', '/cronograma/indicadores?tab=previsao-receitas', 290),
  ('indicadores_comparativo_sessoes', 'Comparativo de Sessões', 'Indicadores', '/cronograma/indicadores?tab=comparativo-sessoes', 300),
  ('indicadores_entrada_convenio', 'Entrada de Pacientes (Convênio)', 'Indicadores', '/cronograma/indicadores?tab=entrada-convenio', 310),
  ('cronograma_solicitacoes', 'Simulação de Novo Prestador', 'Relacionamento Prestador', '/relacionamento-prestador/solicitacoes', 320),
  ('cronograma_disponibilidade_interna', 'Ocupar Profissionais Disponíveis', 'Relacionamento Prestador', '/relacionamento-prestador/ocupar-profissionais-disponiveis', 330),
  ('relacionamento_prestador_analise', 'Rem. Mês - Previsão', 'Relacionamento Prestador', '/relacionamento-prestador/analise', 340),
  ('relacionamento_prestador_rp', 'Remuneração Total', 'Relacionamento Prestador', '/relacionamento-prestador/rp', 350),
  ('relacionamento_prestador_individual', 'Remuneração Individual', 'Relacionamento Prestador', '/relacionamento-prestador/individual', 360),
  ('relacionamento_prestador_pep', 'Entregas PEP', 'Relacionamento Prestador', '/relacionamento-prestador/pep', 370),
  ('relacionamento_prestador_pep_historico', 'PEP - Histórico', 'Relacionamento Prestador', '/relacionamento-prestador/pep-historico', 380),
  ('relacionamento_prestador_auditoria_documentos', 'Auditoria de Documentos PEP', 'Relacionamento Prestador', '/relacionamento-prestador/auditoria-documentos', 390),
  ('tv_avisos', 'TV da Recepção', 'Marketing', '/tv-avisos', 400),
  ('cadastros_pacientes', 'Pacientes', 'Cadastros', '/cadastros/pacientes', 410),
  ('cadastros_profissionais', 'Profissionais', 'Cadastros', '/cadastros/profissionais', 420),
  ('cadastros_terapias', 'Terapias', 'Cadastros', '/cadastros/terapias', 430),
  ('cadastros_convenios', 'Convênios', 'Cadastros', '/cadastros/convenios', 440),
  ('cronograma_valores_convenio', 'Cadastro de Valores', 'Cadastros', '/cadastros/cadastro-valores', 450),
  ('cadastros_feriados', 'Feriados', 'Cadastros', '/cadastros/feriados', 460),
  ('cadastros_taxas', 'Variáveis & Taxas', 'Cadastros', '/cadastros/taxas-e-parametros', 470),
  ('cadastros_contratos', 'Contratos', 'Cadastros', '/cadastros/contratos', 480),
  ('usuarios', 'Usuários', 'Configurações', '/admin', 490),
  ('permissoes', 'Permissões', 'Configurações', '/admin/permissoes', 500),
  ('api_integracao', 'API', 'Configurações', '/admin/api', 510),
  ('robo_sharepoint', 'Robô SharePoint', 'Configurações', '/admin/robo-sharepoint', 520),
  ('carregar_tita', 'Carregar do TiTa', 'Configurações', '/admin/carregar-tita', 530),
  ('connect', 'Pulsar Connect', 'Geral', '/connect', 540)
) AS v(codigo, nome, grupo, rota, ordem)
WHERE p.codigo = v.codigo;

-- 3. Códigos no banco que não têm mais item no menu. COMENTADO de propósito:
--    apagar um código apaga junto as concessões dele (FK ON DELETE CASCADE em
--    usuarios_permissoes). Confira que a tela saiu de verdade antes de descomentar.
-- UPDATE public.grupos_permissoes
-- SET modelo_permissoes = modelo_permissoes - ARRAY['cco', 'preauditoria', 'indicadores_alimentar_bd']::text[],
--     updated_at = now()
-- WHERE modelo_permissoes ?| ARRAY['cco', 'preauditoria', 'indicadores_alimentar_bd']::text[];
-- DELETE FROM public.permissoes WHERE codigo IN ('cco', 'preauditoria', 'indicadores_alimentar_bd');
