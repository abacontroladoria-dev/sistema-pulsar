-- Grupos de permissão passam a valer ao vivo — decisão do usuário (29/09/2026).
--
-- Até aqui o grupo era um MODELO copiado para usuarios_permissoes no botão
-- "Aplicar" (20260819120000): entrar/sair de grupo, ou editar o modelo, não
-- mudava tela nenhuma até alguém aplicar. Agora:
--
--   telas da pessoa = união dos modelos dos grupos dela
--                     + ajustes individuais liberados
--                     − ajustes individuais retirados
--
-- usuarios_permissoes deixa de guardar cópia do grupo e passa a guardar só o
-- AJUSTE individual (o que difere do grupo, feito em "Por usuário"/"Por
-- permissão"). "Fora do modelo" = ter ajuste.
--
-- Esta migration só cria/troca FUNÇÕES. É segura com o frontend antigo no ar:
-- enquanto usuarios_permissoes ainda tem as cópias, a regra nova dá o mesmo
-- resultado (medido em 29/09/2026: 0 telas mudam para as 36 pessoas). A limpeza
-- das cópias é o snippet 20260929_limpar_copias_dos_grupos_APLICAR.sql, a rodar
-- só DEPOIS do deploy do frontend novo. Desfazer:
-- 20260929_grupos_ao_vivo_ROLLBACK.sql.
--
-- Idempotente.

-- 1. Telas efetivas de uma pessoa ---------------------------------------------
-- Fonte única da regra para o frontend (proxy, menu, rotas de API chamam por
-- RPC). O `usuario_tem_permissao` abaixo aplica a MESMA regra código a código.
CREATE OR REPLACE FUNCTION public.permissoes_efetivas(p_usuario_id uuid DEFAULT auth.uid())
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_codigos text[];
BEGIN
  -- As telas de OUTRA pessoa só para quem administra acessos (a tela de
  -- Permissões e o "Visualizar como") ou para o service_role.
  IF p_usuario_id IS DISTINCT FROM auth.uid()
     AND NOT (public.is_admin() OR public.is_diretoria()
              OR coalesce(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'sem permissão para consultar as permissões de outro usuário'
      USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(array_agg(codigo ORDER BY codigo), ARRAY[]::text[])
  INTO v_codigos
  FROM (
    (
      SELECT e.key AS codigo
      FROM public.grupos_permissoes_membros m
      JOIN public.grupos_permissoes g ON g.id = m.grupo_id
      CROSS JOIN LATERAL jsonb_each(g.modelo_permissoes) AS e(key, value)
      WHERE m.usuario_id = p_usuario_id AND e.value = 'true'::jsonb
      UNION
      SELECT up.permissao_codigo
      FROM public.usuarios_permissoes up
      WHERE up.usuario_id = p_usuario_id AND up.permitido
    )
    EXCEPT
    SELECT up.permissao_codigo
    FROM public.usuarios_permissoes up
    WHERE up.usuario_id = p_usuario_id AND NOT up.permitido
  ) x;

  RETURN v_codigos;
END;
$$;

REVOKE ALL ON FUNCTION public.permissoes_efetivas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.permissoes_efetivas(uuid) TO authenticated, service_role;

-- 2. A checagem das policies passa a enxergar os grupos ------------------------
-- Mesma assinatura, mesmo bypass de admin/diretoria de 20260818210000 — só a
-- parte "tem o código" muda. Em EXISTS, e não chamando permissoes_efetivas, de
-- propósito: policy avalia por linha, e cada EXISTS aqui é uma busca indexada.
CREATE OR REPLACE FUNCTION public.usuario_tem_permissao(p_codigo text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.usuarios u
      WHERE u.id = auth.uid() AND u.ativo = true AND u.role IN ('admin', 'diretoria')
    )
    OR (
      EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.ativo = true)
      AND (
        -- ajuste individual liberado
        EXISTS (
          SELECT 1 FROM public.usuarios_permissoes up
          WHERE up.usuario_id = auth.uid() AND up.permissao_codigo = p_codigo AND up.permitido
        )
        OR (
          -- algum grupo libera…
          EXISTS (
            SELECT 1
            FROM public.grupos_permissoes_membros m
            JOIN public.grupos_permissoes g ON g.id = m.grupo_id
            WHERE m.usuario_id = auth.uid()
              AND g.modelo_permissoes -> p_codigo = 'true'::jsonb
          )
          -- …e não há ajuste individual retirando
          AND NOT EXISTS (
            SELECT 1 FROM public.usuarios_permissoes up
            WHERE up.usuario_id = auth.uid() AND up.permissao_codigo = p_codigo AND NOT up.permitido
          )
        )
      )
    );
$$;

-- CREATE OR REPLACE mantém os grants existentes; reafirma os de 20260818210000
-- (SECURITY DEFINER nasce com EXECUTE para PUBLIC).
REVOKE ALL ON FUNCTION public.usuario_tem_permissao(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usuario_tem_permissao(text) TO authenticated;

-- 3. Duas diferenças medidas em 29/09/2026 (simulação pessoa a pessoa), para
--    ninguém ganhar nem perder tela na troca:
--    a) Pâmela está no grupo Faturamento, cujo modelo passou a dar "Conferência
--       de Guias" (snippet 20260929_grupos_diretoria), mas o "Aplicar" nunca foi
--       clicado depois — hoje ela NÃO tem a tela. Com os grupos ao vivo ganharia
--       na hora; fica como ajuste individual "−", visível como "fora do modelo"
--       (para dar a tela: "Voltar ao modelo").
--    b) Bernardo e Gabriel Salotto chegam hoje à API só pelo prefixo /admin
--       (código `usuarios`), corrigido nesta branch. A API passa a vir do modelo
--       Diretoria — Juliana e Ana Carolina já a tinham individualmente.
--    Explícito (pessoa e código nomeados), e não uma regra "quem não tem", de
--    propósito: rodar de novo depois da limpeza das cópias NÃO pode gravar "−"
--    para todo mundo.
INSERT INTO public.usuarios_permissoes (usuario_id, permissao_codigo, permitido)
SELECT u.id, 'conferencia_guias', false
FROM public.usuarios u
WHERE u.email = 'administrativo@universoaba.com.br'
ON CONFLICT (usuario_id, permissao_codigo) DO NOTHING;

UPDATE public.grupos_permissoes
SET modelo_permissoes = modelo_permissoes || '{"api_integracao": true}'::jsonb,
    updated_at = now()
WHERE nome = 'Diretoria'
  AND modelo_permissoes -> 'api_integracao' IS DISTINCT FROM 'true'::jsonb;

-- Conferência: com as cópias ainda no banco, quem ganharia algo pela regra nova
-- (código liberado pelo grupo sem linha em usuarios_permissoes). Esperado: 0
-- linhas, ou só casos que você reconheça.
SELECT u.nome, e.key AS codigo
FROM public.usuarios u
JOIN public.grupos_permissoes_membros m ON m.usuario_id = u.id
JOIN public.grupos_permissoes g ON g.id = m.grupo_id
CROSS JOIN LATERAL jsonb_each(g.modelo_permissoes) AS e(key, value)
JOIN public.permissoes p ON p.codigo = e.key
LEFT JOIN public.usuarios_permissoes up ON up.usuario_id = u.id AND up.permissao_codigo = e.key
WHERE e.value = 'true'::jsonb AND up.usuario_id IS NULL AND u.role NOT IN ('admin', 'diretoria')
GROUP BY u.nome, e.key
ORDER BY u.nome, e.key;
