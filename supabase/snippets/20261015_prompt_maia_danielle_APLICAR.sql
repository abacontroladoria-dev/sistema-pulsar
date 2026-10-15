-- Dá à Danielle Menezes a permissão de ver e editar o prompt da Maia
-- (public.usuarios.pode_editar_prompt_maia, 20261015180000). Pedido de
-- 15/10/2026. Modelo para os próximos: troque o e-mail.
--
-- Não muda o papel dela (recepcao / operator): ela continua vendo só os
-- números de que é membro, e na tela de Configurações → Agente só o prompt
-- fica editável. Vale no próximo carregamento da página.
begin;

update public.usuarios
   set pode_editar_prompt_maia = true
 where email = 'daniellemenezes@universoaba.com.br'
   and ativo;

commit;

select nome, role, central_role, pode_editar_prompt_maia
  from public.usuarios
 where email = 'daniellemenezes@universoaba.com.br';
