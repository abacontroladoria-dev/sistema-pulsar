-- =============================================================================
-- 1ª presença → ClickUp: quais cards têm nome que não existe na agenda
-- =============================================================================
-- Na estreia (16/10/2026) os 14 cards em 'AGENDAMENTO CONCLUÍDO' não casaram com
-- ninguém, nem com janela de 60 dias. "Ainda não veio" e "o nome do card não
-- bate com o do TiTa" dão o mesmo silêncio. Esta função separa os dois: devolve
-- os cards cujo nome não aparece em NENHUMA sessão da agenda (60 dias para trás
-- e para a frente). Paciente com agendamento concluído tem sessão marcada, então
-- card nesta lista quase sempre é nome divergente — e esse card nunca se moverá
-- sozinho. A Edge Function põe esses nomes no resumo de cada rodada.
--
-- Mesmas regras de nome de presenca_clickup_casar (20261016190100).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.presenca_clickup_nomes_sem_agenda(p_cartoes jsonb)
RETURNS TABLE (clickup_task_id text, cartao_nome text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH hoje AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS d),
  cartoes AS (
    SELECT c->>'id' AS task_id,
           c->>'nome' AS nome,
           public.normalizar_nome_paciente(
             regexp_replace(c->>'nome', '\s*\([^)]*\)\s*$', '')) AS chave
      FROM jsonb_array_elements(coalesce(p_cartoes, '[]'::jsonb)) c
     WHERE coalesce(c->>'id', '') <> ''
  ),
  agenda AS (
    SELECT DISTINCT public.normalizar_nome_paciente(a.paciente_nome) AS chave
      FROM public.agenda_tita a, hoje h
     WHERE a.ativo
       AND a.data_atendimento BETWEEN h.d - 60 AND h.d + 60
  )
  SELECT c.task_id, c.nome
    FROM cartoes c
   WHERE NOT EXISTS (
     SELECT 1 FROM agenda g
      WHERE g.chave = c.chave
         OR (coalesce(array_length(string_to_array(c.chave, ' '), 1), 0) >= 3
             AND g.chave LIKE c.chave || ' %'));
$$;

COMMENT ON FUNCTION public.presenca_clickup_nomes_sem_agenda(jsonb) IS
  'Cards do ClickUp cujo nome não aparece na agenda TiTa (±60 dias): nome divergente, o card nunca se moverá sozinho. Só service_role.';

REVOKE ALL ON FUNCTION public.presenca_clickup_nomes_sem_agenda(jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.presenca_clickup_nomes_sem_agenda(jsonb) TO service_role;
