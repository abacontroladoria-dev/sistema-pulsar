-- Adiciona o setor (role) 'comercial' e o grupo de permissões 'Comercial'.
--
-- Desde 20260929130000 o nível técnico (usuarios.role) é mantido pelo banco a
-- partir dos grupos: quem entra no grupo 'Comercial' passa a ter role
-- 'comercial'. Por isso o papel precisa de três coisas aqui:
--   1. caber no usuarios_role_check (senão o gatilho do grupo falha no UPDATE);
--   2. um grupo com nivel_tecnico = 'comercial';
--   3. um lugar na prioridade de sincronizar_nivel_pelos_grupos (fora do array,
--      array_position dá NULL e o nível perde para qualquer outro grupo).
--
-- As telas do grupo vêm do modelo aplicado em /admin/permissoes — o modelo
-- nasce vazio, como todo grupo-semente.
--
-- Idempotente.

-- 1. Constraint ----------------------------------------------------------------
DO $$
DECLARE
  allowed     text[] := ARRAY[
    'admin','diretoria','recepcao','autorizacao','terapeutico',
    'faturamento','rp','cronograma','disponibilidade_terapeuta','marketing',
    'comercial'
  ];
  extra_role  text;
BEGIN
  FOR extra_role IN
    SELECT DISTINCT role FROM public.usuarios WHERE role IS NOT NULL
  LOOP
    IF NOT (extra_role = ANY(allowed)) THEN
      allowed := array_append(allowed, extra_role);
      RAISE NOTICE 'Role existente não mapeado incluído no constraint: %', extra_role;
    END IF;
  END LOOP;

  ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_role_check;

  EXECUTE format(
    'ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_role_check CHECK (role IN (%s))',
    (SELECT string_agg(quote_literal(r), ',') FROM unnest(allowed) AS r)
  );
END;
$$;

-- 2. Grupo ---------------------------------------------------------------------
INSERT INTO public.grupos_permissoes (nome, descricao, nivel_tecnico)
VALUES ('Comercial', 'Grupo inicial — comercial', 'comercial')
ON CONFLICT (nome) DO UPDATE SET nivel_tecnico = EXCLUDED.nivel_tecnico
WHERE public.grupos_permissoes.nivel_tecnico IS DISTINCT FROM EXCLUDED.nivel_tecnico;

-- 3. Prioridade do nível -------------------------------------------------------
-- Mesmo corpo de 20260929130000, com 'comercial' ao lado de 'marketing'.
CREATE OR REPLACE FUNCTION public.sincronizar_nivel_pelos_grupos(p_usuario_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_atual text;
  v_novo  text;
  v_ator_admin boolean := public.is_admin();
BEGIN
  SELECT role INTO v_atual FROM public.usuarios WHERE id = p_usuario_id;
  IF v_atual IS NULL THEN
    RETURN;  -- usuário excluído (cascade dos membros) ou inexistente
  END IF;

  SELECT g.nivel_tecnico INTO v_novo
  FROM public.grupos_permissoes_membros m
  JOIN public.grupos_permissoes g ON g.id = m.grupo_id
  WHERE m.usuario_id = p_usuario_id
    AND g.nivel_tecnico IS NOT NULL
    AND (g.nivel_tecnico <> 'admin' OR v_ator_admin)
  ORDER BY array_position(
    ARRAY['admin','diretoria','cronograma','autorizacao','rp','faturamento',
          'terapeutico','recepcao','comercial','marketing','disponibilidade_terapeuta'],
    g.nivel_tecnico)
  LIMIT 1;

  IF v_novo IS NULL OR v_novo = v_atual THEN
    RETURN;  -- sem grupo com nível: mantém o que tem
  END IF;

  IF v_atual = 'admin' THEN
    IF NOT v_ator_admin THEN
      RETURN;  -- só admin tira alguém do nível admin
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.usuarios
      WHERE role = 'admin' AND ativo AND id <> p_usuario_id
    ) THEN
      RETURN;  -- nunca remove o último admin ativo
    END IF;
  END IF;

  UPDATE public.usuarios SET role = v_novo WHERE id = p_usuario_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sincronizar_nivel_pelos_grupos(uuid) FROM PUBLIC, anon, authenticated;
