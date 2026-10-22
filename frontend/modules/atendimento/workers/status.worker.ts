import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createSystemServices, createNotaInternaSystemService } from '../services'
import { ConversationRepository } from '../repositories/conversation.repository'
import { MessageRepository } from '../repositories/message.repository'
import { openAiProvider } from '../llm/openai.provider'
import { LlmRateLimitError, LlmBudgetExceededError, LlmConfiguracaoError } from '../llm/erros'
import type { Conversation } from '../types/central.types'
import {
  decidirStatus,
  falasParaStatus,
  lerStatusDaConversa,
  precisaLeitura,
  textoNotaParada,
} from '../agente/status-atendimento'

// ============================================================================
// Worker de status — a Maia lendo em que pé cada conversa está
//
// Roda no tique, depois das respostas (agrupamento, envio, sugestão) e antes do
// sentimento. A regra é toda de agente/status-atendimento.ts; aqui é só o laço:
//
//   1. LER: conversa ativa com mensagem que a Maia ainda não leu (marca d'água
//      status_ia_ate) e 2 min de calma. Uma chamada curta ao modelo; o
//      veredito fica nas colunas status_ia_*.
//   2. APLICAR: com o veredito em dia, decidirStatus diz o que fazer — mover
//      entre Em atendimento e Aguardando, encerrar (2h de silêncio) ou avisar
//      a equipe da conversa parada (24h). Sem modelo: é o mesmo veredito
//      esperando o tempo passar.
//
// CHAVE CENTRAL_STATUS_IA
//
//   'aplicar' (padrão) — faz tudo. Padrão desde 22/10, a pedido do usuário,
//                        sem o dia de observação.
//   'observar'         — lê e grava o veredito, não mexe no status nem
//                        escreve nota. Para medir sem agir.
//   'desligado'        — não roda.
//
// Os fatos do ciclo (Maia escalou, gente respondeu, chave Maia/Humano) movem
// o status na hora pelo ConversationService e independem desta chave.
// ============================================================================

type Modo = 'observar' | 'aplicar' | 'desligado'

function modoDoAmbiente(): Modo {
  const v = process.env.CENTRAL_STATUS_IA
  return v === 'observar' || v === 'desligado' ? v : 'aplicar'
}

// Leituras (chamadas ao modelo) por tique. Cada conversa é lida uma vez por
// troca de mensagens, não por tique: o teto só segura um pico.
const LEITURAS_POR_TIQUE = 5
// Até onde olhar para trás. Parada de 24h precisa da conversa que ficou
// quieta ontem; uma semana cobre fim de semana e feriado.
const JANELA_DIAS = 7
// Conversas examinadas por tique. Ativas são ~150 hoje; o exame é em memória.
const CONVERSAS_EXAMINADAS = 400
const HISTORICO = 40
const ORCAMENTO_MS = 10_000

export interface ResultadoStatus {
  modo:      Modo
  lidas:     number
  aplicadas: number
  avisos:    number
  falhas:    number
  interrompido?: string
}

export async function processarStatus(
  supabase: SupabaseClient,
  orgId: string,
): Promise<ResultadoStatus> {
  const modo = modoDoAmbiente()
  const r: ResultadoStatus = { modo, lidas: 0, aplicadas: 0, avisos: 0, falhas: 0 }
  if (modo === 'desligado') return r

  const limite = Date.now() + ORCAMENTO_MS
  const repo = new ConversationRepository(supabase)
  const mensagens = new MessageRepository(supabase)
  const { conversationService } = createSystemServices()

  const desde = new Date(Date.now() - JANELA_DIAS * 86_400_000).toISOString()
  const conversas = await repo.listarAtivasParaStatus(orgId, desde, CONVERSAS_EXAMINADAS)
  let podeLer = true

  for (const original of conversas) {
    if (Date.now() > limite) break
    let conv: Conversation = original
    const agora = Date.now()

    try {
      // 1. Ler
      if (podeLer && r.lidas < LEITURAS_POR_TIQUE && precisaLeitura(conv, agora)) {
        // A marca d'água é o last_message_at de ANTES da leitura: o que chegar
        // durante a chamada fica depois dela e pede outra leitura.
        const ate = conv.last_message_at
        const historico = await mensagens.listByConversation({
          conversationId: conv.id, limit: HISTORICO, withAttachments: false,
        })
        const falas = falasParaStatus(historico)
        if (falas.length > 0) {
          const leitura = await lerStatusDaConversa(
            { falas, faseMaia: conv.status === 'self_service', agoraISO: new Date(agora).toISOString() },
            openAiProvider,
          )
          const colunas = {
            status_ia_ate:       ate,
            status_ia_veredito:  leitura.situacao,
            status_ia_confianca: leitura.confianca,
            status_ia_motivo:    leitura.motivo,
            status_ia_pendencia: leitura.pendencia,
            status_ia_em:        new Date().toISOString(),
            // Leitura nova = episódio novo: a nota de parada pode sair de novo.
            status_ia_alerta_em: null,
          }
          await repo.gravarLeituraStatus(conv.id, colunas)
          conv = { ...conv, ...colunas }
          r.lidas++
        }
      }

      if (modo !== 'aplicar') continue

      // 2. Aplicar
      const decisao = decidirStatus(conv, Date.now())
      if (decisao.acao === 'nada') continue

      if (decisao.acao === 'avisar_parada') {
        await avisarParada(supabase, orgId, conv, decisao.horasParada, conversationService, repo)
        r.avisos++
        continue
      }

      await conversationService.aplicarStatusDaMaia(conv.id, decisao.para, decisao.motivo)
      r.aplicadas++
    } catch (err) {
      // Cota, crédito ou chave: vale para todas as conversas. Para de LER e
      // segue aplicando — aplicar não chama o modelo.
      if (
        err instanceof LlmRateLimitError
        || err instanceof LlmBudgetExceededError
        || err instanceof LlmConfiguracaoError
      ) {
        podeLer = false
        r.interrompido = err.message
        continue
      }
      r.falhas++
      console.error('[worker status] falha na conversa', {
        conversationId: conv.id,
        motivo: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return r
}

// Aguardando parado há 24h: nunca fecha. Nota interna explicando o que ficou
// pendente e a conversa vai para a equipe — com a Maia, ela transfere; com
// responsável, a nota o menciona (aparece em "Menções a mim"); sem
// responsável, volta para Aberto.
async function avisarParada(
  supabase: SupabaseClient,
  orgId: string,
  conv: Conversation,
  horasParada: number,
  conversationService: ReturnType<typeof createSystemServices>['conversationService'],
  repo: ConversationRepository,
): Promise<void> {
  const faseMaia = conv.status === 'self_service'

  const { data: canal } = await supabase
    .schema('central')
    .from('channels')
    .select('provider')
    .eq('id', conv.channel_id)
    .maybeSingle()

  const texto = textoNotaParada({
    veredito:    conv.status_ia_veredito!,
    motivo:      conv.status_ia_motivo ?? null,
    pendencia:   conv.status_ia_pendencia ?? null,
    horasParada,
    faseMaia,
    canalMeta:   (canal as { provider?: string } | null)?.provider === 'meta_waba',
  })
  const mencoes = !faseMaia && conv.assigned_user_id ? [conv.assigned_user_id] : []

  await createNotaInternaSystemService().criarPelaMaia(orgId, conv.id, texto, mencoes)
  // Logo depois da nota: se a transferência abaixo falhar, o próximo tique não
  // escreve a mesma nota de novo.
  await repo.marcarAlertaParada(conv.id, new Date().toISOString())

  if (faseMaia) {
    const motivo = 'inatividade'
    if (await repo.inboxMaiaAutomatica(conv.inbox_id)) {
      await conversationService.transferirDoMaiaResponde(conv.id, motivo, 'inatividade')
    } else {
      await conversationService.escalarParaAtendimentoHumano(conv.id, motivo, 'inatividade')
    }
  } else if (!conv.assigned_user_id && conv.status !== 'open') {
    await conversationService.aplicarStatusDaMaia(
      conv.id, 'open', `Parada há ${horasParada}h; voltou para a fila da equipe`,
    )
  }
}
