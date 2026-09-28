-- Torna explícito, em usuarios_permissoes, o acesso que hoje vem SÓ do perfil
-- (roleDefaults em frontend/lib/permissions/routes.ts). Fase 4 do plano de
-- 29/09/2026 (Permissões alinhadas ao Sidebar).
--
-- Rodar no SQL Editor do Supabase, DEPOIS da migration
-- 20260929120000_catalogo_permissoes_espelha_sidebar.sql (os códigos novos
-- precisam existir: FK de usuarios_permissoes → permissoes) e ANTES do deploy
-- do frontend desta branch. Idempotente: pode rodar de novo.
--
-- Por quê: a função do banco usuario_tem_permissao() lê SÓ usuarios_permissoes,
-- nunca o roleDefaults — quem tinha a tela pelo perfil, sem linha gravada, via o
-- item no menu e a tela falhava em silêncio (ex.: recepção sem exceções em
-- Status dos Laudos). E é o passo que permite, depois, o menu parar de ler o
-- perfil (Fase 7) sem ninguém perder nada.
--
-- NÃO muda o acesso de ninguém no frontend:
--   * só INSERE onde não há linha (ON CONFLICT DO NOTHING) — uma retirada
--     individual (permitido = false) continua valendo;
--   * admin fica de fora (acessa tudo pelo papel);
--   * disponibilidade_terapeuta não tem defaults.
--
-- Prévia medida em 28/09/2026: ~25 pessoas (Bernardo 40 telas, Jaciana e
-- Isabela 7, Larissa 6, Ana Carolina 6, os 12 terapeutas a Auditoria de
-- Evoluções). A consulta do fim confere o resultado (esperado: 0 linhas).

BEGIN;

-- Cópia de roleDefaults (sem admin), gerada de routes.ts em 29/09/2026.
CREATE TEMP TABLE IF NOT EXISTS _padrao_papel (role text, codigo text) ON COMMIT DROP;
TRUNCATE _padrao_papel;
INSERT INTO _padrao_papel (role, codigo) VALUES
    ('diretoria', 'dashboard'),
    ('diretoria', 'atendimentos'),
    ('diretoria', 'gestao'),
    ('diretoria', 'acompanhamento_laudos'),
    ('diretoria', 'escala_terapeutica'),
    ('diretoria', 'auditoria_assim'),
    ('diretoria', 'reconciliacao_assim'),
    ('diretoria', 'preauditoria'),
    ('diretoria', 'outros_convenios'),
    ('diretoria', 'cronograma_solicitacoes'),
    ('diretoria', 'cronograma_saida_profissional'),
    ('diretoria', 'cronograma_ocupacao_paciente'),
    ('diretoria', 'cronograma_disponibilidade_interna'),
    ('diretoria', 'ocupacao_clinica'),
    ('diretoria', 'ocupacao_clinica_gaps'),
    ('diretoria', 'ocupacao_clinica_inconsistencias'),
    ('diretoria', 'ocupacao_profissionais'),
    ('diretoria', 'indicadores_ocupacao_unidades'),
    ('diretoria', 'indicadores_pacientes'),
    ('diretoria', 'indicadores_previsao_receitas'),
    ('diretoria', 'indicadores_alimentar_bd'),
    ('diretoria', 'indicadores_comparativo_sessoes'),
    ('diretoria', 'reposicao_faltas'),
    ('diretoria', 'cronograma_ocupacao_salas'),
    ('diretoria', 'cronograma_valores_convenio'),
    ('diretoria', 'cadastros_feriados'),
    ('diretoria', 'cadastros_contratos'),
    ('diretoria', 'cadastros_taxas'),
    ('diretoria', 'cadastros_convenios'),
    ('diretoria', 'analise_tratativas'),
    ('diretoria', 'relacionamento_prestador_analise'),
    ('diretoria', 'relacionamento_prestador_rp'),
    ('diretoria', 'relacionamento_prestador_individual'),
    ('diretoria', 'cadastros_pacientes'),
    ('diretoria', 'insumos'),
    ('diretoria', 'terapeutico_pdi'),
    ('diretoria', 'terapeutico_pdi_painel'),
    ('diretoria', 'terapeutico_auditoria_evolucoes'),
    ('recepcao', 'dashboard'),
    ('recepcao', 'atendimentos'),
    ('recepcao', 'autorizacoes_avulsas'),
    ('recepcao', 'gestao'),
    ('recepcao', 'auditoria_assim'),
    ('recepcao', 'reconciliacao_assim'),
    ('recepcao', 'outros_convenios'),
    ('recepcao', 'acompanhamento_laudos'),
    ('autorizacao', 'dashboard'),
    ('autorizacao', 'auditoria_assim'),
    ('autorizacao', 'reconciliacao_assim'),
    ('autorizacao', 'preauditoria'),
    ('terapeutico', 'dashboard'),
    ('terapeutico', 'escala_terapeutica'),
    ('terapeutico', 'analise_tratativas'),
    ('terapeutico', 'terapeutico_auditoria_evolucoes'),
    ('faturamento', 'dashboard'),
    ('faturamento', 'insumos'),
    ('faturamento', 'conferencia_guias'),
    ('rp', 'dashboard'),
    ('rp', 'escala_terapeutica'),
    ('rp', 'cadastros_feriados'),
    ('rp', 'cadastros_contratos'),
    ('rp', 'cadastros_taxas'),
    ('rp', 'relacionamento_prestador_analise'),
    ('rp', 'relacionamento_prestador_rp'),
    ('rp', 'relacionamento_prestador_individual'),
    ('marketing', 'dashboard'),
    ('marketing', 'tv_avisos'),
    ('cronograma', 'dashboard'),
    ('cronograma', 'cronograma_solicitacoes'),
    ('cronograma', 'cronograma_saida_profissional'),
    ('cronograma', 'cronograma_ocupacao_paciente'),
    ('cronograma', 'cronograma_disponibilidade_interna'),
    ('cronograma', 'ocupacao_clinica'),
    ('cronograma', 'ocupacao_clinica_gaps'),
    ('cronograma', 'ocupacao_clinica_inconsistencias'),
    ('cronograma', 'cadastros_pacientes');

-- 1. Reconciliação ASSIM: cada pessoa recebe exatamente o que tem hoje na
--    Conferência ASSIM (as duas abas eram um código só). Vem antes do passo 2
--    para que uma Conferência RETIRADA individualmente não vire Reconciliação
--    liberada pelo perfil.
INSERT INTO public.usuarios_permissoes (usuario_id, permissao_codigo, permitido)
SELECT u.id,
       'reconciliacao_assim',
       COALESCE(up.permitido, pp.codigo IS NOT NULL)
FROM public.usuarios u
LEFT JOIN public.usuarios_permissoes up
       ON up.usuario_id = u.id AND up.permissao_codigo = 'auditoria_assim'
LEFT JOIN _padrao_papel pp
       ON pp.role = u.role AND pp.codigo = 'auditoria_assim'
WHERE u.role <> 'admin'
  AND (up.permitido IS NOT NULL OR pp.codigo IS NOT NULL)
ON CONFLICT (usuario_id, permissao_codigo) DO NOTHING;

-- 1b. API: até esta branch, o código `usuarios` (rota /admin) abria também
--     /admin/api por prefixo — o proxy agora decide pela rota mais específica.
--     Quem tem Usuários liberado e nenhuma linha de API mantém a API (medido em
--     28/09/2026: Juliana e Ana Carolina).
INSERT INTO public.usuarios_permissoes (usuario_id, permissao_codigo, permitido)
SELECT up.usuario_id, 'api_integracao', true
FROM public.usuarios_permissoes up
JOIN public.usuarios u ON u.id = up.usuario_id
WHERE up.permissao_codigo = 'usuarios' AND up.permitido AND u.role <> 'admin'
ON CONFLICT (usuario_id, permissao_codigo) DO NOTHING;

-- 2. Tudo o que o perfil libera e ainda não tem linha.
INSERT INTO public.usuarios_permissoes (usuario_id, permissao_codigo, permitido)
SELECT u.id, pp.codigo, true
FROM public.usuarios u
JOIN _padrao_papel pp ON pp.role = u.role
JOIN public.permissoes p ON p.codigo = pp.codigo
WHERE u.role <> 'admin'
ON CONFLICT (usuario_id, permissao_codigo) DO NOTHING;

COMMIT;

-- Conferência: ninguém (fora admin) pode ter código do perfil sem linha gravada.
-- Esperado: 0 linhas.
SELECT u.nome, u.role, pp.codigo
FROM public.usuarios u
JOIN (VALUES
    ('diretoria', 'dashboard'),
    ('diretoria', 'atendimentos'),
    ('diretoria', 'gestao'),
    ('diretoria', 'acompanhamento_laudos'),
    ('diretoria', 'escala_terapeutica'),
    ('diretoria', 'auditoria_assim'),
    ('diretoria', 'reconciliacao_assim'),
    ('diretoria', 'preauditoria'),
    ('diretoria', 'outros_convenios'),
    ('diretoria', 'cronograma_solicitacoes'),
    ('diretoria', 'cronograma_saida_profissional'),
    ('diretoria', 'cronograma_ocupacao_paciente'),
    ('diretoria', 'cronograma_disponibilidade_interna'),
    ('diretoria', 'ocupacao_clinica'),
    ('diretoria', 'ocupacao_clinica_gaps'),
    ('diretoria', 'ocupacao_clinica_inconsistencias'),
    ('diretoria', 'ocupacao_profissionais'),
    ('diretoria', 'indicadores_ocupacao_unidades'),
    ('diretoria', 'indicadores_pacientes'),
    ('diretoria', 'indicadores_previsao_receitas'),
    ('diretoria', 'indicadores_alimentar_bd'),
    ('diretoria', 'indicadores_comparativo_sessoes'),
    ('diretoria', 'reposicao_faltas'),
    ('diretoria', 'cronograma_ocupacao_salas'),
    ('diretoria', 'cronograma_valores_convenio'),
    ('diretoria', 'cadastros_feriados'),
    ('diretoria', 'cadastros_contratos'),
    ('diretoria', 'cadastros_taxas'),
    ('diretoria', 'cadastros_convenios'),
    ('diretoria', 'analise_tratativas'),
    ('diretoria', 'relacionamento_prestador_analise'),
    ('diretoria', 'relacionamento_prestador_rp'),
    ('diretoria', 'relacionamento_prestador_individual'),
    ('diretoria', 'cadastros_pacientes'),
    ('diretoria', 'insumos'),
    ('diretoria', 'terapeutico_pdi'),
    ('diretoria', 'terapeutico_pdi_painel'),
    ('diretoria', 'terapeutico_auditoria_evolucoes'),
    ('recepcao', 'dashboard'),
    ('recepcao', 'atendimentos'),
    ('recepcao', 'autorizacoes_avulsas'),
    ('recepcao', 'gestao'),
    ('recepcao', 'auditoria_assim'),
    ('recepcao', 'reconciliacao_assim'),
    ('recepcao', 'outros_convenios'),
    ('recepcao', 'acompanhamento_laudos'),
    ('autorizacao', 'dashboard'),
    ('autorizacao', 'auditoria_assim'),
    ('autorizacao', 'reconciliacao_assim'),
    ('autorizacao', 'preauditoria'),
    ('terapeutico', 'dashboard'),
    ('terapeutico', 'escala_terapeutica'),
    ('terapeutico', 'analise_tratativas'),
    ('terapeutico', 'terapeutico_auditoria_evolucoes'),
    ('faturamento', 'dashboard'),
    ('faturamento', 'insumos'),
    ('faturamento', 'conferencia_guias'),
    ('rp', 'dashboard'),
    ('rp', 'escala_terapeutica'),
    ('rp', 'cadastros_feriados'),
    ('rp', 'cadastros_contratos'),
    ('rp', 'cadastros_taxas'),
    ('rp', 'relacionamento_prestador_analise'),
    ('rp', 'relacionamento_prestador_rp'),
    ('rp', 'relacionamento_prestador_individual'),
    ('marketing', 'dashboard'),
    ('marketing', 'tv_avisos'),
    ('cronograma', 'dashboard'),
    ('cronograma', 'cronograma_solicitacoes'),
    ('cronograma', 'cronograma_saida_profissional'),
    ('cronograma', 'cronograma_ocupacao_paciente'),
    ('cronograma', 'cronograma_disponibilidade_interna'),
    ('cronograma', 'ocupacao_clinica'),
    ('cronograma', 'ocupacao_clinica_gaps'),
    ('cronograma', 'ocupacao_clinica_inconsistencias'),
    ('cronograma', 'cadastros_pacientes')
) AS pp(role, codigo) ON pp.role = u.role
LEFT JOIN public.usuarios_permissoes up
       ON up.usuario_id = u.id AND up.permissao_codigo = pp.codigo
WHERE u.role <> 'admin' AND up.usuario_id IS NULL
ORDER BY u.nome, pp.codigo;
