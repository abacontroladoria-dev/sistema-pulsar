-- ============================================================================
-- Status do atendimento: Aberto com quem não é de Aberto (22/10/2026)
--
-- Aberto = "esperando alguém da equipe assumir": a Maia passou e ninguém
-- falou, ou a pessoa escreveu num número só de gente e ninguém respondeu.
-- Em 22/10 havia 65 em Aberto, algumas de 23 dias, e 44 delas não eram isso:
--
--   1. A equipe JÁ respondeu, pelo celular do número (Evolution: Marketing,
--      Autorização). O código antigo só passava para Em atendimento quem
--      respondia pela tela (assumirAoResponder); o celular nunca mudava o
--      status. O código novo (statusAoHumanoResponder) cobre o celular dali
--      em diante, mas não as que já estavam assim.
--      → Aguardando, se a leitura da Maia diz que falta algo de uma das
--        partes; senão Em atendimento. O worker de status segue dali.
--
--   2. A Maia está conversando, mas a conversa nasceu entre o backfill
--      (20261022100200) e o deploy do código que já cria em Autoatendimento.
--      → Autoatendimento.
--
-- Escolha da equipe é respeitada: status_manual_em mais novo que a última
-- mensagem fica como está.
--
-- Ensaio em produção em 22/10: 34 → assigned, 8 → waiting, 2 → self_service;
-- 21 continuam em Aberto (de fato esperando a equipe).
--
-- Aplicar DEPOIS do deploy de status.worker.ts sem o "volta para Aberto" da
-- conversa parada: com o código anterior, o worker devolvia estas mesmas
-- conversas para Aberto no tique seguinte.
--
-- Idempotente: só toca 'open'.
-- ============================================================================

with alvo as (
  select c.id,
    exists (
      select 1 from central.messages m
       where m.conversation_id = c.id
         and m.direction = 'outbound'
         and not m.sent_by_ai
         and m.deleted_at is null
    ) as equipe_falou,
    c.status_ia_veredito in ('aguardando_cliente', 'aguardando_clinica') as aguardando,
    (
      (i.maia_automatica and c.ai_context -> 'transferida_humano' is null)
      or coalesce(
           c.ai_mode::text,
           (select s.ai_mode from central.agent_settings s
             where s.organization_id = c.organization_id and s.inbox_id = c.inbox_id),
           (select s.ai_mode from central.agent_settings s
             where s.organization_id = c.organization_id and s.inbox_id is null)
         ) = 'autonomous'
    ) as maia_responde
  from central.conversations c
  join central.inboxes i on i.id = c.inbox_id
  where c.status = 'open'
    and (c.status_manual_em is null or c.status_manual_em < c.last_message_at)
)
update central.conversations c
   set status = case
                  when a.equipe_falou and a.aguardando then 'waiting'
                  when a.equipe_falou                 then 'assigned'
                  else 'self_service'
                end::central.conversation_status
  from alvo a
 where a.id = c.id
   and (a.equipe_falou or a.maia_responde);
