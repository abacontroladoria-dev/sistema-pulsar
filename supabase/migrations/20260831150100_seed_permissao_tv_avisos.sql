-- Permissão da tela Avisos da TV (/tv-avisos).
--
-- CÓDIGO PRÓPRIO porque quem opera esta tela é o MARKETING — um setor que não
-- tem nenhuma das permissões existentes e que não deve ganhar nenhuma outra
-- junto. Pendurar isto em `gestao` ou `cadastros_pacientes` daria ao marketing
-- acesso a dado de paciente para trocar um cartaz de parede.
--
-- Grupo 'Administração' (o mesmo de Usuários e Permissões, criado em
-- 20260529110000) porque não é cadastro operacional nem tela de atendimento: é
-- configuração de um painel. Fica junto do que se administra, não do que se
-- opera — e um grupo NOVO só para esta linha apareceria sozinho na
-- /admin/permissoes.
--
-- ⚠️ Os grupos de permissão são ADITIVOS e a união dos modelos só é
-- materializada no "Aplicar" de /admin/permissoes. Inserir o código aqui NÃO
-- concede acesso a ninguém: o admin entra pelo roleDefaults do frontend + o ramo
-- por papel das policies (20260831150000), e o marketing precisa receber o
-- código explicitamente em usuarios_permissoes.

INSERT INTO public.permissoes (codigo, nome, rota, grupo, descricao) VALUES
  ('tv_avisos', 'Avisos da TV', '/tv-avisos', 'Administração',
   'Imagens do carrossel de avisos exibido na TV da recepção enquanto ninguém está sendo chamado')
ON CONFLICT (codigo) DO NOTHING;
