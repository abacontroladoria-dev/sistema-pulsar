-- APLICAR no SQL Editor ANTES do deploy do código (o código lê a coluna nova).
-- Cópia de supabase/migrations/20261008200000_central_inbox_maia_automatica.sql

-- ============================================================================
-- Central: chave "Maia responde" por número Evolution
--
-- Com a chave ligada, o rascunho de sugestao-evolution.worker.ts deixa de ser
-- rascunho: sai pelo envio normal (MessageService.send, sent_by_ai). Só vale em
-- conversa SEM atendente atribuída — quem assumiu a conversa volta a receber
-- sugestão. Implica maia_sugestao (é o mesmo worker e o mesmo despertador do
-- tique, 20261008150000), garantido pelo CHECK.
--
-- Não mexe em ai_mode: trg_evolution_sem_ia continua valendo. A Maia aqui roda
-- só com ferramentas de consulta (somenteLeitura) — não agenda nem desmarca.
-- Desligada por padrão.
-- ============================================================================

alter table central.inboxes
  add column if not exists maia_automatica boolean not null default false;

alter table central.inboxes
  drop constraint if exists inboxes_maia_automatica_exige_sugestao;
alter table central.inboxes
  add constraint inboxes_maia_automatica_exige_sugestao
  check (not maia_automatica or maia_sugestao);

comment on column central.inboxes.maia_automatica is
  'Maia envia a resposta sozinha (número Evolution), em conversa sem atendente atribuída. Exige maia_sugestao.';

-- CONFERÊNCIA — ESPERADO: 4 linhas, maia_automatica = false em todas.
select name, maia_sugestao, maia_automatica from central.inboxes order by name;
