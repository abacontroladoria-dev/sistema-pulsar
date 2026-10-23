-- =============================================================================
-- CRM do Órbita casa o nome sem caixa nem acento
-- =============================================================================
-- 23/10/2026, fazendinha-isabela: "Levi Lúcio Castro de Souza" (TiTa) contra
-- "Levi Lúcio Castro De Souza" (agenda_orbita). O lateral de
-- agenda_tita_autorizacao comparava paciente_nome com `=`, a tarefa saía sem CRM
-- e o robô parava em "CRM não informado" (rpa.js) depois da identificação — a
-- aba fechava e a recepção autorizava à mão.
--
-- O `=` exato não bastou para explicar: o Órbita tinha as DUAS grafias — 10
-- linhas "de" sem CRM e 49 "De" com CRM. O lateral é LIMIT 1 sem ordem, então
-- caía numa linha vazia. Duas mudanças no WHERE do lateral:
--   1. só linhas com CRM preenchido;
--   2. nome comparado com lower(translate(...)) dos dois lados, com índice de
--      expressão em agenda_orbita para o lateral seguir por índice.
--
-- TÉCNICA: replace sobre o corpo VIVO (pg_get_viewdef), como 20261016190000.
-- Trecho contado 1x antes; senão RAISE e nada muda. Idempotente pelo texto novo.
-- =============================================================================

set lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_agenda_orbita_paciente_nome_norm
  ON public.agenda_orbita (lower(translate(paciente_nome, 'ÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇáàãâäéèêëíìîïóòõôöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')));

DO $migr$
DECLARE
  v_def  text;
  v_n    int;
  v_alvo text := '(o.paciente_nome = a.paciente_nome)';
  v_novo text := '(lower(translate(o.paciente_nome, ''ÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇáàãâäéèêëíìîïóòõôöúùûüç'', ''AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'')) = lower(translate(a.paciente_nome, ''ÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇáàãâäéèêëíìîïóòõôöúùûüç'', ''AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc''))) AND (NULLIF(btrim(o.crm), '''') IS NOT NULL)';
BEGIN
  v_def := pg_get_viewdef('public.agenda_tita_autorizacao'::regclass);

  IF position('lower(translate(o.paciente_nome' in v_def) > 0 THEN
    RAISE NOTICE 'agenda_tita_autorizacao já casa o nome do Órbita sem caixa/acento';
    RETURN;
  END IF;

  v_n := (length(v_def) - length(replace(v_def, v_alvo, ''))) / length(v_alvo);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'agenda_tita_autorizacao: trecho esperado 1x, achei %: %. Reveja à mão.', v_n, v_alvo;
  END IF;

  EXECUTE 'CREATE OR REPLACE VIEW public.agenda_tita_autorizacao AS ' -- seguranca: security_invoker é religado logo abaixo (ALTER VIEW)
          || replace(v_def, v_alvo, v_novo);
  -- CREATE OR REPLACE zera reloptions.
  EXECUTE 'ALTER VIEW public.agenda_tita_autorizacao SET (security_invoker = true)';
  RAISE NOTICE 'agenda_tita_autorizacao: CRM do Órbita casa sem caixa/acento';
END
$migr$;
