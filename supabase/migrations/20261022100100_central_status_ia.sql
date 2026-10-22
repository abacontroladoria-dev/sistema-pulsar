-- ============================================================================
-- Status do atendimento decidido pela Maia (22/10/2026) — 2 de 3
--
-- O worker de status (modules/atendimento/workers/status.worker.ts) lê a
-- conversa e decide em que pé ela está: em andamento, aguardando uma das
-- partes, resolvida ou fechada sem conclusão. Estas colunas guardam essa
-- leitura.
--
-- POR QUE COLUNAS E NÃO ai_context
--
-- ai_context é lido-modificado-gravado inteiro por quatro caminhos (vagas
-- oferecidas, reivindicação do worker Evolution, transferência, plantão). Um
-- quinto escritor ali apagaria a reivindicação de um turno em andamento — o
-- mesmo defeito que transferirDoMaiaResponde já contorna relendo a linha.
-- Coluna própria é UPDATE de coluna própria.
--
-- status_ia_ate é a MARCA D'ÁGUA: o last_message_at que a leitura cobriu. Mensagem
-- nova (last_message_at > status_ia_ate) invalida o veredito e pede outra
-- leitura; igual, o veredito vale e o worker só espera o tempo de aplicá-lo
-- (2h de silêncio para encerrar, 24h de parada para avisar a equipe).
--
-- status_manual_em: a equipe escolheu o status à mão. Vale até a próxima
-- mensagem — a Maia não desfaz a escolha de ninguém sobre o mesmo material.
--
-- status_ia_alerta_em: a nota "conversa parada" já foi escrita neste
-- episódio. Zerada quando chega mensagem nova (pelo worker).
--
-- NOTA INTERNA DA MAIA: author_user_id passa a aceitar NULL nas notas e nas
-- menções. NULL = a Maia, mesma convenção de performed_by na auditoria
-- (events.types.ts). Um "usuário Maia" sintético apareceria em toda lista de
-- operadores.
--
-- Aditiva e nula: código antigo não lê nem escreve nada daqui.
-- ============================================================================

alter table central.conversations
  add column if not exists status_ia_ate        timestamptz,
  add column if not exists status_ia_veredito   text,
  add column if not exists status_ia_confianca  numeric(3,2),
  add column if not exists status_ia_motivo     text,
  add column if not exists status_ia_pendencia  text,
  add column if not exists status_ia_em         timestamptz,
  add column if not exists status_manual_em     timestamptz,
  add column if not exists status_ia_alerta_em  timestamptz;

alter table central.conversations drop constraint if exists ck_conversations_status_ia_veredito;
alter table central.conversations
  add constraint ck_conversations_status_ia_veredito
  check (status_ia_veredito is null or status_ia_veredito in (
    'em_andamento', 'aguardando_cliente', 'aguardando_clinica', 'resolvido', 'fechado'
  ));

alter table central.conversations drop constraint if exists ck_conversations_status_ia_confianca;
alter table central.conversations
  add constraint ck_conversations_status_ia_confianca
  check (status_ia_confianca is null or status_ia_confianca between 0 and 1);

comment on column central.conversations.status_ia_ate is
  'Marca d''agua da leitura de status pela Maia: o last_message_at que ela cobriu. Mensagem mais nova pede outra leitura.';
comment on column central.conversations.status_ia_veredito is
  'Ultima leitura da Maia: em_andamento, aguardando_cliente, aguardando_clinica, resolvido ou fechado (sem conclusao).';
comment on column central.conversations.status_manual_em is
  'Quando a equipe escolheu o status a mao. A Maia nao muda o status ate chegar mensagem mais nova que isto.';
comment on column central.conversations.status_ia_alerta_em is
  'Quando a Maia escreveu a nota interna de conversa parada neste episodio. Nunca fecha por tempo.';

-- O worker procura conversa ativa com mensagem não lida pela Maia. Parcial:
-- encerradas são a maioria da tabela e nunca entram.
create index if not exists idx_conversations_status_ia_pendente
  on central.conversations (organization_id, last_message_at)
  where status not in ('resolved', 'archived');

-- Nota interna escrita pela Maia.
alter table central.conversation_notes    alter column author_user_id drop not null;
alter table central.conversation_mentions alter column author_user_id drop not null;

-- contacts_with_stats: "conversas abertas" passa a contar Autoatendimento.
-- Recriada a partir da própria definição, trocando só o predicado — colar o
-- corpo de 20260701010300 arriscaria divergir do que está em produção.
-- create or replace mantém security_invoker e os grants.
do $$
declare
  v_def  text := pg_get_viewdef('central.contacts_with_stats'::regclass, true);
  v_de   text := $q$ARRAY['open'::central.conversation_status, 'assigned'::central.conversation_status, 'waiting'::central.conversation_status]$q$;
  v_para text := $q$ARRAY['self_service'::central.conversation_status, 'open'::central.conversation_status, 'assigned'::central.conversation_status, 'waiting'::central.conversation_status]$q$;
begin
  if position('self_service' in v_def) > 0 then
    return;  -- já aplicada
  end if;
  if (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 then
    raise exception 'contacts_with_stats: predicado de conversas abertas não encontrado exatamente uma vez';
  end if;
  execute 'create or replace view central.contacts_with_stats with (security_invoker = true) as '
    || replace(v_def, v_de, v_para);
end
$$;

notify pgrst, 'reload schema';
