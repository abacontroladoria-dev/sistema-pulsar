import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ContactSentimentReading,
  SentimentLabel,
  SentimentTrigger,
} from '../types/central.types'

// ============================================================================
// SentimentoRepository
//
// central.contact_sentiment_readings (migration 20260921100000) — a leitura de
// sentimento do contato, e as mensagens que a alimentam.
//
// A tabela é APPEND-ONLY e não há `update` aqui, nem haverá: a sequência de
// linhas é o que permite dizer "piorando desde 12/09", e um UPDATE apagaria
// exatamente a informação pela qual a tabela existe.
//
// POR QUE AS MENSAGENS SÃO LIDAS POR CONTATO, E NÃO POR CONVERSA
//
// A janela é de 30 dias e uma conversa não dura 30 dias: ela é resolvida e
// outra nasce quando a pessoa volta (uq_conversations_active_per_contact_channel
// garante uma ativa por canal). Ler só a conversa aberta faria a reclamação da
// semana passada sumir junto com o atendimento que a encerrou.
// ============================================================================

const COLUNAS = `
  id, organization_id, contact_id,
  sentiment, confidence, headline, reasoning, recommendations,
  messages_analyzed, window_start, window_end, last_message_at,
  model, triggered_by, created_at
`

// Teto de mensagens por leitura. Um contato falante passa de mil em 30 dias, e
// o custo do prompt é linear no que entra nele. 200 das MAIS RECENTES é o
// recorte: quando há mais que isso, o que foi dito ontem importa mais do que o
// que foi dito há quatro semanas — e é a mesma razão pela qual o prompt manda
// dar peso ao recente.
export const TETO_MENSAGENS = 200

export interface MensagemDoContato {
  body:    string | null
  sent_at: string
}

export interface InserirLeituraInput {
  organization_id:   string
  contact_id:        string
  sentiment:         SentimentLabel
  confidence:        number
  headline:          string
  reasoning:         string
  recommendations:   string[]
  messages_analyzed: number
  window_start:      string
  window_end:        string
  last_message_at:   string | null
  model:             string
  triggered_by:      SentimentTrigger
}

export class SentimentoRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  // As duas últimas leituras: a atual e a anterior, que é o que desenha a
  // tendência. Uma consulta só, e não duas — pedir a anterior separadamente
  // abriria espaço para uma leitura nova entrar entre as duas chamadas e a
  // "anterior" voltar sendo a atual.
  async duasUltimas(orgId: string, contactId: string): Promise<ContactSentimentReading[]> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('contact_sentiment_readings')
      .select(COLUNAS)
      .eq('organization_id', orgId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(2)

    if (error) throw error
    return (data ?? []) as ContactSentimentReading[]
  }

  // ------------------------------------------------------------------------
  // As mensagens que a leitura analisa
  //
  // Só `inbound`: a leitura é sobre o que A PESSOA está sentindo. Incluir o que
  // a clínica respondeu misturaria a voz do atendente com a do contato e o
  // modelo passaria a avaliar o próprio atendimento.
  //
  // Ordem descendente com LIMIT, e a inversão para cronológica fica com quem
  // chama: é assim que se pega as N MAIS RECENTES. Ascendente com limite pegaria
  // as mais antigas, que é o oposto do que interessa.
  // ------------------------------------------------------------------------
  async mensagensNaJanela(
    orgId: string,
    contactId: string,
    desdeISO: string,
  ): Promise<MensagemDoContato[]> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('messages')
      .select('body, sent_at, conversations!inner(contact_id)')
      .eq('organization_id', orgId)
      .eq('conversations.contact_id', contactId)
      .eq('direction', 'inbound')
      // Número Evolution é atendimento humano: a IA não lê essas conversas.
      .or('provider.is.null,provider.neq.evolution')
      .gte('sent_at', desdeISO)
      .is('deleted_at', null)
      .order('sent_at', { ascending: false })
      .limit(TETO_MENSAGENS)

    if (error) throw error

    return ((data ?? []) as { body: string | null; sent_at: string }[])
      .map((m) => ({ body: m.body, sent_at: m.sent_at }))
  }

  // Quantas mensagens do contato chegaram DEPOIS da marca d'água da última
  // leitura. É o contador do gatilho automático.
  //
  // `desdeISO` é o `last_message_at` da leitura anterior, nunca o `created_at`
  // dela — ver o comentário da coluna na migration. Contar contra `created_at`
  // recontaria como novo tudo que chegou enquanto o modelo respondia.
  async contarDesde(orgId: string, contactId: string, desdeISO: string): Promise<number> {
    const { count, error } = await (this.supabase as any)
      .schema('central')
      .from('messages')
      .select('id, conversations!inner(contact_id)', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('conversations.contact_id', contactId)
      .eq('direction', 'inbound')
      // Número Evolution é atendimento humano: a IA não lê essas conversas.
      .or('provider.is.null,provider.neq.evolution')
      .gt('sent_at', desdeISO)
      .is('deleted_at', null)

    if (error) throw error
    return count ?? 0
  }

  async inserir(input: InserirLeituraInput): Promise<ContactSentimentReading> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('contact_sentiment_readings')
      .insert(input)
      .select(COLUNAS)
      .single()

    if (error) throw error
    return data as ContactSentimentReading
  }

  // ------------------------------------------------------------------------
  // Candidatos do gatilho automático: contatos com mensagem recente.
  //
  // Parte de `conversations.last_message_at` e não de `messages` porque a
  // pergunta é "quem falou com a gente ultimamente", e a conversa já mantém
  // esse carimbo indexado. Varrer mensagens exigiria agrupar por contato a cada
  // tique, a cada 10 segundos, para achar as poucas que mudaram.
  //
  // Distinto no cliente: o mesmo contato pode ter conversa em mais de um canal,
  // e a leitura é uma só por pessoa.
  // ------------------------------------------------------------------------
  async contatosComAtividadeDesde(orgId: string, desdeISO: string, teto: number): Promise<string[]> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('conversations')
      .select('contact_id, last_message_at')
      .eq('organization_id', orgId)
      .gte('last_message_at', desdeISO)
      .order('last_message_at', { ascending: false })
      .limit(teto)

    if (error) throw error

    const vistos = new Set<string>()
    for (const linha of (data ?? []) as { contact_id: string | null }[]) {
      if (linha.contact_id) vistos.add(linha.contact_id)
    }
    return [...vistos]
  }
}
