-- Permissão da tela Avisos da TV (/tv-avisos).
--
-- CÓDIGO PRÓPRIO porque quem opera esta tela é o MARKETING — um setor que não
-- tem nenhuma das permissões existentes e que não deve ganhar nenhuma outra
-- junto. Pendurar isto em `gestao` ou `cadastros_pacientes` daria ao marketing
-- acesso a dado de paciente para trocar um cartaz de parede.
--
-- Grupo 'Marketing', que é o setor dono da tela. Esta linha nasceu em
-- 'Administração' — na época o marketing não existia como papel e um grupo novo
-- apareceria sozinho na /admin/permissoes com uma permissão só. Com o papel
-- criado (20260910120000) e o grupo próprio no Sidebar, 'Administração' passou a
-- contradizer o menu; 20260910120200 faz o UPDATE nos bancos onde este seed já
-- rodou, e o valor aqui garante que uma aplicação limpa nasça certa.
--
-- ⚠️ Os grupos de permissão são ADITIVOS e a união dos modelos só é
-- materializada no "Aplicar" de /admin/permissoes. Inserir o código aqui NÃO
-- concede acesso a ninguém: o admin entra pelo roleDefaults do frontend + o ramo
-- por papel das policies (20260831150000), e o marketing precisa receber o
-- código explicitamente em usuarios_permissoes.

INSERT INTO public.permissoes (codigo, nome, rota, grupo, descricao) VALUES
  ('tv_avisos', 'Avisos da TV', '/tv-avisos', 'Marketing',
   'Imagens do carrossel de avisos exibido na TV da recepção enquanto ninguém está sendo chamado')
ON CONFLICT (codigo) DO NOTHING;
