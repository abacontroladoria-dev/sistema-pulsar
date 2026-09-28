-- Grupos de permissão e diretoria — Fase 5 do plano de 29/09/2026.
-- Rodar no SQL Editor DEPOIS da migration 20260929120000 e do snippet
-- 20260929_materializar_permissoes_APLICAR.sql. Idempotente.
--
-- 1. MODELOS DOS GRUPOS. Só recebem os códigos que o modelo nunca decidiu (os 5
--    novos e os criados depois do seed de 19/08, como PDI e Preencher Receitas).
--    Regra: entra liberado só se TODOS os membros do grupo já têm o acesso hoje
--    (no grupo de mesmo nome de um perfil, contam os membros desse perfil).
--    `reconciliacao_assim` copia o valor que o modelo tem em `auditoria_assim`.
--    Nada que o modelo já decidiu muda: `novo || modelo` deixa o modelo vencer.
--    Isso corrige o grupo Marketing, cujo modelo vazio faria o "Sincronizar"
--    tirar a TV da Recepção da Manoela.
--
-- 2. DIRETORIA (decisão do usuário, 29/09/2026). Admin (Sanderson, Caio) acessa
--    tudo pelo papel. A diretoria segue o modelo do grupo Diretoria, e as
--    desmarcações dele (connect, autorizacoes_avulsas) são intencionais.
--    Juliana passa a ter o nível técnico diretoria; Gabriel Salotto (que já tem)
--    entra no grupo Diretoria. Os dois continuam nos outros grupos.
--
-- 3. O modelo Diretoria é aplicado aos 4 membros SÓ SOMANDO: grava true onde o
--    modelo libera, nunca grava false. Ana Carolina mantém o Pulsar Connect,
--    que é exceção individual dela. Prévia medida em 28/09/2026:
--      Bernardo    + Conciliação ASSIM, Usuários, Permissões, Entregas PEP, PEP - Histórico
--      Ana Carolina + PEP - Histórico
--      Juliana     + PDI Controle, PDI Painel, Preencher Receitas Faturadas
--      Gabriel     + 23 telas (cronograma, cadastros, indicadores, Usuários, Permissões…)
--    PENDENTE com o usuário: retirar de Juliana e Gabriel as telas em
--    desenvolvimento que não fazem sentido para eles.

BEGIN;

-- RP: liberados = nenhum; o resto dos códigos novos entra desmarcado.
UPDATE public.grupos_permissoes
SET modelo_permissoes = '{"atendimentos":false,"gestao":false,"autorizacoes_avulsas":false,"acompanhamento_laudos":false,"outros_convenios":false,"terapeutico_auditoria_evolucoes":false,"terapeutico_pdi":false,"terapeutico_pdi_painel":false,"cco":false,"auditoria_assim":false,"reconciliacao_assim":false,"conferencia_guias":false,"preauditoria":false,"insumos":false,"cronograma_ocupacao_paciente":false,"reposicao_faltas":false,"ocupacao_clinica":false,"ocupacao_clinica_gaps":false,"ocupacao_clinica_inconsistencias":false,"indicadores_ocupacao_unidades":false,"indicadores_pacientes":false,"indicadores_previsao_receitas":false,"indicadores_alimentar_bd":false,"indicadores_comparativo_sessoes":false,"cadastros_pacientes":false,"cadastros_convenios":false,"cronograma_valores_convenio":false,"relacionamento_prestador_pep":false,"relacionamento_prestador_pep_historico":false,"tv_avisos":false,"usuarios":false,"permissoes":false,"api_integracao":false,"connect":false}'::jsonb || modelo_permissoes,
    updated_at = now()
WHERE nome = 'RP';

-- Diretoria: liberados = terapeutico_auditoria_evolucoes, terapeutico_pdi, terapeutico_pdi_painel, reconciliacao_assim, reposicao_faltas, indicadores_alimentar_bd, cadastros_convenios; o resto dos códigos novos entra desmarcado.
UPDATE public.grupos_permissoes
SET modelo_permissoes = '{"terapeutico_auditoria_evolucoes":true,"terapeutico_pdi":true,"terapeutico_pdi_painel":true,"reconciliacao_assim":true,"conferencia_guias":false,"reposicao_faltas":true,"indicadores_alimentar_bd":true,"cadastros_convenios":true,"tv_avisos":false,"api_integracao":false}'::jsonb || modelo_permissoes,
    updated_at = now()
WHERE nome = 'Diretoria';

-- Autorização: liberados = reconciliacao_assim; o resto dos códigos novos entra desmarcado.
UPDATE public.grupos_permissoes
SET modelo_permissoes = '{"terapeutico_auditoria_evolucoes":false,"reconciliacao_assim":true,"conferencia_guias":false,"reposicao_faltas":false,"indicadores_alimentar_bd":false,"cadastros_convenios":false,"api_integracao":false}'::jsonb || modelo_permissoes,
    updated_at = now()
WHERE nome = 'Autorização';

-- Cronograma: liberados = reconciliacao_assim; o resto dos códigos novos entra desmarcado.
UPDATE public.grupos_permissoes
SET modelo_permissoes = '{"terapeutico_auditoria_evolucoes":false,"reconciliacao_assim":true,"conferencia_guias":false,"reposicao_faltas":false,"indicadores_alimentar_bd":false,"cadastros_convenios":false,"api_integracao":false}'::jsonb || modelo_permissoes,
    updated_at = now()
WHERE nome = 'Cronograma';

-- Recepção: liberados = reconciliacao_assim; o resto dos códigos novos entra desmarcado.
UPDATE public.grupos_permissoes
SET modelo_permissoes = '{"terapeutico_auditoria_evolucoes":false,"terapeutico_pdi":false,"terapeutico_pdi_painel":false,"reconciliacao_assim":true,"conferencia_guias":false,"reposicao_faltas":false,"indicadores_alimentar_bd":false,"cadastros_convenios":false,"tv_avisos":false,"api_integracao":false}'::jsonb || modelo_permissoes,
    updated_at = now()
WHERE nome = 'Recepção';

-- Financeiro: liberados = terapeutico_auditoria_evolucoes, terapeutico_pdi, terapeutico_pdi_painel, reconciliacao_assim, reposicao_faltas, indicadores_alimentar_bd, cadastros_convenios; o resto dos códigos novos entra desmarcado.
UPDATE public.grupos_permissoes
SET modelo_permissoes = '{"terapeutico_auditoria_evolucoes":true,"terapeutico_pdi":true,"terapeutico_pdi_painel":true,"reconciliacao_assim":true,"conferencia_guias":false,"reposicao_faltas":true,"indicadores_alimentar_bd":true,"cadastros_convenios":true,"tv_avisos":false,"api_integracao":false}'::jsonb || modelo_permissoes,
    updated_at = now()
WHERE nome = 'Financeiro';

-- Faturamento: liberados = reconciliacao_assim, conferencia_guias; o resto dos códigos novos entra desmarcado.
UPDATE public.grupos_permissoes
SET modelo_permissoes = '{"terapeutico_auditoria_evolucoes":false,"reconciliacao_assim":true,"conferencia_guias":true,"reposicao_faltas":false,"indicadores_alimentar_bd":false,"cadastros_convenios":false,"api_integracao":false}'::jsonb || modelo_permissoes,
    updated_at = now()
WHERE nome = 'Faturamento';

-- Administrador: liberados = terapeutico_auditoria_evolucoes, terapeutico_pdi, terapeutico_pdi_painel, reconciliacao_assim, conferencia_guias, reposicao_faltas, indicadores_alimentar_bd, cadastros_convenios, tv_avisos, api_integracao; o resto dos códigos novos entra desmarcado.
UPDATE public.grupos_permissoes
SET modelo_permissoes = '{"terapeutico_auditoria_evolucoes":true,"terapeutico_pdi":true,"terapeutico_pdi_painel":true,"reconciliacao_assim":true,"conferencia_guias":true,"reposicao_faltas":true,"indicadores_alimentar_bd":true,"cadastros_convenios":true,"tv_avisos":true,"api_integracao":true}'::jsonb || modelo_permissoes,
    updated_at = now()
WHERE nome = 'Administrador';

-- Suprimentos: liberados = nenhum; o resto dos códigos novos entra desmarcado.
UPDATE public.grupos_permissoes
SET modelo_permissoes = '{"terapeutico_auditoria_evolucoes":false,"terapeutico_pdi":false,"terapeutico_pdi_painel":false,"reconciliacao_assim":false,"conferencia_guias":false,"reposicao_faltas":false,"indicadores_alimentar_bd":false,"cadastros_convenios":false,"tv_avisos":false,"api_integracao":false}'::jsonb || modelo_permissoes,
    updated_at = now()
WHERE nome = 'Suprimentos';

-- Apoio Operacional Terapêutico: liberados = nenhum; o resto dos códigos novos entra desmarcado.
UPDATE public.grupos_permissoes
SET modelo_permissoes = '{"terapeutico_auditoria_evolucoes":false,"terapeutico_pdi":false,"terapeutico_pdi_painel":false,"reconciliacao_assim":false,"conferencia_guias":false,"reposicao_faltas":false,"indicadores_alimentar_bd":false,"cadastros_convenios":false,"tv_avisos":false,"api_integracao":false}'::jsonb || modelo_permissoes,
    updated_at = now()
WHERE nome = 'Apoio Operacional Terapêutico';

-- Especialista Téc. ABA: liberados = terapeutico_auditoria_evolucoes; o resto dos códigos novos entra desmarcado.
UPDATE public.grupos_permissoes
SET modelo_permissoes = '{"terapeutico_auditoria_evolucoes":true,"reconciliacao_assim":false,"conferencia_guias":false,"reposicao_faltas":false,"indicadores_alimentar_bd":false,"cadastros_convenios":false,"api_integracao":false}'::jsonb || modelo_permissoes,
    updated_at = now()
WHERE nome = 'Especialista Téc. ABA';

-- Marketing: liberados = dashboard, tv_avisos; o resto dos códigos novos entra desmarcado.
UPDATE public.grupos_permissoes
SET modelo_permissoes = '{"dashboard":true,"atendimentos":false,"gestao":false,"autorizacoes_avulsas":false,"acompanhamento_laudos":false,"outros_convenios":false,"escala_terapeutica":false,"analise_tratativas":false,"terapeutico_auditoria_evolucoes":false,"terapeutico_pdi":false,"terapeutico_pdi_painel":false,"cco":false,"auditoria_assim":false,"reconciliacao_assim":false,"conferencia_guias":false,"preauditoria":false,"insumos":false,"cronograma_saida_profissional":false,"cronograma_ocupacao_paciente":false,"reposicao_faltas":false,"ocupacao_clinica":false,"ocupacao_clinica_gaps":false,"ocupacao_clinica_inconsistencias":false,"ocupacao_profissionais":false,"indicadores_ocupacao_unidades":false,"indicadores_pacientes":false,"indicadores_previsao_receitas":false,"indicadores_alimentar_bd":false,"indicadores_comparativo_sessoes":false,"cadastros_pacientes":false,"cadastros_convenios":false,"cronograma_valores_convenio":false,"cadastros_feriados":false,"cadastros_taxas":false,"cadastros_contratos":false,"cronograma_ocupacao_salas":false,"cronograma_solicitacoes":false,"cronograma_disponibilidade_interna":false,"relacionamento_prestador_analise":false,"relacionamento_prestador_rp":false,"relacionamento_prestador_individual":false,"relacionamento_prestador_pep":false,"relacionamento_prestador_pep_historico":false,"tv_avisos":true,"usuarios":false,"permissoes":false,"api_integracao":false,"connect":false}'::jsonb || modelo_permissoes,
    updated_at = now()
WHERE nome = 'Marketing';

-- Terapêutico: liberados = terapeutico_auditoria_evolucoes; o resto dos códigos novos entra desmarcado.
UPDATE public.grupos_permissoes
SET modelo_permissoes = '{"terapeutico_auditoria_evolucoes":true,"reconciliacao_assim":false,"conferencia_guias":false,"reposicao_faltas":false,"indicadores_alimentar_bd":false,"cadastros_convenios":false,"api_integracao":false}'::jsonb || modelo_permissoes,
    updated_at = now()
WHERE nome = 'Terapêutico';

-- 2. Juliana: nível técnico diretoria (a CHECK de usuarios.role aceita).
UPDATE public.usuarios
SET role = 'diretoria'
WHERE email = 'julianagmrsmatos@gmail.com'
  AND role <> 'diretoria';

-- Gabriel Salotto no grupo Diretoria.
INSERT INTO public.grupos_permissoes_membros (grupo_id, usuario_id)
SELECT g.id, u.id
FROM public.grupos_permissoes g, public.usuarios u
WHERE g.nome = 'Diretoria' AND u.email = 'financeiro@universoaba.com.br'
ON CONFLICT (grupo_id, usuario_id) DO NOTHING;

-- 3. Modelo Diretoria aplicado aos membros, só somando.
INSERT INTO public.usuarios_permissoes AS up (usuario_id, permissao_codigo, permitido)
SELECT m.usuario_id, e.key, true
FROM public.grupos_permissoes g
JOIN public.grupos_permissoes_membros m ON m.grupo_id = g.id
CROSS JOIN LATERAL jsonb_each(g.modelo_permissoes) AS e(key, value)
JOIN public.permissoes p ON p.codigo = e.key
WHERE g.nome = 'Diretoria' AND e.value = 'true'::jsonb
ON CONFLICT (usuario_id, permissao_codigo) DO UPDATE SET permitido = true
WHERE up.permitido IS DISTINCT FROM true;

COMMIT;

-- Conferência: membros da Diretoria sem algum código que o modelo libera.
-- Esperado: 0 linhas.
SELECT u.nome, e.key AS codigo
FROM public.grupos_permissoes g
JOIN public.grupos_permissoes_membros m ON m.grupo_id = g.id
JOIN public.usuarios u ON u.id = m.usuario_id
CROSS JOIN LATERAL jsonb_each(g.modelo_permissoes) AS e(key, value)
LEFT JOIN public.usuarios_permissoes up
       ON up.usuario_id = u.id AND up.permissao_codigo = e.key AND up.permitido
WHERE g.nome = 'Diretoria' AND e.value = 'true'::jsonb AND up.usuario_id IS NULL
ORDER BY u.nome, e.key;
