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
      // Citação: a Evolution procura a mensagem pelo id no próprio banco; o
      // `message` ao lado é o que ela usa quando a instância não guarda histórico.
      ...(input.replyToId
        ? {
            quoted: {
              key: { id: input.replyToId, fromMe: input.replyTo?.fromMe ?? false },
              message: { conversation: input.replyTo?.body ?? '' },
            },
          }
        : {}),
    })
    return resultado(json)
  }

  // Editar texto já enviado. Mesma resolução de jid do "apagar para todos" — um
  // jid errado não dá erro e nada muda no celular do contato.
  async editarTexto(
    channel: Channel,
    alvo: { externalId: string; telefone: string; texto: string },
  ): Promise<void> {
    const instancia = await this.resolverInstancia(channel)
    const remoteJid = await jidDaMensagem(instancia, alvo.externalId)
      ?? await jidDoNumero(instancia, alvo.telefone)

    await chamarEvolution('POST', `/chat/updateMessage/${encodeURIComponent(instancia)}`, {
      number: soDigitos(alvo.telefone),
      key: { id: alvo.externalId, remoteJid, fromMe: true },
      text: alvo.texto,
    })
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

  // "Apagar para todos". O pedido precisa do `remoteJid` EXATO da conversa no
  // WhatsApp, e o telefone do contato não serve para montá-lo: ele pode estar
  // com o 9º dígito que o WhatsApp não usa (contato que veio da Maia), e
  // conversa nova pode estar endereçada por `@lid`. Um jid errado não dá erro —
  // o WhatsApp manda o pedido para uma conversa que não existe e nada some.
  //
  // Por isso a chave sai da própria mensagem guardada na Evolution e, se ela não
  // a tiver, da mesma resolução de número que o envio usa.
  async apagarParaTodos(
    channel: Channel,
    alvo: { externalId: string; telefone: string },
  ): Promise<void> {
    const instancia = await this.resolverInstancia(channel)
    const remoteJid = await jidDaMensagem(instancia, alvo.externalId)
      ?? await jidDoNumero(instancia, alvo.telefone)

    await chamarEvolution('DELETE', `/chat/deleteMessageForEveryone/${encodeURIComponent(instancia)}`, {
      id: alvo.externalId,
      remoteJid,
      fromMe: true,
    })
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

// O jid com que a Evolution guardou a mensagem. Null quando ela não a tem (a
// instância pode não guardar histórico) — aí quem decide é jidDoNumero.
// A resposta mudou de forma entre versões: v2 recente devolve
// `{ messages: { records: [...] } }`; versões antigas, a lista direto.
async function jidDaMensagem(instancia: string, externalId: string): Promise<string | null> {
  try {
    const json = await chamarEvolution<unknown>('POST', `/chat/findMessages/${encodeURIComponent(instancia)}`, {
      where: { key: { id: externalId } },
    })
    const corpo = json as { messages?: { records?: unknown[] } | unknown[] } | unknown[]
    const lista = Array.isArray(corpo)
      ? corpo
      : Array.isArray(corpo?.messages)
        ? corpo.messages
        : corpo?.messages?.records ?? []
    const achada = (lista as { key?: { id?: string; remoteJid?: string } }[])
      .find(m => m?.key?.id === externalId)
    return achada?.key?.remoteJid || null
  } catch {
    return null
  }
}

async function jidDoNumero(instancia: string, telefone: string): Promise<string> {
  const json = await chamarEvolution<{ exists?: boolean; jid?: string }[]>(
    'POST',
    `/chat/whatsappNumbers/${encodeURIComponent(instancia)}`,
    { numbers: [soDigitos(telefone)] },
  )
  const r = Array.isArray(json) ? json[0] : undefined
  if (!r?.exists || !r.jid) {
    throw new ProviderError('evolution', new Error('o WhatsApp não encontrou a conversa deste contato para apagar a mensagem.'))
  }
  return r.jid
}

function tipoDeMidia(messageType: string): 'image' | 'video' | 'document' {
  if (messageType === 'image') return 'image'
  if (messageType === 'video') return 'video'
  return 'document'
}

function soDigitos(numero: string): string {
  return numero.replace(/\D/g, '')
}
