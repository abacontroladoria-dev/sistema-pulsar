import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { MessageRepository } from '../repositories/message.repository'
import { FunilMaiaService } from '../services/funil-maia.service'
import { openAiProvider } from '../llm/openai.provider'
import { LlmRateLimitError, LlmBudgetExceededError, LlmConfiguracaoError } from '../llm/erros'
import { falasParaStatus } from '../agente/status-atendimento'
import {
  decidirFunil,
  lerFunilDaConversa,
  precisaLeituraFunil,
  LeituraFunilInvalidaError,
} from '../agente/funil-leitura'

// ============================================================================
// Worker do funil — a Maia lendo em que coluna cada card está
//
// Roda no tique, depois do status. A regra da leitura é de
// agente/funil-leitura.ts; a do movimento, de crm.maia_mover_negocio. Aqui é
// só o laço: card aberto cuja conversa teve mensagem depois da última leitura
// (marca d'água funil_ia_ate) e 2 min de calma → uma chamada curta ao modelo
// → leitura gravada no card → movimento pedido, se a leitura for firme.
//
// Vale para todo número (Meta e Evolution) e para conversa conduzida pela
// equipe: o card anda pelo que a conversa mostra, não por quem respondeu.
//
// CHAVE CRM_FUNIL_IA
//
//   'aplicar' (padrão) — lê e move. Padrão desde a 1ª versão, a pedido do
//                        usuário (22/10), sem o dia de observação.
//   'observar'         — lê e grava funil_ia_*, não move card.
//   'desligado'        — não roda.
//
// As regras sem leitura (1ª presença → Atendimento, Nunca respondeu por
// prazo) são SQL no pg_cron (crm.funil_regras_do_sistema) e independem desta
// chave.
// ============================================================================

type Modo = 'observar' | 'aplicar' | 'desligado'

function modoDoAmbiente(): Modo {
  const v = process.env.CRM_FUNIL_IA
  return v === 'observar' || v === 'desligado' ? v : 'aplicar'
}

// Leituras (chamadas ao modelo) por tique. Cada card é lido uma vez por troca
// de mensagens: o teto só segura um pico — e a primeira passada pelos cards
// que nunca foram lidos.
const LEITURAS_POR_TIQUE = 5
const CARDS_EXAMINADOS = 400
const HISTORICO = 40
const ORCAMENTO_MS = 10_000

export interface ResultadoFunilWorker {
  modo:     Modo
  lidos:    number
  movidos:  number
  falhas:   number
  interrompido?: string
}

export async function processarFunil(
  supabase: SupabaseClient,
  orgId: string,
): Promise<ResultadoFunilWorker> {
  const modo = modoDoAmbiente()
  const r: ResultadoFunilWorker = { modo, lidos: 0, movidos: 0, falhas: 0 }
  if (modo === 'desligado') return r

  const limite = Date.now() + ORCAMENTO_MS
  const funil = new FunilMaiaService(supabase)
  const mensagens = new MessageRepository(supabase)

  const cards = await funil.listarAbertosParaLeitura(orgId, CARDS_EXAMINADOS)

  for (const card of cards) {
    if (Date.now() > limite || r.lidos >= LEITURAS_POR_TIQUE) break
    if (!precisaLeituraFunil(card, Date.now())) continue

    try {
      // A marca d'água é o last_message_at de ANTES da leitura: o que chegar
      // durante a chamada fica depois dela e pede outra leitura.
      const ate = card.last_message_at
      const historico = await mensagens.listByConversation({
        conversationId: card.conversationId, limit: HISTORICO, withAttachments: false,
      })
      const falas = falasParaStatus(historico)
      if (falas.length === 0) continue

      let leitura
      try {
        leitura = await lerFunilDaConversa(
          {
            falas,
            etapaAtual: card.etapa,
            trilha:     card.trilha,
            tags:       card.tags,
            agoraISO:   new Date().toISOString(),
          },
          openAiProvider,
        )
      } catch (err) {
        if (!(err instanceof LeituraFunilInvalidaError)) throw err
        // Resposta do modelo fora do formato: a marca d'água anda mesmo assim,
        // senão o mesmo card seria relido (e pago) a cada 10 segundos. Volta a
        // ser lido na próxima mensagem.
        await funil.gravarLeitura(card.id, {
          funil_ia_ate:       ate,
          funil_ia_etapa:     'manter',
          funil_ia_confianca: 0,
          funil_ia_motivo:    err.message.slice(0, 200),
          funil_ia_em:        new Date().toISOString(),
        })
        r.falhas++
        continue
      }
      await funil.gravarLeitura(card.id, {
        funil_ia_ate:       ate,
        funil_ia_etapa:     leitura.etapa,
        funil_ia_confianca: leitura.confianca,
        funil_ia_motivo:    leitura.motivo,
        funil_ia_em:        new Date().toISOString(),
      })
      r.lidos++

      if (modo !== 'aplicar') continue

      const decisao = decidirFunil(leitura)
      if (decisao.acao === 'nada') continue
      // 'nao_volta', 'ja_esta', 'trilha_diferente'... são a regra do funil
      // dizendo não — resposta normal, não falha.
      const resultado = await funil.mover(orgId, card.contactId, decisao.slug, decisao.motivo)
      if (resultado === 'movido') r.movidos++
    } catch (err) {
      // Cota, crédito ou chave: vale para todos os cards. Para o tique.
      if (
        err instanceof LlmRateLimitError
        || err instanceof LlmBudgetExceededError
        || err instanceof LlmConfiguracaoError
      ) {
        r.interrompido = err.message
        break
      }
      r.falhas++
      console.error('[worker funil] falha no card', {
        dealId: card.id,
        motivo: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return r
}
