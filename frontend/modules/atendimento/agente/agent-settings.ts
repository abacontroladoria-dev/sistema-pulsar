import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================================
// O padrão da clínica para a atendente automática.
//
// Separado de modo-efetivo.ts, que é a REGRA de precedência: esta metade fala
// com o banco e por isso é `server-only`; aquela é pura e precisa continuar
// rodando com `npx tsx` sem stack nenhuma. Juntas num arquivo só, o import de
// `server-only` contaminava a regra e o teste dela nem carregava.
// ============================================================================

export interface AgentSettings {
  ai_mode:               string
  ai_scheduling_enabled: boolean
  system_prompt:         string | null
}

// O padrão da ORGANIZAÇÃO, sem inbox nenhuma no meio — a linha com
// `inbox_id is null`, que `uq_agent_settings_org_default` garante ser única.
//
// Existe porque a triagem (/conversations/caixas) atravessa todas as inboxes: não
// há inbox_id para passar, e inventar um (string vazia) montaria um `.or()` com
// `inbox_id.eq.` malformado — a resposta viria errada ou vazia, calada. Perguntar
// pelo padrão da org é a pergunta certa, não um caso degenerado da outra.
export async function lerAgentSettingsDaOrg(
  supabase: SupabaseClient,
  orgId: string,
): Promise<AgentSettings> {
  const { data, error } = await supabase
    .schema('central')
    .from('agent_settings')
    .select('ai_mode, ai_scheduling_enabled, system_prompt')
    .eq('organization_id', orgId)
    .is('inbox_id', null)
    .maybeSingle()

  if (error) throw error

  // Mesma falha fechada de lerAgentSettings: sem configuração, desligada.
  if (!data) return { ai_mode: 'off', ai_scheduling_enabled: false, system_prompt: null }

  return data as AgentSettings
}

export async function lerAgentSettings(
  supabase: SupabaseClient,
  orgId: string,
  inboxId: string,
): Promise<AgentSettings> {
  // Configuração da inbox vence a da organização; a da org é o padrão. É o que
  // o par de índices únicos parciais de agent_settings já previa.
  const { data, error } = await supabase
    .schema('central')
    .from('agent_settings')
    .select('ai_mode, ai_scheduling_enabled, system_prompt, inbox_id')
    .eq('organization_id', orgId)
    .or(`inbox_id.eq.${inboxId},inbox_id.is.null`)
    .order('inbox_id', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error

  if (!data) {
    // Sem configuração é DESLIGADA, não ligada. Falha fechada: uma instalação
    // sem seed não deve começar a responder pacientes sozinha.
    return { ai_mode: 'off', ai_scheduling_enabled: false, system_prompt: null }
  }

  return data as AgentSettings
}
