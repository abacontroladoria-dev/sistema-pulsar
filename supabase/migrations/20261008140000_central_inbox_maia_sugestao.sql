-- ============================================================================
-- Central: chave "Maia sugere" por número
--
-- Números Evolution são abertos ao público e atendidos por gente. Com a chave
-- ligada, a Maia escreve só um RASCUNHO (outbound pending, sent_by_ai) para a
-- atendente revisar — ver sugestao-evolution.worker.ts. Não mexe em ai_mode:
-- trg_evolution_sem_ia continua impedindo a Maia de ENVIAR por esses números.
-- Desligada por padrão.
-- ============================================================================

alter table central.inboxes
  add column if not exists maia_sugestao boolean not null default false;

comment on column central.inboxes.maia_sugestao is
  'Maia escreve sugestão de resposta (rascunho, nunca envia). Ligada pela tela de números Evolution.';
