import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createSentimentoSystemService } from '../services'
import { SentimentoRepository } from '../repositories/sentimento.repository'
import { ContactRepository } from '../repositories/contact.repository'
import { LlmRateLimitError, LlmBudgetExceededError, LlmConfiguracaoError } from '../llm/erros'

// ============================================================================
// Worker de sentimento — a leitura automática
//
// Roda no fim do tique, depois de agrupamento e envio. A ordem é a prioridade:
// responder o paciente vem antes de entender o paciente, e se o orçamento do
// tique acabar é esta etapa que deve ficar para o próximo.
//
// POR QUE AQUI E NÃO NO WEBHOOK
//
// A implementação que inspirou esta feature dispara a análise de dentro do
// webhook, com um `fetch` não-aguardado. Duas coisas quebram nesse desenho, e a
// segunda é silenciosa:
//
//   1. Trabalho não-aguardado pode ser morto quando a invocação termina. A
//      análise some sem rastro, e o sintoma é "às vezes não analisa".
//   2. O webhook do Pulsar tem UM trabalho — conferir o HMAC e enfileirar. Ele
//      responde à Meta, que reenvia o evento se demorar. Pendurar uma chamada
//      de LLM nesse caminho é pôr o modelo entre a Meta e o 200.
//
// O tique já existe, já tem orçamento de tempo, já é isolado por `tentar()` e
// já roda a cada ~10s. É o lugar.
//
// NÃO HÁ FILA AQUI, E É DE PROPÓSITO
//
// Fila serve para não perder trabalho. Perder uma leitura de sentimento não é
// perder nada: o próximo tique recalcula a mesma pergunta sobre o mesmo
// material e chega ao mesmo lugar. Uma fila aqui seria infraestrutura para um
// problema que não existe — e mais uma tabela para entupir.
// ============================================================================

// Quantos contatos analisar por tique. Este é O limitador de custo do caminho
// automático: um pico de mensagens não pode virar um pico de faturamento. Três
// a cada 10 segundos é teto de ~1000/hora, muito acima do movimento real da
// clínica, e mesmo assim contém uma anomalia.
const TETO_POR_TIQUE = 3

// Quantos contatos examinar antes de decidir quais analisar. A checagem é
// barata (uma contagem por contato), a análise é cara. Olhar 40 para escolher 3
// é o que evita analisar sempre os mesmos contatos ativos enquanto outros nunca
// chegam a vez.
const CANDIDATOS_EXAMINADOS = 40

// Janela de atividade que torna alguém candidato. 2 horas cobre folgado o
// intervalo entre tiques e absorve um worker parado por um deploy, sem varrer a
// base inteira a cada 10 segundos.
const ATIVIDADE_HORAS = 2

// Orçamento próprio, abaixo do que sobra no handler (que tem maxDuration 60 e
// já gastou até 45 com agrupamento e envio).
const ORCAMENTO_MS = 12_000

export interface ResultadoSentimento {
  examinados: number
  lidos:      number
  pulados:    number
  falhados:   number
  // Preenchido quando a varredura para por um motivo que vale para TODOS os
  // contatos, não só para o da vez.
  interrompido?: string
}

export async function processarSentimento(
  supabase: SupabaseClient,
  orgId: string,
): Promise<ResultadoSentimento> {
  const limite = Date.now() + ORCAMENTO_MS
  const r: ResultadoSentimento = { examinados: 0, lidos: 0, pulados: 0, falhados: 0 }

  const repo     = new SentimentoRepository(supabase)
  const contatos = new ContactRepository(supabase)
  const service  = createSentimentoSystemService()

  const desde = new Date(Date.now() - ATIVIDADE_HORAS * 3_600_000).toISOString()
  const candidatos = await repo.contatosComAtividadeDesde(orgId, desde, CANDIDATOS_EXAMINADOS)

  for (const contactId of candidatos) {
    if (Date.now() > limite || r.lidos >= TETO_POR_TIQUE) break

    r.examinados++

    try {
      if (!(await service.deveReanalisar(orgId, contactId))) {
        r.pulados++
        continue
      }

      const contato  = await contatos.findById(contactId)
      const desfecho = await service.analisar(orgId, contactId, 'auto', contato?.name ?? null)

      if (desfecho.tipo === 'lida') r.lidos++
      else                          r.pulados++
    } catch (err) {
      // Três erros valem para a organização inteira, não para este contato:
      // insistir nos outros 39 reproduz a mesma falha 39 vezes — e no caso do
      // orçamento, gasta o que não existe. Parar aqui e deixar para o próximo
      // tique é a reação correta nos três.
      if (
        err instanceof LlmRateLimitError
        || err instanceof LlmBudgetExceededError
        || err instanceof LlmConfiguracaoError
      ) {
        r.interrompido = err.message
        break
      }

      // O resto é falha deste contato (material estranho, resposta ilegível do
      // modelo, linha recusada por CHECK). Registrar e seguir: um contato com
      // histórico esquisito não pode impedir a leitura de todos os outros.
      r.falhados++
      console.error('[worker sentimento] falha ao ler contato', {
        contactId,
        motivo: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return r
}
