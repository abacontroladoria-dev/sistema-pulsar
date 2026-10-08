import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createAppointmentSystemService, createSystemServices } from '../services'
import { MessageRepository } from '../repositories/message.repository'
import { AppointmentRepository } from '../repositories/appointment.repository'
import { montarContexto, LIMITE_HISTORICO } from '../agente/contexto'
import { executarTurno } from '../agente/orquestrador'
import { FerramentasAgente } from '../agente/ferramentas'
import { openAiProvider } from '../llm/openai.provider'
import { lerAgentSettings } from '../agente/agent-settings'

// ============================================================================
// Maia sugere — números Evolution com a chave ligada
//
// Número Evolution é aberto ao público e atendido por gente; a Maia NUNCA envia
// por ele (trg_evolution_sem_ia segue travando ai_mode em 'off'). Com
// `inboxes.maia_sugestao` ligada, ela só escreve um RASCUNHO — a mesma bolha
// "Sugestão da Maia — não enviada" do modo 'assisted' — e a atendente decide.
//
// Não passa pela message_grouping_queue (formato da Meta). O debounce é a
// própria pergunta: a ÚLTIMA mensagem da conversa é do paciente e está parada
// há 15s? Rascunho gravado, ou resposta da atendente, deixa de ser a última — e
// a conversa sai da seleção sozinha.
//
// Turno `somenteLeitura`: só ferramentas de consulta. Sugestão descartável não
// pode ter agendado nem movido nada.
//
// "Maia responde" (`inboxes.maia_automatica`, exige maia_sugestao): o texto sai
// pelo envio normal em vez de virar rascunho — só em conversa sem atendente
// atribuída. Quem assumiu a conversa volta a receber sugestão. Continua
// somenteLeitura e continua sem ai_mode.
// ============================================================================

// Curto: divide o maxDuration de 60s do tique com agrupamento e envio.
const ORCAMENTO_MS = 12_000
const ESPERA_MS = 15_000           // a pessoa terminar de escrever
const JANELA_MS = 30 * 60_000      // conversa parada há mais que isso não ganha sugestão
const MAX_POR_TIQUE = 3

export interface ResultadoSugestao {
  candidatas: number
  sugeridas: number
  enviadas: number
  falhas: number
}

interface ConversaCandidata {
  id: string
  inbox_id: string
  contact_id: string
  assigned_user_id: string | null
  ai_context: Record<string, unknown> | null
}

export async function processarSugestoesEvolution(
  supabase: SupabaseClient,
  orgId: string,
): Promise<ResultadoSugestao> {
  const r: ResultadoSugestao = { candidatas: 0, sugeridas: 0, enviadas: 0, falhas: 0 }
  const limite = Date.now() + ORCAMENTO_MS
  const db = supabase.schema('central')

  const { data: inboxes, error: e1 } = await db
    .from('inboxes')
    .select('id, maia_automatica')
    .eq('organization_id', orgId)
    .eq('maia_sugestao', true)
  if (e1) throw e1
  const lidas = (inboxes ?? []) as { id: string; maia_automatica: boolean }[]
  const inboxIds = lidas.map(i => i.id)
  const automaticas = new Set(lidas.filter(i => i.maia_automatica).map(i => i.id))
  if (inboxIds.length === 0) return r

  const agora = Date.now()
  const { data: conversas, error: e2 } = await db
    .from('conversations')
    .select('id, inbox_id, contact_id, assigned_user_id, ai_context')
    .eq('organization_id', orgId)
    .in('inbox_id', inboxIds)
    .gte('last_message_at', new Date(agora - JANELA_MS).toISOString())
    .order('last_message_at', { ascending: true })
    .limit(30)
  if (e2) throw e2

  const mensagens = new MessageRepository(supabase)

  for (const conv of (conversas ?? []) as ConversaCandidata[]) {
    if (r.sugeridas + r.enviadas + r.falhas >= MAX_POR_TIQUE || Date.now() > limite) break

    try {
      const historico = await mensagens.listByConversation({
        conversationId: conv.id, limit: LIMITE_HISTORICO,
      })
      const ultima = historico[0]
      if (!ultima || ultima.direction !== 'inbound') continue
      if (Date.parse(ultima.created_at) > agora - ESPERA_MS) continue

      const sugestao = (conv.ai_context?.sugestao ?? null) as { ultima?: string } | null
      if (sugestao?.ultima === ultima.id) continue
      r.candidatas++

      // Reivindica ANTES do turno: dois tiques podem se cruzar, e o UPDATE
      // condicional deixa só um passar. Gravado mesmo que o turno falhe — sem
      // isso uma falha da OpenAI repetiria a cada 10s até a conversa esfriar.
      if (!(await reivindicar(supabase, conv, sugestao?.ultima ?? null, ultima.id))) continue

      // As mensagens do paciente desde a última fala nossa viram o turno.
      const doTurno: string[] = []
      for (const m of historico) {
        if (m.direction !== 'inbound') break
        if (m.message_type !== 'reaction') doTurno.unshift(m.body ?? '')
      }
      const n = historico.findIndex(m => m.direction !== 'inbound')
      const qtdInbound = n === -1 ? historico.length : n
      if (doTurno.filter(t => t.trim()).length === 0) continue

      const { data: contato } = await db
        .from('contacts')
        .select('id, name, ai_memory')
        .eq('id', conv.contact_id)
        .maybeSingle()
      const c = contato as { id: string; name: string | null; ai_memory: unknown } | null

      const settings = await lerAgentSettings(supabase, orgId, conv.inbox_id)

      const contexto = montarContexto({
        systemPrompt: settings.system_prompt,
        memoriaContato: c?.ai_memory ?? null,
        nomeContato: c?.name ?? null,
        ficha: null,
        historico: historico.slice(qtdInbound),
        agoraISO: new Date().toISOString(),
        vagasOferecidas: null,
      })

      const ferramentas = new FerramentasAgente(
        createAppointmentSystemService(),
        new AppointmentRepository(supabase),
        { orgId, contactId: conv.contact_id, conversationId: conv.id },
      )

      const resultado = await executarTurno(
        { orgId, conversationId: conv.id, contactId: conv.contact_id, textosDoUsuario: doTurno },
        {
          provider: openAiProvider,
          ferramentas,
          contexto,
          agendamentoHabilitado: settings.ai_scheduling_enabled,
          somenteLeitura: true,
        },
      )

      if (resultado.tipo !== 'responder') {
        console.warn('[sugestao evolution] turno sem sugestão', {
          conversationId: conv.id, tipo: resultado.tipo,
          detalhe: 'detalhe' in resultado ? resultado.detalhe : null,
        })
        continue
      }

      // Falha de envio sobe para o catch: a mensagem fica como 'failed' na
      // conversa (MessageService) e a reivindicação impede repetir.
      if (automaticas.has(conv.inbox_id) && !conv.assigned_user_id) {
        await createSystemServices().messageService.send({
          conversationId: conv.id,
          body: resultado.texto,
          sentByAi: true,
        })
        r.enviadas++
        continue
      }

      const { error } = await db.from('messages').insert({
        organization_id: orgId,
        conversation_id: conv.id,
        direction: 'outbound',
        message_type: 'text',
        body: resultado.texto,
        provider: 'evolution',
        status: 'pending',
        sent_by_ai: true,
      })
      if (error) throw error
      r.sugeridas++
    } catch (err) {
      r.falhas++
      console.error('[sugestao evolution] falha', {
        conversationId: conv.id,
        motivo: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return r
}

async function reivindicar(
  supabase: SupabaseClient,
  conv: ConversaCandidata,
  anterior: string | null,
  ultimaId: string,
): Promise<boolean> {
  const novo = {
    ...(conv.ai_context ?? {}),
    sugestao: { ultima: ultimaId, em: new Date().toISOString() },
  }
  let q = supabase.schema('central').from('conversations')
    .update({ ai_context: novo })
    .eq('id', conv.id)
  q = anterior
    ? q.eq('ai_context->sugestao->>ultima', anterior)
    : q.is('ai_context->sugestao', null)
  const { data, error } = await q.select('id')
  if (error) throw error
  return (data ?? []).length > 0
}
