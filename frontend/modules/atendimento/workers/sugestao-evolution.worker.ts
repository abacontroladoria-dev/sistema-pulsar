import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createAppointmentSystemService, createSystemServices } from '../services'
import { MessageRepository } from '../repositories/message.repository'
import { AppointmentRepository } from '../repositories/appointment.repository'
import { AuditRepository } from '../repositories/audit.repository'
import { TagDefinitionRepository } from '../repositories/tag-definition.repository'
import { montarContexto, LIMITE_HISTORICO } from '../agente/contexto'
import { montarFerramentaRegistrarTags } from '../agente/tags'
import { executarTurno } from '../agente/orquestrador'
import { FerramentasAgente } from '../agente/ferramentas'
import { openAiProvider } from '../llm/openai.provider'
import { lerAgentSettings } from '../agente/agent-settings'
import { CHAVE_MAIA_TRANSFERIU, maiaTransferiu } from '../agente/caixas'
import { TEXTO_ESCALADA_FALLBACK, TEXTO_SEM_AGENDAMENTO_NO_NUMERO, prometeAgendamento } from '../agente/entrega'
import type { TagDefinition } from '../types/central.types'

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
// Por conversa, a chave Maia / Humano do cabeçalho (14/10) liga e desliga a
// mesma marca de transferida; gente que responde — pela tela ou pelo celular
// do número — vira a chave para Humano sozinha (maiaSaiQuandoHumanoResponde).
// Em Humano a Maia não some: volta ao rascunho, com a instrução de venda
// (sugestaoParaAtendente), e cada sugestão nova substitui a anterior.
//
// Agendar ela não pode. Quando a pessoa quer marcar, a Maia avisa e transfere
// para um atendente (pedido do usuário em 13/10): `escalar_para_humano` grava
// a marca de transferida na conversa (maiaTransferiu) — o worker deixa de
// responder ali. Turno que termina sem texto também transfere, com o aviso
// fixo: antes ele só ia para o log, e a reivindicação impedia nova tentativa —
// silêncio permanente. Texto que diga que agendou (prometeAgendamento) também
// transfere e vira aviso fixo.
//
// As únicas ferramentas de escrita liberadas onde ela envia são essa e
// `registrar_tags` (14/10): sem a de tags, nenhuma conversa do número ganhava
// classificação (Mateus, 13/10). No rascunho, nenhuma das duas.
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

  // Catálogo para `registrar_tags`, só onde ela envia. Lido uma vez por tique.
  // Falha isolada, como no worker da Meta: sem catálogo o turno sai sem a
  // ferramenta de classificação, não sem resposta.
  let porGrupoTags: Map<string, TagDefinition[]> | null = null
  if (automaticas.size > 0) {
    try {
      porGrupoTags = await new TagDefinitionRepository(supabase).porGrupo(orgId)
    } catch (err) {
      console.warn('[sugestao evolution] catálogo de tags indisponível; turnos sem classificação', err)
    }
  }

  for (const conv of (conversas ?? []) as ConversaCandidata[]) {
    if (r.sugeridas + r.enviadas + r.falhas >= MAX_POR_TIQUE || Date.now() > limite) break
    // Transferida para um atendente (chave em Humano): a conversa é de gente,
    // e a Maia volta ao rascunho — sugere o texto para a atendente (14/10).
    const transferida = maiaTransferiu(conv.ai_context)
    // Ela ENVIA só no número com "Maia responde" e em conversa não
    // transferida; em todo o resto, sugere.
    const automatica = automaticas.has(conv.inbox_id) && !transferida
    // A reivindicação deste turno; o catch precisa dela para agendar a retentativa.
    let marca: MarcaSugestao | null = null

    try {
      // Resposta da Maia que não saiu (status 'failed') não conta como resposta:
      // sem este filtro ela vira a "última mensagem" e a pessoa nunca mais é
      // atendida. Continua na conversa, visível como falha.
      //
      // Rascunho não enviado também sai: o paciente nunca o leu, e no
      // histórico ele passaria por fala da clínica. A volta à mesma mensagem
      // quem impede é a reivindicação (sugestao.ultima), não o rascunho.
      const historico = (await mensagens.listByConversation({
        conversationId: conv.id, limit: LIMITE_HISTORICO,
      })).filter(m => !(m.direction === 'outbound' && m.sent_by_ai
        && (m.status === 'failed' || (m.status === 'pending' && !m.external_message_id))))
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
      marca = await reivindicar(supabase, conv, sugestao?.em ?? null, ultima.id, tentativa, transferida)
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
        // Rascunho: quem envia é a atendente, e o texto é para converter.
        sugestaoParaAtendente: !automatica,
      })

      // Classificação só onde ela envia: no rascunho quem atende é a atendente.
      const catalogoTags = automatica ? porGrupoTags : null

      const ferramentas = new FerramentasAgente(
        createAppointmentSystemService(),
        new AppointmentRepository(supabase),
        { orgId, contactId: conv.contact_id, conversationId: conv.id, maiaRespondeNoNumero: automatica },
        // Para `escalar_para_humano`, só onde ela envia. No rascunho quem
        // responde já é gente — não há de quem transferir.
        automatica ? conversationService : null,
        null,
        // Para `registrar_tags` — validação e merge por grupo usam o mesmo
        // catálogo que monta o schema abaixo.
        catalogoTags,
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
          ferramentaTags: catalogoTags ? montarFerramentaRegistrarTags(catalogoTags) : undefined,
          permitirTags: catalogoTags !== null,
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
        // O turno leva segundos. Se nesse tempo alguém virou a chave para
        // Humano ou respondeu (maiaSaiQuandoHumanoResponde), nada sai — nem o
        // aviso de transferência: já tem gente na conversa. A transferência que
        // a própria Maia pediu neste turno também grava a marca, e o aviso dela
        // precisa sair — por isso o escaladaPedida.
        if (!ferramentas.escaladaPedida() && await humanoAssumiu(supabase, conv.id)) {
          console.warn('[sugestao evolution] humano assumiu durante o turno; resposta descartada', {
            conversationId: conv.id,
          })
          continue
        }
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

      // A atendente respondeu enquanto o turno rodava: a sugestão já nasceu
      // velha.
      const { data: respondida, error: eResp } = await db.from('messages')
        .select('id')
        .eq('conversation_id', conv.id)
        .eq('direction', 'outbound')
        .eq('sent_by_ai', false)
        .gt('created_at', ultima.created_at)
        .limit(1)
      if (eResp) throw eResp
      if ((respondida ?? []).length > 0) continue

      // Uma sugestão viva por conversa: a anterior respondia a mensagens que
      // esta já cobre (o turno junta tudo desde a última fala enviada).
      const { error: eVelhas } = await db.from('messages')
        .update({ deleted_at: new Date().toISOString() })
        .eq('conversation_id', conv.id)
        .eq('direction', 'outbound')
        .eq('sent_by_ai', true)
        .eq('status', 'pending')
        .is('external_message_id', null)
        .is('deleted_at', null)
      if (eVelhas) throw eVelhas

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
  transferida: boolean,
): Promise<MarcaSugestao | null> {
  const marca: MarcaSugestao = { ultima: ultimaId, em: new Date().toISOString(), tentativa }
  const novo = { ...(conv.ai_context ?? {}), sugestao: marca }
  // A chave Maia / Humano precisa estar como foi lida: o `novo` sai da cópia do
  // começo do tique, e uma virada nesse meio-tempo seria desfeita por este
  // UPDATE (a marca de transferida apagada, ou ressuscitada).
  const chave = `ai_context->${CHAVE_MAIA_TRANSFERIU}`
  let q = supabase.schema('central').from('conversations')
    .update({ ai_context: novo })
    .eq('id', conv.id)
  q = transferida ? q.not(chave, 'is', null) : q.is(chave, null)
  q = emAnterior
    ? q.eq('ai_context->sugestao->>em', emAnterior)
    : q.is('ai_context->sugestao', null)
  const { data, error } = await q.select('id')
  if (error) throw error
  return (data ?? []).length > 0 ? marca : null
}

async function humanoAssumiu(supabase: SupabaseClient, conversationId: string): Promise<boolean> {
  const { data, error } = await supabase.schema('central').from('conversations')
    .select('ai_context').eq('id', conversationId).maybeSingle()
  if (error) throw error
  return maiaTransferiu((data as { ai_context: unknown } | null)?.ai_context)
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
