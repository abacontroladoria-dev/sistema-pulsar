-- Nomes dos grupos de permissão de uma pessoa — para as telas mostrarem o GRUPO
-- onde antes mostravam o nível técnico (usuarios.role): rodapé do Sidebar do
-- Pulsar e do Connect, página "Sem permissão" e modal de perfil. Pedido do
-- usuário (29/09/2026): o nível "fica somente no pano de fundo".
--
-- Função, e não uma policy nova: grupos_permissoes e os membros só são legíveis
-- por admin/diretoria (20260819120000), e abrir a tabela para todos exporia os
-- modelos e os membros dos outros grupos. Aqui cada pessoa lê só os NOMES dos
-- próprios grupos.
--
-- Só leitura, sem dado alterado: pode aplicar a qualquer momento, antes ou
-- depois da publicação do frontend (sem ela, as telas só deixam o rótulo vazio).
-- Idempotente.

CREATE OR REPLACE FUNCTION public.grupos_do_usuario(p_usuario_id uuid DEFAULT auth.uid())
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nomes text[];
BEGIN
  -- De OUTRA pessoa, só para quem administra acessos ("Visualizar como") —
  -- mesma regra de permissoes_efetivas() (20260929140000).
  IF p_usuario_id IS DISTINCT FROM auth.uid()
     AND NOT (public.is_admin() OR public.is_diretoria()
              OR coalesce(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'sem permissão para consultar os grupos de outro usuário'
      USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(array_agg(g.nome ORDER BY g.nome), ARRAY[]::text[])
  INTO v_nomes
  FROM public.grupos_permissoes_membros m
  JOIN public.grupos_permissoes g ON g.id = m.grupo_id
  WHERE m.usuario_id = p_usuario_id;

  RETURN v_nomes;
END;
$$;

REVOKE ALL ON FUNCTION public.grupos_do_usuario(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grupos_do_usuario(uuid) TO authenticated, service_role;
