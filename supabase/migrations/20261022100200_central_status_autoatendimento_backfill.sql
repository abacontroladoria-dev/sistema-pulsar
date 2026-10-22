-- ============================================================================
-- Status "Autoatendimento" (22/10/2026) — 3 de 3: as conversas de hoje
--
-- Conversa ativa, em 'open', sem responsável e com a Maia respondendo vira
-- self_service. "A Maia responde" tem os dois caminhos de sempre (ver
-- reference: "Maia responde" sem ai_mode):
--   - número Evolution com "Maia responde" (inboxes.maia_automatica) e a
--     conversa não transferida (ai_context->transferida_humano nulo);
--   - número da Meta com o modo efetivo 'autonomous': o da conversa, senão o
--     da inbox, senão o da organização (agente/modo-efetivo.ts). No Evolution o
--     ai_mode é sempre 'off' (trg_evolution_sem_ia), então os dois não se cruzam.
--
-- Contagem em produção no ensaio de 22/10: 61 (52 Evolution + 9 Meta). As 53
-- em 'open' sem Maia continuam "Aberto" — foram passadas à equipe.
--
-- Idempotente: só toca 'open'.
-- ============================================================================

update central.conversations c
   set status = 'self_service'
  from central.inboxes i
 where i.id = c.inbox_id
   and c.status = 'open'
   and c.assigned_user_id is null
   and (
     (i.maia_automatica and c.ai_context -> 'transferida_humano' is null)
     or coalesce(
          c.ai_mode::text,
          (select s.ai_mode from central.agent_settings s
            where s.organization_id = c.organization_id and s.inbox_id = c.inbox_id),
          (select s.ai_mode from central.agent_settings s
            where s.organization_id = c.organization_id and s.inbox_id is null)
        ) = 'autonomous'
   );
