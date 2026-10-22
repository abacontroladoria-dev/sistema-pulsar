-- ============================================================================
-- Status "Autoatendimento" (22/10/2026) — 1 de 3
--
-- A Maia conversando com a pessoa passa a ter status próprio, o primeiro da
-- lista: self_service. Antes ela aparecia como 'open' ("Aberto"), o mesmo
-- status da conversa que a Maia passou para a equipe e ninguém pegou — as
-- duas filas mais diferentes do inbox com o mesmo rótulo.
--
-- SOZINHA DE PROPÓSITO: valor novo de enum não pode ser usado na mesma
-- transação que o criou (55P04). A 20261022100100 já o usa (view e backfill),
-- então esta precisa estar commitada antes. No SQL Editor: rodar esta, depois
-- a próxima.
--
-- Leitura: todo predicado que enumera "conversas ativas" precisa do valor
-- novo. No banco, só a view contacts_with_stats (20261022100100); o índice
-- único e recalcular_status_pacientes usam `not in ('resolved','archived')` e
-- já o incluem. No código, ver a lista no commit.
-- ============================================================================

alter type central.conversation_status add value if not exists 'self_service' before 'open';
