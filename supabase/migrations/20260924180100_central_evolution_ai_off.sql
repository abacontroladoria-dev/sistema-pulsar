-- ============================================================================
-- Central: a Maia nunca atende número Evolution
--
-- Decisão da diretoria: só a Maia usa a API oficial da Meta; os números
-- Evolution são de atendimento humano. Travar só no código não basta:
-- `conversations.ai_mode` NULL herda o padrão da organização (20260915220000),
-- então uma conversa Evolution nasceria "com a Maia" se a organização estiver em
-- 'autonomous', e qualquer caminho que grave ai_mode (botão, ferramenta, SQL
-- manual) poderia religá-la. No banco vale para todos os caminhos.
-- ============================================================================

create or replace function central.fn_evolution_sem_ia()
returns trigger
language plpgsql
set search_path = central, public
as $$
declare
  v_provider central.provider_type;
begin
  select provider into v_provider from central.channels where id = new.channel_id;

  if v_provider is distinct from 'evolution' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.ai_mode := 'off';
    return new;
  end if;

  -- UPDATE: recusar em vez de corrigir calado. Quem tentou ligar a IA num
  -- número Evolution precisa saber que não é possível.
  if new.ai_mode is distinct from 'off' then
    raise exception 'número Evolution é atendimento humano: ai_mode precisa ser off'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_evolution_sem_ia on central.conversations;
create trigger trg_evolution_sem_ia
  before insert or update of ai_mode, channel_id on central.conversations
  for each row execute function central.fn_evolution_sem_ia();
