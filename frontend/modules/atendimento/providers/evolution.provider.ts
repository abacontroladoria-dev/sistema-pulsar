import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type {
  MessagingProvider,
  Channel,
  ChannelStatus,
  ProviderSendInput,
  ProviderSendResult,
  ProviderUploadResult,
  NormalizedIncomingMessage,
} from '../types/central.types'
import { ProviderError } from '../types/errors.types'
import { chamarEvolution, TIMEOUT_MIDIA_MS } from './evolution.api'
import { normalizarWebhookEvolution } from './evolution.normalizar'

// ============================================================================
// EvolutionProvider — números WhatsApp não oficiais (atendimento humano)
//
// Mesmo contrato do MetaWabaProvider, com três diferenças que importam:
//
//   • NÃO HÁ JANELA DE 24H. A Evolution fala como um celular: texto livre a
//     qualquer momento. Nenhum erro equivalente a JanelaAtendimentoFechadaError.
//   • NÃO HÁ UPLOAD SEPARADO. A mídia vai junto do envio (base64). Por isso
//     `exigeUploadPrevio = false`, e o MessageService pula o uploadMedia.
//   • A IDENTIDADE DO CANAL é o nome da instância na Evolution
//     (`channel_connections.provider_instance_id`), não um phone_number_id.
//
// A Maia nunca passa por aqui: números Evolution têm ai_mode travado em 'off'
// no banco (20260924180100).
// ============================================================================

const TTL_CACHE_MS = 60_000

export class EvolutionProvider implements MessagingProvider {
  readonly exigeUploadPrevio = false

  private readonly cache = new Map<string, { instancia: string; expiraEm: number }>()

  // Service role: `channel_connections` não é legível por `authenticated` em
  // todas as colunas, e o webhook não tem sessão.
  constructor(private readonly supabase: SupabaseClient) {}

  async sendMessage(channel: Channel, input: ProviderSendInput): Promise<ProviderSendResult> {
    const instancia = await this.resolverInstancia(channel)
    const json = await chamarEvolution<{ key?: { id?: unknown } }>('POST', `/message/sendText/${encodeURIComponent(instancia)}`, {
      number: soDigitos(input.to),
      text: input.body ?? '',
    })
    return resultado(json)
  }

  async sendMedia(channel: Channel, input: ProviderSendInput): Promise<ProviderSendResult> {
    if (!input.arquivo) {
      throw new ProviderError('evolution', new Error('sendMedia da Evolution exige `arquivo` (os bytes vão junto do envio).'))
    }
    const instancia = await this.resolverInstancia(channel)
    const base64 = Buffer.from(input.arquivo.bytes).toString('base64')
    const numero = soDigitos(input.to)

    // Áudio vai por rota própria para chegar como mensagem de voz (PTT), e não
    // como arquivo de música anexado.
    const json = input.messageType === 'audio'
      ? await chamarEvolution<{ key?: { id?: unknown } }>(
          'POST',
          `/message/sendWhatsAppAudio/${encodeURIComponent(instancia)}`,
          { number: numero, audio: base64 },
          TIMEOUT_MIDIA_MS,
        )
      : await chamarEvolution<{ key?: { id?: unknown } }>(
          'POST',
          `/message/sendMedia/${encodeURIComponent(instancia)}`,
          {
            number: numero,
            mediatype: tipoDeMidia(input.messageType),
            mimetype: input.arquivo.mimeType,
            media: base64,
            fileName: input.fileName ?? input.arquivo.fileName,
            ...(input.caption ? { caption: input.caption } : {}),
          },
          TIMEOUT_MIDIA_MS,
        )

    return resultado(json)
  }

  async uploadMedia(): Promise<ProviderUploadResult> {
    throw new ProviderError('evolution', new Error('a Evolution não tem upload separado; o arquivo vai em sendMedia.'))
  }

  // `referencia` é o que o normalizador guardou em `external_url`: a chave e a
  // mensagem (sem binários), que é o que a Evolution precisa para descriptografar
  // a mídia no WhatsApp. Uma string que não é JSON é tratada como id puro — a
  // Evolution acha a mensagem no próprio banco quando guarda o histórico.
  async baixarMedia(
    channel: Channel,
    referencia: string,
  ): Promise<{ bytes: ArrayBuffer; mimeType: string; fileSize: number }> {
    const instancia = await this.resolverInstancia(channel)

    let message: unknown
    try {
      message = JSON.parse(referencia)
    } catch {
      message = { key: { id: referencia } }
    }

    const json = await chamarEvolution<{ base64?: string; mimetype?: string }>(
      'POST',
      `/chat/getBase64FromMediaMessage/${encodeURIComponent(instancia)}`,
      { message, convertToMp4: false },
      TIMEOUT_MIDIA_MS,
    )

    if (!json.base64) {
      throw new ProviderError('evolution', new Error('a Evolution não devolveu a mídia (base64 vazio) — pode ter expirado no WhatsApp.'))
    }

    const buffer = Buffer.from(json.base64, 'base64')
    const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
    return {
      bytes,
      mimeType: json.mimetype ?? 'application/octet-stream',
      fileSize: buffer.byteLength,
    }
  }

  async getStatus(channel: Channel): Promise<ChannelStatus> {
    try {
      const instancia = await this.resolverInstancia(channel)
      const json = await chamarEvolution<{ instance?: { state?: string } }>(
        'GET',
        `/instance/connectionState/${encodeURIComponent(instancia)}`,
      )
      return statusDoEstado(json.instance?.state)
    } catch {
      return 'error'
    }
  }

  async processWebhook(raw: unknown): Promise<NormalizedIncomingMessage> {
    const evento = normalizarWebhookEvolution(raw).find(e => e.tipo === 'mensagem')
    if (!evento || evento.tipo !== 'mensagem') {
      throw new ProviderError('evolution', new Error('o webhook não traz mensagem de conversa individual'))
    }
    return evento.mensagem
  }

  private async resolverInstancia(channel: Channel): Promise<string> {
    const emCache = this.cache.get(channel.id)
    if (emCache && emCache.expiraEm > Date.now()) return emCache.instancia

    const { data, error } = await this.supabase
      .schema('central')
      .from('channel_connections')
      .select('provider_instance_id')
      .eq('channel_id', channel.id)
      .maybeSingle()

    if (error) throw new ProviderError('evolution', error)

    const instancia = (data as { provider_instance_id?: string | null } | null)?.provider_instance_id
    if (!instancia) {
      throw new ProviderError('evolution', new Error(`canal ${channel.id} sem provider_instance_id em channel_connections.`))
    }

    this.cache.set(channel.id, { instancia, expiraEm: Date.now() + TTL_CACHE_MS })
    return instancia
  }
}

export function statusDoEstado(estado: string | undefined): ChannelStatus {
  switch (estado) {
    case 'open':       return 'active'
    case 'connecting': return 'connecting'
    case 'close':      return 'disconnected'
    default:           return 'error'
  }
}

// A Evolution devolve a mensagem criada, com `key.id` — o id do WhatsApp que
// amarra os webhooks de status (entregue/lido) à nossa linha.
function resultado(json: { key?: { id?: unknown } }): ProviderSendResult {
  const externalId = json?.key?.id
  if (typeof externalId !== 'string' || !externalId) {
    throw new ProviderError('evolution', new Error(`resposta sem key.id: ${JSON.stringify(json).slice(0, 200)}`))
  }
  return { externalId, status: 'sent', sentAt: new Date().toISOString() }
}

function tipoDeMidia(messageType: string): 'image' | 'video' | 'document' {
  if (messageType === 'image') return 'image'
  if (messageType === 'video') return 'video'
  return 'document'
}

function soDigitos(numero: string): string {
  return numero.replace(/\D/g, '')
}
