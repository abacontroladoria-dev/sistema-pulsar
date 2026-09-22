-- Tags automáticas da Maia — seed dos 144 tags da taxonomia (13 grupos).
--
-- Gerado a partir de frontend/app/central-atendimento/maia-tags/maia_tags_catalog.json
-- (script: descartável, não versionado — leu o JSON célula a célula para não
-- reintroduzir erro de digitação). Fonte de verdade do conteúdo é o próprio
-- JSON; esta migration é a materialização dele no banco.
--
-- ON CONFLICT (organization_id, key) DO UPDATE, igual ao padrão do seed
-- existente (20260701010500) — inclusive para as chaves que colidem com ele:
-- 'particular' já existia (categoria "Financeiro", mesmo sentido de
-- pagamento.particular) e passa a ganhar os metadados de grupo aqui.
--
-- 'convenio', 'urgente' e 'alta_prioridade' do seed antigo NÃO têm
-- equivalente direto nesta taxonomia (convênio virou 53 tags por operadora;
-- urgência virou 3 estados de prontidão de decisão, não um flag de
-- prioridade) — são desativadas ao final desta migration, sem apagar
-- histórico. A migração dos dados de tags do ChatGuru é explicitamente fora
-- da configuração do sistema novo (aba Leia-me do documento fonte).
--
-- paciente_ativo/paciente_inativo: o documento original marca "quem aplica"
-- como Maia/humano. Este seed já grava automatico_sistema = true e
-- requer_humano = false para os dois, porque o Passo 5 do plano os calcula
-- via central.contact_patient_status (migration 20260922100300), não por
-- julgamento da Maia nem de um humano.

insert into central.tag_definitions (
  organization_id, key, label, color, category, is_active,
  grupo_key, grupo_ordem, cardinalidade,
  maia_pode_aplicar, automatico_sistema, requer_humano
) values
  ('a0000000-0000-0000-0000-000000000001', 'meta_ads', 'Meta Ads', '#6366f1', '1. ORIGEM', true, 'origem', 1, 'single', true, true, false),
  ('a0000000-0000-0000-0000-000000000001', 'google_ads', 'Google Ads', '#6366f1', '1. ORIGEM', true, 'origem', 1, 'single', true, true, false),
  ('a0000000-0000-0000-0000-000000000001', 'google', 'Google', '#6366f1', '1. ORIGEM', true, 'origem', 1, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'site', 'Site', '#6366f1', '1. ORIGEM', true, 'origem', 1, 'single', true, true, false),
  ('a0000000-0000-0000-0000-000000000001', 'linktree', 'Linktree', '#6366f1', '1. ORIGEM', true, 'origem', 1, 'single', true, true, false),
  ('a0000000-0000-0000-0000-000000000001', 'indicacao_medica', 'Indicação médica', '#6366f1', '1. ORIGEM', true, 'origem', 1, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'indicacao_escola', 'Indicação escola', '#6366f1', '1. ORIGEM', true, 'origem', 1, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'indicacao_amigo_familiar', 'Indicação amigo/familiar', '#6366f1', '1. ORIGEM', true, 'origem', 1, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'indicacao_advogado', 'Indicação advogado', '#6366f1', '1. ORIGEM', true, 'origem', 1, 'single', false, false, true),
  ('a0000000-0000-0000-0000-000000000001', 'indicacao_operadora', 'Indicação operadora', '#6366f1', '1. ORIGEM', true, 'origem', 1, 'single', false, false, true),
  ('a0000000-0000-0000-0000-000000000001', 'ligacao_recebida', 'Ligação recebida', '#6366f1', '1. ORIGEM', true, 'origem', 1, 'single', false, false, true),
  ('a0000000-0000-0000-0000-000000000001', 'presencial', 'Presencial', '#6366f1', '1. ORIGEM', true, 'origem', 1, 'single', false, false, true),
  ('a0000000-0000-0000-0000-000000000001', 'evento_parceria', 'Evento/parceria', '#6366f1', '1. ORIGEM', true, 'origem', 1, 'single', false, false, true),
  ('a0000000-0000-0000-0000-000000000001', 'contato_direto', 'Contato Direto', '#6366f1', '1. ORIGEM', true, 'origem', 1, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'lead', 'Lead', '#8b5cf6', '2. TIPO DE CONTATO', true, 'tipo_de_contato', 2, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'paciente_ativo', 'Paciente ativo', '#8b5cf6', '2. TIPO DE CONTATO', true, 'tipo_de_contato', 2, 'single', true, true, false),
  ('a0000000-0000-0000-0000-000000000001', 'paciente_inativo', 'Paciente inativo', '#8b5cf6', '2. TIPO DE CONTATO', true, 'tipo_de_contato', 2, 'single', false, true, false),
  ('a0000000-0000-0000-0000-000000000001', 'nao_paciente_curso', 'Não-paciente | Curso', '#8b5cf6', '2. TIPO DE CONTATO', true, 'tipo_de_contato', 2, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'nao_paciente_trabalhe_conosco', 'Não-paciente | Trabalhe conosco', '#8b5cf6', '2. TIPO DE CONTATO', true, 'tipo_de_contato', 2, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'nao_paciente_parceria', 'Não-paciente | Parceria', '#8b5cf6', '2. TIPO DE CONTATO', true, 'tipo_de_contato', 2, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'nao_paciente_operadora', 'Não-paciente | Operadora', '#8b5cf6', '2. TIPO DE CONTATO', true, 'tipo_de_contato', 2, 'single', false, false, true),
  ('a0000000-0000-0000-0000-000000000001', 'nao_paciente_advogado', 'Não-paciente | Advogado', '#8b5cf6', '2. TIPO DE CONTATO', true, 'tipo_de_contato', 2, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'nao_paciente_real_saude', 'Não-paciente | Real Saúde', '#8b5cf6', '2. TIPO DE CONTATO', true, 'tipo_de_contato', 2, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'avaliacao_inicial', 'Avaliação Inicial', '#0ea5e9', '3. SERVIÇO DE INTERESSE (pode ter mais de uma)', true, 'servico_de_interesse', 3, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'av_neuropsicologica_infantil', 'Av. Neuropsicológica Infantil', '#0ea5e9', '3. SERVIÇO DE INTERESSE (pode ter mais de uma)', true, 'servico_de_interesse', 3, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'av_neuropsicologica_adulto', 'Av. Neuropsicológica Adulto', '#0ea5e9', '3. SERVIÇO DE INTERESSE (pode ter mais de uma)', true, 'servico_de_interesse', 3, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'consulta_medica', 'Consulta médica', '#0ea5e9', '3. SERVIÇO DE INTERESSE (pode ter mais de uma)', true, 'servico_de_interesse', 3, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'terapia_aba', 'Terapia ABA', '#0ea5e9', '3. SERVIÇO DE INTERESSE (pode ter mais de uma)', true, 'servico_de_interesse', 3, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'fonoaudiologia', 'Fonoaudiologia', '#0ea5e9', '3. SERVIÇO DE INTERESSE (pode ter mais de uma)', true, 'servico_de_interesse', 3, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'psicologia', 'Psicologia', '#0ea5e9', '3. SERVIÇO DE INTERESSE (pode ter mais de uma)', true, 'servico_de_interesse', 3, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'terapia_ocupacional', 'Terapia Ocupacional', '#0ea5e9', '3. SERVIÇO DE INTERESSE (pode ter mais de uma)', true, 'servico_de_interesse', 3, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'psicopedagogia', 'Psicopedagogia', '#0ea5e9', '3. SERVIÇO DE INTERESSE (pode ter mais de uma)', true, 'servico_de_interesse', 3, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'psicomotricidade', 'Psicomotricidade', '#0ea5e9', '3. SERVIÇO DE INTERESSE (pode ter mais de uma)', true, 'servico_de_interesse', 3, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'musicoterapia', 'Musicoterapia', '#0ea5e9', '3. SERVIÇO DE INTERESSE (pode ter mais de uma)', true, 'servico_de_interesse', 3, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'arteterapia', 'Arteterapia', '#0ea5e9', '3. SERVIÇO DE INTERESSE (pode ter mais de uma)', true, 'servico_de_interesse', 3, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'equoterapia', 'Equoterapia', '#0ea5e9', '3. SERVIÇO DE INTERESSE (pode ter mais de uma)', true, 'servico_de_interesse', 3, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'fisioterapia_infantil', 'Fisioterapia infantil', '#0ea5e9', '3. SERVIÇO DE INTERESSE (pode ter mais de uma)', true, 'servico_de_interesse', 3, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'fisioterapia_aquatica', 'Fisioterapia aquática', '#0ea5e9', '3. SERVIÇO DE INTERESSE (pode ter mais de uma)', true, 'servico_de_interesse', 3, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'terapia_alimentar', 'Terapia alimentar', '#0ea5e9', '3. SERVIÇO DE INTERESSE (pode ter mais de uma)', true, 'servico_de_interesse', 3, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'consulta_nutricionista', 'Consulta nutricionista', '#0ea5e9', '3. SERVIÇO DE INTERESSE (pode ter mais de uma)', true, 'servico_de_interesse', 3, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'tecnico_terapeutico_particular_at', 'Técnico Terapêutico Particular (AT)', '#0ea5e9', '3. SERVIÇO DE INTERESSE (pode ter mais de uma)', true, 'servico_de_interesse', 3, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'nda', 'NDA', '#0ea5e9', '3. SERVIÇO DE INTERESSE (pode ter mais de uma)', true, 'servico_de_interesse', 3, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'programa_de_cuidado', 'Programa de Cuidado', '#0ea5e9', '3. SERVIÇO DE INTERESSE (pode ter mais de uma)', true, 'servico_de_interesse', 3, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'reabilitacao_cognitiva', 'Reabilitação cognitiva', '#0ea5e9', '3. SERVIÇO DE INTERESSE (pode ter mais de uma)', true, 'servico_de_interesse', 3, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'psicoeducacao', 'Psicoeducação', '#0ea5e9', '3. SERVIÇO DE INTERESSE (pode ter mais de uma)', true, 'servico_de_interesse', 3, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'rota_a_avaliacao_inicial', 'Rota A - Avaliação Inicial', '#64748b', '4. ROTA', true, 'rota', 4, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'rota_b_av_neuropsicologica', 'Rota B - Av. Neuropsicológica', '#64748b', '4. ROTA', true, 'rota', 4, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'rota_c_especialidades_terapeuticas', 'Rota C - Especialidades Terapêuticas', '#64748b', '4. ROTA', true, 'rota', 4, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'rota_d_liminar_assistida', 'Rota D - Liminar Assistida', '#64748b', '4. ROTA', true, 'rota', 4, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'rota_e_tratamento_aba', 'Rota E - Tratamento ABA', '#64748b', '4. ROTA', true, 'rota', 4, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'particular', 'Particular', '#22c55e', '5. PAGAMENTO', true, 'pagamento', 5, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'reembolso', 'Reembolso', '#22c55e', '5. PAGAMENTO', true, 'pagamento', 5, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'convenio_credenciado', 'Convênio Credenciado', '#22c55e', '5. PAGAMENTO', true, 'pagamento', 5, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'convenio_nao_credenciado', 'Convênio Não Credenciado', '#22c55e', '5. PAGAMENTO', true, 'pagamento', 5, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'gratuidade_acao_social', 'Gratuidade/Ação Social', '#22c55e', '5. PAGAMENTO', true, 'pagamento', 5, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'assim', 'ASSIM', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'leve_saude', 'Leve Saúde', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'fusex', 'FUSEX', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'seguros_unimed', 'Seguros Unimed', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'amil', 'Amil', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'bradesco', 'Bradesco', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'sulamerica', 'SulAmérica', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'unimed_ferj', 'Unimed FERJ', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'unimed_rio', 'Unimed Rio', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'unimed_nacional', 'Unimed Nacional', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'unimed_nova_iguacu', 'Unimed Nova Iguaçu', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'porto_seguro', 'Porto Seguro', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'appai', 'APPAI', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'memorial', 'Memorial', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'notredame_intermedica', 'Notredame / Intermédica', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'hapvida', 'Hapvida', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'klini', 'Klini', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'cassi', 'CASSI', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'caberj', 'CABERJ', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'saude_caixa', 'Saúde Caixa', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'postal_saude', 'Postal Saúde', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'petrobras', 'Petrobras', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'golden_cross', 'Golden Cross', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'mediservice', 'Mediservice', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'care_plus', 'Care Plus', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'omint', 'Omint', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'prevent_senior', 'Prevent Senior', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'geap', 'GEAP', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'ampla_gama', 'Ampla Gama', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'assist', 'Assist', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'unimed_cnu', 'Unimed CNU', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'unimed_bauru', 'Unimed Bauru', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'unimed_costa_do_sol', 'Unimed Costa do Sol', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'unimed_bh', 'Unimed BH', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'unimed_na07_especial', 'Unimed NA07 Especial', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'unimed_omega', 'Unimed Ômega', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'unimed_delta', 'Unimed Delta', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'unimed_intercambio', 'Unimed Intercâmbio', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'unimed_londrina', 'Unimed Londrina', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'unimed_personal', 'Unimed Personal', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'unimed_maceio', 'Unimed Maceió', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'unimed_beta_ii', 'Unimed Beta II', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'unimed_volta_redonda', 'Unimed Volta Redonda', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'oplan', 'Oplan', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'samoc', 'Samoc', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'porto_saude', 'Porto Saúde', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'health_med', 'Health Med', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'itau', 'Itaú', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'nova_saude', 'Nova Saúde', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'camim', 'CAMIM', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'blue', 'Blue', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'metlife', 'MetLife', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'real_grandeza', 'Real Grandeza', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'cemeru', 'CEMERU', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'odontoprev', 'OdontoPrev', '#16a34a', '6. CONVÊNIO (nome da operadora)', true, 'convenio', 6, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'aguardando_documentos', 'Aguardando documentos', '#3b82f6', '7. ETAPA CONVÊNIO (só Rota E)', true, 'etapa_convenio', 7, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'docs_enviados_a_autorizacao', 'Docs enviados à autorização', '#3b82f6', '7. ETAPA CONVÊNIO (só Rota E)', true, 'etapa_convenio', 7, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'elegibilidade_confirmada', 'Elegibilidade confirmada', '#3b82f6', '7. ETAPA CONVÊNIO (só Rota E)', true, 'etapa_convenio', 7, 'single', false, false, true),
  ('a0000000-0000-0000-0000-000000000001', 'nao_elegivel', 'Não elegível', '#3b82f6', '7. ETAPA CONVÊNIO (só Rota E)', true, 'etapa_convenio', 7, 'single', false, false, true),
  ('a0000000-0000-0000-0000-000000000001', 'entrevista_familiar_agendada', 'Entrevista familiar agendada', '#3b82f6', '7. ETAPA CONVÊNIO (só Rota E)', true, 'etapa_convenio', 7, 'single', false, false, true),
  ('a0000000-0000-0000-0000-000000000001', 'aguardando_contato_da_operadora', 'Aguardando contato da operadora', '#3b82f6', '7. ETAPA CONVÊNIO (só Rota E)', true, 'etapa_convenio', 7, 'single', false, false, true),
  ('a0000000-0000-0000-0000-000000000001', 'decisao_judicial_recebida', 'Decisão judicial recebida', '#3b82f6', '7. ETAPA CONVÊNIO (só Rota E)', true, 'etapa_convenio', 7, 'single', false, false, true),
  ('a0000000-0000-0000-0000-000000000001', 'acordo_adm_com_plano', 'Acordo ADM com plano', '#3b82f6', '7. ETAPA CONVÊNIO (só Rota E)', true, 'etapa_convenio', 7, 'single', false, false, true),
  ('a0000000-0000-0000-0000-000000000001', 'pre_liminar', 'Pré-liminar', '#78716c', '8. JURÍDICO (só Rota D, uso interno)', true, 'juridico', 8, 'single', false, false, true),
  ('a0000000-0000-0000-0000-000000000001', 'nip', 'NIP', '#78716c', '8. JURÍDICO (só Rota D, uso interno)', true, 'juridico', 8, 'single', false, false, true),
  ('a0000000-0000-0000-0000-000000000001', 'processo_judicial', 'Processo judicial', '#78716c', '8. JURÍDICO (só Rota D, uso interno)', true, 'juridico', 8, 'single', false, false, true),
  ('a0000000-0000-0000-0000-000000000001', 'liminar_concedida', 'Liminar concedida', '#78716c', '8. JURÍDICO (só Rota D, uso interno)', true, 'juridico', 8, 'single', false, false, true),
  ('a0000000-0000-0000-0000-000000000001', 'penhora', 'Penhora', '#78716c', '8. JURÍDICO (só Rota D, uso interno)', true, 'juridico', 8, 'single', false, false, true),
  ('a0000000-0000-0000-0000-000000000001', 'com_laudo', 'Com laudo', '#f59e0b', '9. LAUDO', true, 'laudo', 9, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'sem_laudo', 'Sem laudo', '#f59e0b', '9. LAUDO', true, 'laudo', 9, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'laudo_sem_carga_horaria', 'Laudo sem carga horária', '#f59e0b', '9. LAUDO', true, 'laudo', 9, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'laudo_vencido', 'Laudo vencido', '#f59e0b', '9. LAUDO', true, 'laudo', 9, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'com_encaminhamento', 'Com encaminhamento', '#f59e0b', '9. LAUDO', true, 'laudo', 9, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'sem_encaminhamento', 'Sem encaminhamento', '#f59e0b', '9. LAUDO', true, 'laudo', 9, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'tea', 'TEA', '#ef4444', '10. DIAGNÓSTICO INFORMADO (o que a família disse, não conclusão clínica)', true, 'diagnostico_informado', 10, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'tdah', 'TDAH', '#ef4444', '10. DIAGNÓSTICO INFORMADO (o que a família disse, não conclusão clínica)', true, 'diagnostico_informado', 10, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'tea_tdah', 'TEA + TDAH', '#ef4444', '10. DIAGNÓSTICO INFORMADO (o que a família disse, não conclusão clínica)', true, 'diagnostico_informado', 10, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'suspeita_de_tea', 'Suspeita de TEA', '#ef4444', '10. DIAGNÓSTICO INFORMADO (o que a família disse, não conclusão clínica)', true, 'diagnostico_informado', 10, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'outro_em_investigacao', 'Outro / em investigação', '#ef4444', '10. DIAGNÓSTICO INFORMADO (o que a família disse, não conclusão clínica)', true, 'diagnostico_informado', 10, 'multi', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'bebe', 'Bebê', '#a78bfa', '11. IDADE (faixa; a idade exata vem da data de nascimento no campo personalizado)', true, 'idade', 11, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'crianca', 'Criança', '#a78bfa', '11. IDADE (faixa; a idade exata vem da data de nascimento no campo personalizado)', true, 'idade', 11, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'adolescente', 'Adolescente', '#a78bfa', '11. IDADE (faixa; a idade exata vem da data de nascimento no campo personalizado)', true, 'idade', 11, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'adulto', 'Adulto', '#a78bfa', '11. IDADE (faixa; a idade exata vem da data de nascimento no campo personalizado)', true, 'idade', 11, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'unidade_realengo', 'Unidade Realengo', '#0891b2', '12. UNIDADE', true, 'unidade', 12, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'unidade_fazendinha', 'Unidade Fazendinha', '#0891b2', '12. UNIDADE', true, 'unidade', 12, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'unidade_padre_miguel', 'Unidade Padre Miguel', '#0891b2', '12. UNIDADE', true, 'unidade', 12, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'quer_comecar_logo', 'Quer começar logo', '#f43f5e', '13. URGÊNCIA', true, 'urgencia', 13, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'precisa_entender_melhor', 'Precisa entender melhor', '#f43f5e', '13. URGÊNCIA', true, 'urgencia', 13, 'single', true, false, false),
  ('a0000000-0000-0000-0000-000000000001', 'ainda_pesquisando', 'Ainda pesquisando', '#f43f5e', '13. URGÊNCIA', true, 'urgencia', 13, 'single', true, false, false)
on conflict (organization_id, key) do update
  set
    label              = excluded.label,
    color              = excluded.color,
    category           = excluded.category,
    is_active          = excluded.is_active,
    grupo_key          = excluded.grupo_key,
    grupo_ordem        = excluded.grupo_ordem,
    cardinalidade      = excluded.cardinalidade,
    maia_pode_aplicar  = excluded.maia_pode_aplicar,
    automatico_sistema = excluded.automatico_sistema,
    requer_humano      = excluded.requer_humano,
    updated_at         = now();

-- As três chaves do seed genérico (20260701010500) sem equivalente direto
-- nesta taxonomia: desativadas, não apagadas. 'particular' fica de fora
-- deste UPDATE porque já foi upsertada acima com os metadados de grupo.
update central.tag_definitions
set is_active = false, updated_at = now()
where organization_id = 'a0000000-0000-0000-0000-000000000001'
  and key in ('convenio', 'urgente', 'alta_prioridade')
  and grupo_key is null;
