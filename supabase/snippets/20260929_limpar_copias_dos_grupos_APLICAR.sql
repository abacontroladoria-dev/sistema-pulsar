-- Apaga de usuarios_permissoes as linhas que só REPETEM o que os grupos da pessoa
-- já dão — o que sobra são os ajustes individuais ("fora do modelo").
--
-- Rodar no SQL Editor SOMENTE DEPOIS de:
--   1. migration 20260929140000_grupos_valem_ao_vivo.sql aplicada, e
--   2. o frontend novo (grupos ao vivo) publicado.
-- Com o frontend antigo no ar, NÃO rodar: ele ainda soma o perfil padrão às
-- linhas, e sem as cópias algumas pessoas ganhariam/perderiam telas.
--
-- Por que é preciso: sem limpar, as cópias viram "ajustes" fantasmas — tirar a
-- Laura da Recepção não tiraria as telas da Recepção dela, porque cada uma ainda
-- estaria gravada como liberada individualmente.
--
-- Não muda tela de ninguém: apaga só linha cujo valor é igual ao que os grupos
-- já dão. Medido em 29/09/2026: sobram 40 ajustes de 19 pessoas.
-- Idempotente.

-- TRAVA: este arquivo falha de propósito até você trocar `false` por `true`
-- na linha abaixo — só depois que o frontend NOVO estiver publicado. Em
-- 29/09/2026 ele rodou antes da publicação e 31 pessoas ficaram com o menu
-- errado até o ROLLBACK.
DO $$
DECLARE
  frontend_novo_ja_publicado boolean := false;
BEGIN
  IF NOT frontend_novo_ja_publicado THEN
    RAISE EXCEPTION 'Pare: rode este arquivo só DEPOIS de publicar o frontend novo (grupos ao vivo). Nada foi alterado.';
  END IF;
END $$;

BEGIN;

WITH uniao AS (
  SELECT DISTINCT m.usuario_id, e.key AS codigo
  FROM public.grupos_permissoes_membros m
  JOIN public.grupos_permissoes g ON g.id = m.grupo_id
  CROSS JOIN LATERAL jsonb_each(g.modelo_permissoes) AS e(key, value)
  WHERE e.value = 'true'::jsonb
)
DELETE FROM public.usuarios_permissoes up
WHERE
  -- liberado individualmente o que o grupo já libera
  (up.permitido AND EXISTS (
     SELECT 1 FROM uniao WHERE uniao.usuario_id = up.usuario_id AND uniao.codigo = up.permissao_codigo))
  OR
  -- retirado individualmente o que nenhum grupo libera
  (NOT up.permitido AND NOT EXISTS (
     SELECT 1 FROM uniao WHERE uniao.usuario_id = up.usuario_id AND uniao.codigo = up.permissao_codigo));

COMMIT;

-- Conferência: os ajustes que sobraram, por pessoa ("+" liberado, "−" retirado).
SELECT u.nome,
       count(*) AS ajustes,
       string_agg(CASE WHEN up.permitido THEN '+' ELSE '−' END || up.permissao_codigo, ' '
                  ORDER BY up.permissao_codigo) AS quais
FROM public.usuarios_permissoes up
JOIN public.usuarios u ON u.id = up.usuario_id
GROUP BY u.nome
ORDER BY u.nome;
