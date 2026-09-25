-- ============================================================================
-- APLICAR NO SQL EDITOR DO DASHBOARD SUPABASE (produção)
--
-- Corresponde à migration 20260902140000_pep_datas_semestrais.sql, que existe
-- só localmente e nunca foi aplicada em produção — é a causa do erro
-- PGRST204 "Could not find the 'data_planejada' column of
-- 'pep_planejamento_semestral'" ao salvar planejamento semestral na tela
-- de Entregas PEP.
--
-- Seguro: só adiciona 2 colunas nullable (sem rewrite de tabela, sem lock
-- longo) e 2 backfills com WHERE auto-limitante. Idempotente — reexecutar
-- não causa efeito. Não toca RLS, cron, CHECK constraint nem função.
--
-- DEPOIS de rodar isto com sucesso, registre no histórico para não
-- dessincronizar o tracking de migrations:
--     npx supabase migration repair --status applied 20260902140000
-- ============================================================================

BEGIN;

ALTER TABLE pep_planejamento_semestral
  ADD COLUMN IF NOT EXISTS data_planejada date;

ALTER TABLE pep_registros_entrega
  ADD COLUMN IF NOT EXISTS data_entrega date;

COMMENT ON COLUMN pep_planejamento_semestral.data_planejada IS
  'Data acordada no Planejamento das periódicas (PRD §2.6/§12.6). competencia_planejada continua sendo a unidade de apuração (§6) e é derivada desta data. Sem hora (§2.2).';

COMMENT ON COLUMN pep_registros_entrega.data_entrega IS
  'Data própria do documento de evidência entregue (PRD §2.2). NÃO é registro de atividade nem de jornada (§2.1); a apuração continua por competência (§3). Sem hora.';

-- Backfill: planejamentos existentes só tinham a competência (AAAA-MM), então
-- a data assumida é o 1º dia dela — melhor que NULL, e o usuário ajusta na tela.
UPDATE pep_planejamento_semestral
SET data_planejada = (competencia_planejada || '-01')::date
WHERE data_planejada IS NULL
  AND competencia_planejada ~ '^\d{4}-\d{2}$';

-- Backfill: entregas já marcadas usam a data do ato administrativo que as
-- registrou (entregue_em) como melhor estimativa da data do documento.
UPDATE pep_registros_entrega
SET data_entrega = (entregue_em AT TIME ZONE 'America/Sao_Paulo')::date
WHERE data_entrega IS NULL
  AND status = 'entregue'
  AND entregue_em IS NOT NULL;

COMMIT;

-- ---------------------------------------------------------------------------
-- Conferência (rode depois do COMMIT; deve retornar as 2 linhas):
--
-- SELECT table_name, column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE (table_name = 'pep_planejamento_semestral' AND column_name = 'data_planejada')
--    OR (table_name = 'pep_registros_entrega'      AND column_name = 'data_entrega');
-- ---------------------------------------------------------------------------
