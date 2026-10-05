-- ============================================================================
-- CRM — Fase 2: a Maia move os cards
--
-- Uma função só, chamada pelo agente (service role) depois de cada sinal da
-- conversa: classificou (registrar_tags), agendou (agendar_sessao), passou
-- para humano (escalar_para_humano) ou declarou a posição (atualizar_funil).
--
-- Regras (as mesmas da conversa com a diretoria em 28/09/2026):
--   - a Maia NUNCA volta posição: só move para position maior que a atual;
--   - a Maia não passa de "Entrevista agendada" (8): Compareceu, cronograma,
--     tratamento e follow-up são do sistema e da equipe;
--   - encerrar (perdido / não qualificado / sem interesse) só enquanto o card
--     está no começo do funil (até "Proposta apresentada") — depois disso
--     houve trabalho humano e a Maia não o desfaz;
--   - trilha: posição de trilha específica define a trilha do card quando ela
--     é nula, e é recusada quando o card já está na outra. "agendado" num
--     card de convênio vira "entrevista_agendada";
--   - posição com exige_motivo sem motivo é recusada.
--
-- Devolve um código curto (movido, ja_esta, sem_negocio, ...) para a
-- ferramenta repassar ao modelo. Nunca lança por regra de negócio.
-- ============================================================================

create or replace function crm.maia_mover_negocio(
  p_org     uuid,
  p_contato uuid,
  p_slug    text,
  p_motivo  text default null
)
returns text
language plpgsql
security definer
set search_path = crm, public
as $$
declare
  v_deal    crm.deals%rowtype;
  v_atual   crm.pipeline_stages%rowtype;
  v_destino crm.pipeline_stages%rowtype;
  v_slug    text := p_slug;
  v_motivo  text := nullif(trim(coalesce(p_motivo, '')), '');
  v_fecha   boolean;
begin
  select d.* into v_deal
    from crm.deals d
   where d.organization_id = p_org
     and d.contact_id = p_contato
     and d.status = 'open'
   for update;
  if not found then
    return 'sem_negocio';
  end if;

  select s.* into v_atual from crm.pipeline_stages s where s.id = v_deal.stage_id;

  if v_slug = 'agendado' and v_deal.trilha = 'convenio' then
    v_slug := 'entrevista_agendada';
  end if;

  select s.* into v_destino
    from crm.pipeline_stages s
   where s.organization_id = p_org and s.slug = v_slug and s.is_active;
  if not found then
    return 'posicao_inexistente';
  end if;

  if v_destino.id = v_atual.id then
    return 'ja_esta';
  end if;

  v_fecha := v_destino.auto_lose or v_destino.auto_win;

  if v_fecha then
    if v_destino.auto_win or v_destino.slug in ('em_follow_up', 'nunca_respondeu') then
      return 'posicao_nao_permitida';
    end if;
    if coalesce(v_atual.slug, '') not in ('novo', 'em_qualificacao', 'qualificado', 'proposta_apresentada') then
      return 'nao_volta';
    end if;
  else
    if v_destino.position > 8 then
      return 'posicao_nao_permitida';
    end if;
    if v_destino.position <= coalesce(v_atual.position, 0) then
      return 'nao_volta';
    end if;
  end if;

  if v_destino.trilha <> 'ambas' and v_deal.trilha is not null and v_deal.trilha <> v_destino.trilha then
    return 'trilha_diferente';
  end if;

  if v_destino.exige_motivo and v_motivo is null then
    return 'falta_motivo';
  end if;

  update crm.deals
     set stage_id      = v_destino.id,
         trilha        = case when v_destino.trilha <> 'ambas' then coalesce(trilha, v_destino.trilha) else trilha end,
         motivo        = coalesce(v_motivo, motivo),
         status        = case when v_fecha then 'lost' else status end,
         closed_at     = case when v_fecha then now() else closed_at end,
         closed_reason = case when v_fecha then coalesce(v_motivo, v_destino.title) else closed_reason end
   where id = v_deal.id;

  insert into crm.deal_activities (organization_id, deal_id, type, title, description, created_by_ai)
  values (p_org, v_deal.id, 'status_change',
          'Movido para "' || v_destino.title || '" pela Maia',
          v_motivo, true);

  return 'movido';
end;
$$;

revoke all on function crm.maia_mover_negocio(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function crm.maia_mover_negocio(uuid, uuid, text, text) to service_role;
