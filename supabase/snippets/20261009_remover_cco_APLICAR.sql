-- Remove a tela /cco (excluída em 09/10/2026): permissão e a RPC exclusiva dela.
-- usuarios_permissoes cai junto por ON DELETE CASCADE.
DELETE FROM public.permissoes WHERE codigo = 'cco';
DROP FUNCTION IF EXISTS public.get_cco_atendimentos(date, date);
