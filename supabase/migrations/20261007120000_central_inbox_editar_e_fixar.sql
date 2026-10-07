-- ============================================================================
-- Inbox do Connect: mensagem editada e conversa fixada
--
-- 1. central.messages.edited_at — quando o texto foi trocado depois de enviado
--    (só Evolution; a Meta não tem edição). O texto antigo não é guardado aqui:
--    a trilha `message.edited` em conversation_events leva o antes e o depois.
--    `authenticated` lê a coluna pelo grant de TABELA de central.messages; a
--    escrita é do servidor (service role), como o resto das colunas.
--
-- 2. central.conversation_pins — conversas fixadas no topo, POR ATENDENTE.
--    Fixar é organização de quem atende, não estado da conversa: a mesma
--    conversa pode estar fixada para uma recepcionista e não para outra. Teto
--    de 5 por pessoa, no banco, para a lista não virar "tudo fixado".
-- ============================================================================

set lock_timeout = '5s';

alter table central.messages
  add column if not exists edited_at timestamptz;

create table if not exists central.conversation_pins (
  user_id         uuid        not null default auth.uid(),
  conversation_id uuid        not null references central.conversations(id) on delete cascade,
  organization_id uuid        not null default central.current_organization_id(),
  created_at      timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

create index if not exists idx_conversation_pins_conversation
  on central.conversation_pins (conversation_id);

alter table central.conversation_pins enable row level security;

drop policy if exists conversation_pins_proprio on central.conversation_pins;
create policy conversation_pins_proprio on central.conversation_pins
  for all to authenticated
  using      (user_id = auth.uid())
  with check (user_id = auth.uid() and organization_id = central.current_organization_id());

grant select, insert, delete on central.conversation_pins to authenticated;
grant all on central.conversation_pins to service_role;

create or replace function central.fn_limite_conversation_pins()
returns trigger
language plpgsql
set search_path = central, pg_temp
as $$
begin
  if (select count(*) from central.conversation_pins where user_id = new.user_id) >= 5 then
    raise exception 'Limite de 5 conversas fixadas atingido.'
      using errcode = 'P0001', hint = 'LIMITE_FIXADAS';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_limite_conversation_pins on central.conversation_pins;
create trigger trg_limite_conversation_pins
  before insert on central.conversation_pins
  for each row execute function central.fn_limite_conversation_pins();
