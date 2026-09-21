import type { SentimentoRepository } from '../repositories/sentimento.repository'
import type { AuditRepository } from '../repositories/audit.repository'
import type { LLMProvider } from '../llm/tipos'
import type {
  ContactSentimentReading,
  LeituraSentimento,
  SentimentTrigger,
} from '../types/central.types'
import { lerSentimento, JANELA_DIAS, MINIMO_MENSAGENS } from '../agente/sentimento'

// ============================================================================
// SentimentoService
//
// Decide QUANDO ler e grava o que o modelo disse. O prompt mora em
// agente/sentimento.ts; a leitura do banco, no repositório.
//
// Quantas mensagens novas do contato justificam uma leitura nova. Três é o
// mesmo número do mínimo para a primeira: abaixo disso não mudou o suficiente
// para a inclinação ter mudado, e cada análise custa uma chamada ao modelo.
//
// Este número é o ÚNICO limitador de custo do caminho automático — não há
// debounce nem cron dedicado. Baixá-lo para 1 faria toda mensagem pagar uma
// leitura.
// ============================================================================
const MENSAGENS_PARA_REANALISE = 3

// Leitura com mais de 7 dias é tratada como vencida pelo gatilho automático,
// mesmo sem mensagens novas suficientes. O motivo não é o tempo em si: é que a
// tela mostra "há X dias" e uma leitura de três semanas se parece com uma de
// hoje para quem bate o olho. Vencer devagar é melhor que envelhecer calado.
const VALIDADE_DIAS = 7

export interface DesfechoAnalise {
  // 'lida'      — houve chamada ao modelo e uma linha nova
  // 'material_insuficiente' — menos de MINIMO_MENSAGENS na janela; nada cobrado
  tipo:    'lida' | 'material_insuficiente'
  leitura?: ContactSentimentReading
  detalhe?: string
}

export class SentimentoService {
  constructor(
    private readonly repo: SentimentoRepository,
    private readonly provider: LLMProvider,
    private readonly audit: AuditRepository,
  ) {}

  // A leitura atual e a anterior. `anterior` é o que desenha a tendência, e vem
  // null na primeira leitura de um contato — o painel então não mostra
  // movimento, em vez de afirmar "estável" a partir de uma amostra só.
  async buscar(orgId: string, contactId: string): Promise<LeituraSentimento> {
    const linhas = await this.repo.duasUltimas(orgId, contactId)
    return {
      atual:    linhas[0] ?? null,
      anterior: linhas[1] ?? null,
    }
  }

  // ------------------------------------------------------------------------
  // A regra do gatilho automático.
  //
  // Separada de `analisar` de propósito: é barata (uma contagem) e roda para
  // vários contatos por tique, enquanto `analisar` é cara e roda para poucos.
  // Juntá-las faria o worker pagar uma chamada ao modelo para descobrir que não
  // precisava tê-la feito.
  // ------------------------------------------------------------------------
  async deveReanalisar(orgId: string, contactId: string): Promise<boolean> {
    const { atual } = await this.buscar(orgId, contactId)

    // Nunca lido. A guarda de material insuficiente ainda vale e é aplicada em
    // `analisar` — aqui só se decide que vale a pena tentar.
    if (!atual) return true

    const idadeDias = (Date.now() - new Date(atual.created_at).getTime()) / 86_400_000
    if (idadeDias >= VALIDADE_DIAS) return true

    // A marca d'água, nunca o `created_at` da linha. Ver o comentário da coluna
    // `last_message_at` na migration 20260921100000: contar contra `created_at`
    // recontaria como novo tudo que chegou durante a chamada anterior ao modelo,
    // e a análise dispararia de novo sobre quase o mesmo material.
    const marca = atual.last_message_at ?? atual.created_at
    const novas = await this.repo.contarDesde(orgId, contactId, marca)

    return novas >= MENSAGENS_PARA_REANALISE
  }

  // ------------------------------------------------------------------------
  // A análise.
  //
  // Erros do provider (rate limit, saldo, timeout) SOBEM. Quem chama decide:
  // a rota os mapeia para HTTP, o worker os isola para não derrubar o tique.
  // Engoli-los aqui e devolver "não deu" faria as duas pontas tratarem uma
  // conta sem crédito como uma conversa sem material.
  // ------------------------------------------------------------------------
  async analisar(
    orgId: string,
    contactId: string,
    gatilho: SentimentTrigger,
    nomeContato: string | null = null,
    // Quem clicou "Reanalisar". Ausente no caminho automático — é a convenção
    // do módulo: `performed_by` nulo em conversation_events significa sistema,
    // não operador.
    actorId?: string,
  ): Promise<DesfechoAnalise> {
    const agora  = new Date()
    const inicio = new Date(agora.getTime() - JANELA_DIAS * 86_400_000)

    // Descendente do repositório (para o LIMIT pegar as MAIS RECENTES); o
    // modelo lê em ordem cronológica.
    const recentesPrimeiro = await this.repo.mensagensNaJanela(
      orgId, contactId, inicio.toISOString(),
    )
    const mensagens = [...recentesPrimeiro].reverse()

    const comTexto = mensagens.filter((m) => (m.body ?? '').trim() !== '')

    // Guarda de custo: nada é cobrado por uma conversa que mal começou. É
    // também o que evita uma leitura confiante sobre um "oi" solto.
    if (comTexto.length < MINIMO_MENSAGENS) {
      return {
        tipo:    'material_insuficiente',
        detalhe: `${comTexto.length} mensagem(ns) na janela de ${JANELA_DIAS} dias; mínimo é ${MINIMO_MENSAGENS}`,
      }
    }

    const resultado = await lerSentimento(this.provider, {
      mensagens:   comTexto,
      nomeContato,
      agoraISO:    agora.toISOString(),
    })

    const leitura = await this.repo.inserir({
      organization_id:   orgId,
      contact_id:        contactId,
      sentiment:         resultado.sentimento,
      confidence:        resultado.confianca,
      headline:          resultado.veredito,
      reasoning:         resultado.justificativa,
      recommendations:   resultado.recomendacoes,
      messages_analyzed: comTexto.length,
      window_start:      inicio.toISOString(),
      window_end:        agora.toISOString(),
      // A marca d'água: a mensagem mais recente que ENTROU nesta leitura. Sai
      // de `comTexto`, e não do relógio, justamente para que o que chegar
      // durante a chamada acima conte como novo na próxima vez.
      last_message_at:   comTexto[comTexto.length - 1]?.sent_at ?? null,
      model:             resultado.modelo,
      triggered_by:      gatilho,
    })

    // Fire-and-forget, como no resto do módulo: trilha que falha não pode
    // derrubar a ação. Aqui ela também é o rastro de custo — é por este evento
    // que se responde "quantas leituras a clínica pagou esta semana".
    void this.audit.insert({
      organization_id: orgId,
      event_type:      'ai.sentiment_read',
      performed_by:    actorId,
      payload: {
        contactId,
        sentiment:  leitura.sentiment,
        confidence: leitura.confidence,
        gatilho,
        mensagens:  comTexto.length,
        modelo:     resultado.modelo,
      },
    })

    return { tipo: 'lida', leitura }
  }
}
