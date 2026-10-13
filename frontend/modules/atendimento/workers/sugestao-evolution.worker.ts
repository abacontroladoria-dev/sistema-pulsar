import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createAppointmentSystemService, createSystemServices } from '../services'
import { MessageRepository } from '../repositories/message.repository'
import { AppointmentRepository } from '../repositories/appointment.repository'
import { AuditRepository } from '../repositories/audit.repository'
import { montarContexto, LIMITE_HISTORICO } from '../agente/contexto'
import { executarTurno } from '../agente/orquestrador'
import { FerramentasAgente } from '../agente/ferramentas'
import { openAiProvider } from '../llm/openai.provider'
import { lerAgentSettings } from '../agente/agent-settings'
import { maiaTransferiu } from '../agente/caixas'
import { TEXTO_ESCALADA_FALLBACK, TEXTO_SEM_AGENDAMENTO_NO_NUMERO, prometeAgendamento } from '../agente/entrega'

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
// pelo envio normal em vez de virar rascunho, em TODAS as conversas do número
// (atribuída ou não — pedido do usuário em 08/10). Continua somenteLeitura e
// continua sem ai_mode.
//
// Agendar ela não pode. Quando a pessoa quer marcar, a Maia avisa e transfere
// para um atendente (pedido do usuário em 13/10): `escalar_para_humano` é a
// única ferramenta de escrita liberada, e grava a marca de transferida na
// conversa (maiaTransferiu) — o worker deixa de responder ali. Turno que
// termina sem texto também transfere, com o aviso fixo: antes ele só ia para o
// log, e a reivindicação impedia nova tentativa — silêncio permanente. Texto
// que diga que agendou (prometeAgendamento) também transfere e vira aviso fixo.
//
// Falha não é definitiva (13/10): erro de envio, da OpenAI ou limite de uso
// agenda nova tentativa da mesma mensagem (1 min, depois 5 min); esgotadas,
// a conversa vai para um atendente. Resposta da Maia com status 'failed' não
// conta como resposta.
// ============================================================================

// Curto: divide o maxDuration de 60s do tique com agrupamento e envio.
const ORCAMENTO_MS = 12_000
const ESPERA_MS = 15_000           // a pessoa terminar de escrever
// Conversa parada há mais que isso não ganha resposta. Era 30 min: worker fora
// do ar por meia hora (deploy, Evolution reconectando) deixava quem escreveu
// nesse intervalo sem resposta para sempre. 6 h cobre a queda e não ressuscita
// conversa do dia anterior.
const JANELA_MS = 6 * 3_600_000
// Quantas conversas da janela olhar por tique. A maioria já foi respondida e só
// custa a leitura; com 30 e a janela de 6 h, as novas ficavam de fora.
const CONVERSAS_POR_TIQUE = 200
const MAX_POR_TIQUE = 3
// Falha (envio, OpenAI, limite de uso) não encerra a tentativa: a mesma
// mensagem volta depois destas esperas. Esgotadas, a conversa vai para gente.
const ESPERAS_RETENTATIVA_MS = [60_000, 5 * 60_000]
const MAX_TENTATIVAS = ESPERAS_RETENTATIVA_MS.length + 1

// A marca em `ai_context.sugestao`. `em` é o carimbo da reivindicação — único
// por tentativa, é a condição do UPDATE que impede dois tiques no mesmo turno.
interface MarcaSugestao {
  ultima?: string
  em?: string
  tentativa?: number
  // Presente só depois de falha com tentativa sobrando.
  retentarApos?: string
}

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
    .select('id, inbox_id, contact_id, ai_context')
    .eq('organization_id', orgId)
    .in('inbox_id', inboxIds)
    .gte('last_message_at', new Date(agora - JANELA_MS).toISOString())
    .order('last_message_at', { ascending: true })
    .limit(CONVERSAS_POR_TIQUE)
  if (e2) throw e2

  const mensagens = new MessageRepository(supabase)
  const auditoria = new AuditRepository(supabase)
  const { conversationService, messageService } = createSystemServices()

  for (const conv of (conversas ?? []) as ConversaCandidata[]) {
    if (r.sugeridas + r.enviadas + r.falhas >= MAX_POR_TIQUE || Date.now() > limite) break
    // Transferida para um atendente: a conversa é de gente até ser encerrada.
    if (maiaTransferiu(conv.ai_context)) continue
    const automatica = automaticas.has(conv.inbox_id)
    // A reivindicação deste turno; o catch precisa dela para agendar a retentativa.
    let marca: MarcaSugestao | null = null

    try {
      // Resposta da Maia que não saiu (status 'failed') não conta como resposta:
      // sem este filtro ela vira a "última mensagem" e a pessoa nunca mais é
      // atendida. Continua na conversa, visível como falha.
      const historico = (await mensagens.listByConversation({
        conversationId: conv.id, limit: LIMITE_HISTORICO,
      })).filter(m => !(m.direction === 'outbound' && m.sent_by_ai && m.status === 'failed'))
      const ultima = historico[0]
      if (!ultima || ultima.direction !== 'inbound') continue
      if (Date.parse(ultima.created_at) > agora - ESPERA_MS) continue

      const sugestao = (conv.ai_context?.sugestao ?? null) as MarcaSugestao | null
      let tentativa = 1
      if (sugestao?.ultima === ultima.id) {
        // Já tentada: só volta se a falha deixou retentativa marcada e venceu.
        if (!sugestao.retentarApos || Date.parse(sugestao.retentarApos) > Date.now()) continue
        tentativa = (sugestao.tentativa ?? 1) + 1
      }
      r.candidatas++

      // Reivindica ANTES do turno: dois tiques podem se cruzar, e o UPDATE
      // condicional deixa só um passar. Falha não libera na hora — agenda a
      // retentativa com espera (sem ela, uma OpenAI fora repetiria a cada 10s).
      marca = await reivindicar(supabase, conv, sugestao?.em ?? null, ultima.id, tentativa)
      if (!marca) continue

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
        semAgendamento: automatica,
      })

      const ferramentas = new FerramentasAgente(
        createAppointmentSystemService(),
        new AppointmentRepository(supabase),
        { orgId, contactId: conv.contact_id, conversationId: conv.id, maiaRespondeNoNumero: automatica },
        // Para `escalar_para_humano`, só onde ela envia. No rascunho quem
        // responde já é gente — não há de quem transferir.
        automatica ? conversationService : null,
      )

      const resultado = await executarTurno(
        { orgId, conversationId: conv.id, contactId: conv.contact_id, textosDoUsuario: doTurno },
        {
          provider: openAiProvider,
          ferramentas,
          contexto,
          agendamentoHabilitado: settings.ai_scheduling_enabled,
          somenteLeitura: true,
          permitirEscalada: automatica,
          // O mesmo rastro do worker da Meta. Sem ele, desde 30/09 nenhuma
          // consulta da Maia ficava registrada: em 13/10 ela respondeu "houve um
          // erro ao buscar os horários" e não havia como saber o que a
          // ferramenta devolveu. Fire-and-forget: insert nunca rejeita.
          aoChamarFerramenta: (registro) => {
            void auditoria.insert({
              organization_id: orgId,
              conversation_id: conv.id,
              event_type:      'ai.tool_call',
              payload:         { ...registro },
            })
          },
        },
      )

      // Limite de uso da OpenAI é passageiro: volta para a vez em vez de
      // transferir na primeira. Na última tentativa segue o caminho de baixo.
      if (resultado.tipo === 'aguardar' && !ferramentas.escaladaPedida() && tentativa < MAX_TENTATIVAS) {
        await agendarRetentativa(supabase, conv.id, marca)
        r.falhas++
        console.warn('[sugestao evolution] turno adiado; nova tentativa agendada', {
          conversationId: conv.id, tentativa, detalhe: resultado.detalhe ?? null,
        })
        continue
      }

      // Falha de envio sobe para o catch: a mensagem fica como 'failed' na
      // conversa (MessageService) e o catch agenda a retentativa.
      if (automatica) {
        let texto = resultado.tipo === 'responder' ? resultado.texto : null
        if (!texto) {
          // A reivindicação já impede outra tentativa: sem isto a pessoa fica
          // sem resposta para sempre. Transfere (se a ferramenta ainda não o
          // fez) e manda o aviso fixo — o modelo é que falhou aqui.
          if (!ferramentas.escaladaPedida()) {
            await conversationService.transferirDoMaiaResponde(
              conv.id, resultado.tipo === 'escalar' ? resultado.motivo : 'aguardar', 'falha_tecnica',
            )
          }
          texto = TEXTO_ESCALADA_FALLBACK
          console.warn('[sugestao evolution] turno sem resposta; transferida para atendente', {
            conversationId: conv.id, tipo: resultado.tipo,
            detalhe: 'detalhe' in resultado ? resultado.detalhe : null,
          })
        } else if (prometeAgendamento(texto)) {
          // Ela não agenda aqui: texto que diz que agendou é falso (Ana, 13/10).
          // Quem tentou marcar quer marcar — transfere e troca pelo aviso fixo.
          if (!ferramentas.escaladaPedida()) {
            await conversationService.transferirDoMaiaResponde(conv.id, 'fora_do_alcance', 'falha_tecnica')
          }
          console.warn('[sugestao evolution] texto prometia agendamento; trocado pelo aviso', {
            conversationId: conv.id, texto,
          })
          texto = TEXTO_SEM_AGENDAMENTO_NO_NUMERO
        }
        await messageService.send({ conversationId: conv.id, body: texto, sentByAi: true })
        r.enviadas++
        continue
      }

      if (resultado.tipo !== 'responder') {
        console.warn('[sugestao evolution] turno sem sugestão', {
          conversationId: conv.id, tipo: resultado.tipo,
          detalhe: 'detalhe' in resultado ? resultado.detalhe : null,
        })
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
      const tentativa = marca?.tentativa ?? 1
      console.error('[sugestao evolution] falha', {
        conversationId: conv.id, tentativa,
        motivo: err instanceof Error ? err.message : String(err),
      })
      // Sem marca a falha foi antes de reivindicar: o próximo tique tenta sozinho.
      if (!marca) continue
      try {
        if (tentativa < MAX_TENTATIVAS) {
          await agendarRetentativa(supabase, conv.id, marca)
        } else if (automatica) {
          // Esgotou: a pessoa não pode ficar sem ninguém. Vai para a caixa de
          // gente; o aviso fixo não vai junto porque o envio é o que costuma
          // estar falhando.
          await conversationService.transferirDoMaiaResponde(conv.id, 'aguardar', 'falha_tecnica')
        }
      } catch (err2) {
        console.error('[sugestao evolution] falha ao tratar a falha', {
          conversationId: conv.id,
          motivo: err2 instanceof Error ? err2.message : String(err2),
        })
      }
    }
  }

  return r
}

// Devolve a marca gravada, ou null se outro tique chegou antes. A condição é o
// carimbo `em` da marca anterior (ou a ausência de marca).
async function reivindicar(
  supabase: SupabaseClient,
  conv: ConversaCandidata,
  emAnterior: string | null,
  ultimaId: string,
  tentativa: number,
): Promise<MarcaSugestao | null> {
  const marca: MarcaSugestao = { ultima: ultimaId, em: new Date().toISOString(), tentativa }
  const novo = { ...(conv.ai_context ?? {}), sugestao: marca }
  let q = supabase.schema('central').from('conversations')
    .update({ ai_context: novo })
    .eq('id', conv.id)
  q = emAnterior
    ? q.eq('ai_context->sugestao->>em', emAnterior)
    : q.is('ai_context->sugestao', null)
  const { data, error } = await q.select('id')
  if (error) throw error
  return (data ?? []).length > 0 ? marca : null
}

// Deixa a mesma mensagem voltar depois da espera da tentativa. Relê o
// ai_context (o turno pode ter gravado a transferência nele) e só grava se a
// marca ainda for a deste turno.
async function agendarRetentativa(
  supabase: SupabaseClient,
  conversationId: string,
  marca: MarcaSugestao,
): Promise<void> {
  const db = supabase.schema('central')
  const { data, error } = await db.from('conversations')
    .select('ai_context').eq('id', conversationId).maybeSingle()
  if (error) throw error
  const atual = ((data as { ai_context: Record<string, unknown> | null } | null)?.ai_context) ?? {}
  const espera = ESPERAS_RETENTATIVA_MS[(marca.tentativa ?? 1) - 1] ?? ESPERAS_RETENTATIVA_MS.at(-1)!
  const { error: e2 } = await db.from('conversations')
    .update({ ai_context: { ...atual, sugestao: { ...marca, retentarApos: new Date(Date.now() + espera).toISOString() } } })
    .eq('id', conversationId)
    .eq('ai_context->sugestao->>em', marca.em!)
  if (e2) throw e2
}
