-- ============================================================================
-- Central: prévia da última mensagem na própria conversa
--
-- A lista de conversas da /connect/inbox carrega as conversas SEM histórico (o
-- histórico é do detalhe, quando o operador abre). Sem uma prévia guardada na
-- linha, a lista só tinha o fallback literal "Sem mensagens" — mentira em toda
-- conversa que tem mensagem. Buscar a última mensagem de cada conversa a cada
-- poll seria uma consulta a mais; guardar a prévia na conversa custa um campo
-- no UPDATE que o gatilho de `last_message_at` já faz.
--
-- O que entra na prévia:
--   • o corpo, com espaços colapsados e cortado em 160 caracteres;
--   • sem corpo, o rótulo do tipo ('Imagem', 'Áudio'...);
--   • NÃO entram reaction e system (não são fala de ninguém);
--   • NÃO entra mensagem da IA ainda sem id do provider. No insert, rascunho
--     (modo assisted, nunca sai) e resposta autônoma (sai logo depois) são
--     indistinguíveis: os dois nascem sent_by_ai + pending + sem id. A resposta
--     autônoma entra na prévia pelo gatilho de UPDATE, quando o provider
--     devolve o id; o rascunho nunca recebe id e nunca entra — a prévia não
--     afirma ao atendente que o paciente recebeu o que não saiu.
--
-- Mensagem sem prévia ainda avança `last_message_at`, como sempre avançou; só
-- a prévia fica na anterior.
-- ============================================================================

set lock_timeout = '5s';

alter table central.conversations
  add column if not exists last_message_preview text;

comment on column central.conversations.last_message_preview is
  'Prévia da última mensagem com fala (corpo cortado em 160 ou rótulo do tipo). Mantida pelos gatilhos de central.messages; reaction, system e mensagem da IA sem id do provider não entram.';

-- Texto da prévia de uma mensagem, ou NULL quando ela não tem prévia.
create or replace function central.previa_mensagem(
  p_body         text,
  p_message_type text,
  p_sent_by_ai   boolean,
  p_ext_id       text
)
returns text
language sql
immutable
set search_path = central
as $$
  select case
    when p_message_type in ('reaction', 'system') then null
    when p_sent_by_ai and p_ext_id is null         then null
    else coalesce(
      left(nullif(regexp_replace(btrim(coalesce(p_body, '')), '\s+', ' ', 'g'), ''), 160),
      case p_message_type
        when 'image'    then 'Imagem'
        when 'audio'    then 'Áudio'
        when 'video'    then 'Vídeo'
        when 'document' then 'Documento'
        when 'sticker'  then 'Figurinha'
        when 'location' then 'Localização'
      end
    )
  end
$$;

revoke all on function central.previa_mensagem(text, text, boolean, text) from public, anon;
grant execute on function central.previa_mensagem(text, text, boolean, text) to authenticated, service_role;

-- INSERT: mesmo gatilho de sempre (update_last_message_at), agora levando a
-- prévia junto.
create or replace function central.update_conversation_last_message_at()
returns trigger
language plpgsql
security definer
set search_path = central
as $$
declare
  v_msg_time timestamptz;
  v_preview  text;
begin
  v_msg_time := coalesce(new.sent_at, new.created_at, now());
  v_preview  := central.previa_mensagem(new.body, new.message_type, new.sent_by_ai, new.external_message_id);

  -- `>=` para a prévia: duas mensagens no mesmo instante (a Maia quebra
  -- respostas em partes) — a última inserida é a que a prévia deve mostrar. O
  -- filtro de regressão continua: mensagem mais ANTIGA (webhook reprocessado)
  -- não mexe em nada.
  update central.conversations
  set last_message_at      = v_msg_time,
      last_message_preview = coalesce(v_preview, last_message_preview)
  where
    id = new.conversation_id
    and (last_message_at is null or v_msg_time > last_message_at
         or (v_msg_time = last_message_at and v_preview is not null));

  return new;
end;
$$;

revoke all on function central.update_conversation_last_message_at() from public, anon, authenticated;

-- UPDATE: a resposta da IA ganhou id do provider (saiu de fato). Vira prévia se
-- ainda for a mensagem mais recente da conversa.
create or replace function central.update_conversation_preview_ao_confirmar()
returns trigger
language plpgsql
security definer
set search_path = central
as $$
declare
  v_msg_time timestamptz;
  v_preview  text;
begin
  v_preview := central.previa_mensagem(new.body, new.message_type, new.sent_by_ai, new.external_message_id);
  if v_preview is null then
    return new;
  end if;

  v_msg_time := coalesce(new.sent_at, new.created_at);

  update central.conversations
  set last_message_preview = v_preview
  where
    id = new.conversation_id
    and (last_message_at is null or v_msg_time >= last_message_at)
    and last_message_preview is distinct from v_preview;

  return new;
end;
$$;

revoke all on function central.update_conversation_preview_ao_confirmar() from public, anon, authenticated;

drop trigger if exists update_preview_ao_confirmar on central.messages;
create trigger update_preview_ao_confirmar
  after update of external_message_id on central.messages
  for each row
  when (old.external_message_id is null and new.external_message_id is not null and new.sent_by_ai)
  execute function central.update_conversation_preview_ao_confirmar();

-- Backfill: a última mensagem com prévia de cada conversa, pela mesma regra.
update central.conversations c
set last_message_preview = u.preview
from (
  select distinct on (m.conversation_id)
    m.conversation_id,
    central.previa_mensagem(m.body, m.message_type, m.sent_by_ai, m.external_message_id) as preview
  from central.messages m
  where central.previa_mensagem(m.body, m.message_type, m.sent_by_ai, m.external_message_id) is not null
  order by m.conversation_id, coalesce(m.sent_at, m.created_at) desc, m.created_at desc
) u
where c.id = u.conversation_id
  and c.last_message_preview is distinct from u.preview;
