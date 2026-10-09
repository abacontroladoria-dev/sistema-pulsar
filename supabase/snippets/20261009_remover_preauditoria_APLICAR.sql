-- Remove o código de permissão da tela /preauditoria (excluída em 09/10/2026).
-- usuarios_permissoes cai junto por ON DELETE CASCADE.
DELETE FROM public.permissoes WHERE codigo = 'preauditoria';
