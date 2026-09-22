-- ============================================================================
-- APLICAR NO SQL EDITOR DO DASHBOARD SUPABASE (produção)
--
-- Corresponde à migration 20260923000300_faltas_historico_csv_hora_nullable.sql
--
-- 7 linhas do CSV de Jan/2026 (todas Presença=Sim) vieram sem horário na fonte
-- (Órbita). Sem isto, o import trava com "null value in column hora_inicial
-- violates not-null constraint". Seguro: só remove um NOT NULL, tabela ainda
-- está vazia (o primeiro --apply falhou antes de gravar nada por causa disso).
--
-- DEPOIS de rodar isto com sucesso:
--     npx supabase migration repair --status applied 20260923000300
-- ============================================================================

BEGIN;

alter table public.faltas_historico_csv
  alter column hora_inicial drop not null;

comment on column public.faltas_historico_csv.hora_inicial is
  'NULL nas raras linhas em que o relatório do Órbita não trouxe o horário '
  '(observado em Jan/2026, só em linhas Presença=Sim — não afeta dedução, já '
  'que sem horário não há como casar com csv_grade_id de qualquer forma).';

COMMIT;

-- ---------------------------------------------------------------------------
-- Conferência (rode depois do COMMIT; deve mostrar is_nullable = YES):
--
-- SELECT column_name, is_nullable FROM information_schema.columns
-- WHERE table_name = 'faltas_historico_csv' AND column_name = 'hora_inicial';
-- ---------------------------------------------------------------------------
