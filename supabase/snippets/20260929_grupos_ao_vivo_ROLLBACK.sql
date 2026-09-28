-- DESFAZ "grupos valendo ao vivo" (migration 20260929140000 + limpeza das
-- cópias). Usar só se for preciso voltar ao frontend antigo.
--
-- Ordem: rodar este arquivo, DEPOIS republicar o frontend antigo.
--
-- 1. Refaz as cópias: grava para cada pessoa (fora admin) uma linha por tela do
--    catálogo com o valor que ela tem HOJE pela regra nova. O frontend antigo
--    soma o perfil padrão às linhas; com uma linha explícita para cada código, o
--    perfil deixa de interferir e a pessoa continua vendo exatamente o mesmo.
-- 2. Volta usuario_tem_permissao à versão de 20260818210000 (só linhas liberadas).
--
-- Calcula as telas inline, e não via permissoes_efetivas(): no SQL Editor não há
-- auth.uid(), e aquela função recusa consultar outro usuário.

BEGIN;

WITH uniao AS (
  SELECT DISTINCT m.usuario_id, e.key AS codigo
  FROM public.grupos_permissoes_membros m
  JOIN public.grupos_permissoes g ON g.id = m.grupo_id
  CROSS JOIN LATERAL jsonb_each(g.modelo_permissoes) AS e(key, value)
  WHERE e.value = 'true'::jsonb
),
efetivo AS (
  SELECT u.id AS usuario_id,
         p.codigo,
         CASE
           WHEN up.permitido IS NOT NULL THEN up.permitido
           ELSE EXISTS (SELECT 1 FROM uniao WHERE uniao.usuario_id = u.id AND uniao.codigo = p.codigo)
         END AS permitido
  FROM public.usuarios u
  CROSS JOIN public.permissoes p
  LEFT JOIN public.usuarios_permissoes up ON up.usuario_id = u.id AND up.permissao_codigo = p.codigo
  WHERE u.role <> 'admin'
)
INSERT INTO public.usuarios_permissoes AS up (usuario_id, permissao_codigo, permitido)
SELECT usuario_id, codigo, permitido FROM efetivo
ON CONFLICT (usuario_id, permissao_codigo) DO UPDATE SET permitido = EXCLUDED.permitido
WHERE up.permitido IS DISTINCT FROM EXCLUDED.permitido;

CREATE OR REPLACE FUNCTION public.usuario_tem_permissao(p_codigo text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.id = auth.uid() AND u.ativo = true AND u.role IN ('admin', 'diretoria')
  )
  OR EXISTS (
    SELECT 1 FROM public.usuarios_permissoes up
    JOIN public.usuarios u ON u.id = up.usuario_id
    WHERE up.usuario_id = auth.uid()
      AND up.permissao_codigo = p_codigo
      AND up.permitido = true
      AND u.ativo = true
  );
$$;

REVOKE ALL ON FUNCTION public.usuario_tem_permissao(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usuario_tem_permissao(text) TO authenticated;

COMMIT;

-- permissoes_efetivas() pode ficar: o frontend antigo não a chama.
