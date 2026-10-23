import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { MessageRepository } from '../repositories/message.repository'
import { FunilMaiaService } from '../services/funil-maia.service'
import { openAiProvider } from '../llm/openai.provider'
import { LlmRateLimitError, LlmBudgetExceededError, LlmConfiguracaoError } from '../llm/erros'
import { ESPERA_PARA_LER_MS, falasParaStatus } from '../agente/status-atendimento'
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
// que nunca foram lidos. O banco devolve só quem precisa de leitura
// (crm.funil_cards_para_ler); a folga além do teto cobre os cards que saem
// sem chamada (conversa só com áudio ou foto).
const LEITURAS_POR_TIQUE = 5
const CARDS_POR_TIQUE = 10
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

  const cards = await funil.listarParaLeitura(orgId, CARDS_POR_TIQUE, ESPERA_PARA_LER_MS)

  for (const card of cards) {
    if (Date.now() > limite || r.lidos >= LEITURAS_POR_TIQUE) break
    // O banco já filtrou; isto só protege de um relógio diferente entre ele e
    // o servidor.
    if (!precisaLeituraFunil(card, Date.now())) continue

    try {
      // A marca d'água é o last_message_at de ANTES da leitura: o que chegar
      // durante a chamada fica depois dela e pede outra leitura.
      const ate = card.last_message_at
      const historico = await mensagens.listByConversation({
        conversationId: card.conversationId, limit: HISTORICO,  // com anexos: a transcrição do áudio entra na leitura
      })
      const falas = falasParaStatus(historico)
      // Só áudio, foto ou figurinha: nada para ler. A marca anda, senão o
      // mesmo card voltaria em todo tique e tomaria o lugar dos outros.
      if (falas.length === 0) {
        await funil.avancarMarca(card.id, ate)
        continue
      }

      // Conta antes da chamada: leitura inválida também gasta o modelo.
      r.lidos++
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
        // Resposta do modelo fora do formato: só a marca d'água anda (senão o
        // card seria relido, e pago, a cada 10 segundos). A última leitura
        // válida fica como estava; volta a ler na próxima mensagem.
        await funil.avancarMarca(card.id, ate)
        r.falhas++
        console.error('[worker funil] leitura inválida', { dealId: card.id, motivo: err.message })
        continue
      }

      // Mover ANTES de gravar a leitura: a gravação leva a marca d'água, e com
      // ela gravada primeiro uma falha do movimento só seria refeita na
      // próxima mensagem. Assim, se mover falhar, o card é relido no tique
      // seguinte. 'nao_volta', 'ja_esta', 'trilha_diferente'... são a regra
      // do funil dizendo não — resposta normal, não falha.
      if (modo === 'aplicar') {
        const decisao = decidirFunil(leitura)
        if (decisao.acao === 'mover') {
          const resultado = await funil.mover(orgId, card.contactId, decisao.slug, decisao.motivo)
          if (resultado === 'movido') r.movidos++
        }
      }

      await funil.gravarLeitura(card.id, {
        funil_ia_ate:       ate,
        funil_ia_etapa:     leitura.etapa,
        funil_ia_confianca: leitura.confianca,
        funil_ia_motivo:    leitura.motivo,
        funil_ia_em:        new Date().toISOString(),
      })
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
