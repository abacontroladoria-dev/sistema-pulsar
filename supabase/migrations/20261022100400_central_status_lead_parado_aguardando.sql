-- ============================================================================
-- Lead parado volta para a Maia, em Aguardando (22/10/2026)
--
-- Regra até a manhã de 22/10: conversa com a Maia parada 24h esperando
-- alguém → nota interna e a Maia passava para a equipe (Aberto). Nas
-- primeiras horas em produção isso levou ~25 leads que só sumiram depois de
-- receber a resposta para o Aberto, a fila de quem precisa de gente.
--
-- Regra nova (decisão do usuário, status.worker.ts → avisarParada):
--   - vez da CLÍNICA (aguardando_clinica) → continua indo para Aberto;
--   - vez do CLIENTE (aguardando_cliente) → a Maia fica na conversa, que vai
--     para Aguardando; se o cliente voltar, ela responde e volta a
--     Autoatendimento.
--
-- Este arquivo desfaz a transferência por inatividade das que eram vez do
-- cliente e ninguém da equipe falou ainda:
--   - Evolution: apaga a marca ai_context.transferida_humano (origem
--     'inatividade') — a Maia volta a responder;
--   - Meta: devolve o ai_mode que a conversa tinha antes da escalada (o 'de'
--     do evento conversation.ai_mode_changed de origem 'inatividade');
--   - status → waiting; priority → null (a 'high' veio da transferência e
--     acendia o selo "escalada").
-- Onde a equipe já falou, só o status vai para Aguardando; a Maia não volta.
--
-- As notas já escritas ficam ("Passei a conversa para a equipe…").
--
-- Ensaio em produção em 22/10: 20 Evolution + 3 Meta voltam para a Maia;
-- 1 com resposta da equipe vai para Aguardando; 3 de vez da clínica ficam
-- em Aberto.
--
-- Aplicar DEPOIS do deploy do status.worker.ts com a regra nova: o código
-- anterior seguiria transferindo os próximos leads parados para Aberto.
-- ============================================================================

with transf as (
  select distinct on (c.id)
    c.id,
    ch.provider,
    exists (
      select 1 from central.messages m
       where m.conversation_id = c.id and m.direction = 'outbound'
         and not m.sent_by_ai and m.deleted_at is null
    ) as equipe_falou,
    e.payload ->> 'de' as ai_mode_antes
  from central.conversations c
  join central.channels ch on ch.id = c.channel_id
  left join central.conversation_events e
         on e.conversation_id = c.id
        and e.event_type = 'conversation.ai_mode_changed'
        and e.payload ->> 'origem' = 'inatividade'
  where c.status = 'open'
    and c.status_ia_veredito = 'aguardando_cliente'
    and (c.status_manual_em is null or c.status_manual_em < c.last_message_at)
    and (c.ai_context -> 'transferida_humano' ->> 'origem' = 'inatividade' or e.id is not null)
  order by c.id, e.created_at desc
)
update central.conversations c
   set status     = 'waiting',
       priority   = case when t.equipe_falou then c.priority else null end,
       ai_context = case
                      when not t.equipe_falou and t.provider = 'evolution'
                       and c.ai_context -> 'transferida_humano' ->> 'origem' = 'inatividade'
                      then c.ai_context - 'transferida_humano'
                      else c.ai_context
                    end,
       ai_mode    = case
                      when not t.equipe_falou and t.provider <> 'evolution'
                      then nullif(t.ai_mode_antes, '')::central.ai_mode
                      else c.ai_mode
                    end
  from transf t
 where t.id = c.id;
