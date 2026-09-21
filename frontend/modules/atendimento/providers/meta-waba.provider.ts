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
import { normalizarMensagemMeta } from './meta-waba.normalizar'

// ============================================================================
// MetaWabaProvider — envio pela WhatsApp Cloud API (Meta)
//
// ONDE MORA CADA CREDENCIAL, e por quê
//
// A interface `MessagingProvider` recebe um `Channel`, que NÃO carrega token nem
// phone_number_id — são de `central.channel_connections`. Então o provider
// resolve a connection por `channel.id` internamente. O desenho da interface
// esconde isso, e descobrir tarde custaria uma refatoração.
//
//   phone_number_id → channel_connections.provider_metadata (identificador,
//                     não segredo; pode viver no banco)
//   access token    → META_WABA_TOKEN, env de RUNTIME no Coolify
//
// O token NÃO vai para o banco, pela mesma decisão já registrada para
// OPENAI_API_KEY: quem tem acesso direto ao Postgres o leria. E nunca como ARG
// do Dockerfile — ARG fica gravado na imagem e no `docker history`, que foi
// exatamente como o TITA_TOKEN vazou uma vez.
//
// A JANELA DE 24 HORAS
//
// Fora de 24h desde a última mensagem do contato, a Meta só aceita template
// aprovado — texto livre é recusado com o código 131047. Isso NÃO é falha do
// sistema: é regra de negócio da plataforma. Por isso ganha erro próprio
// (`JanelaAtendimentoFechadaError`) em vez de virar um ProviderError genérico,
// que faria a fila retentar contra uma recusa que nunca vai mudar.
// ============================================================================

const GRAPH_VERSION = 'v21.0'
const BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`

// 20s. O envio está no caminho de alguém esperando resposta no WhatsApp; se a
// Meta não respondeu em 20s, o worker prefere devolver o item à fila.
const TIMEOUT_MS = 20_000

// Mídia é outra ordem de grandeza: 16 MiB subindo por uma rota Next não cabem
// em 20s numa conexão de recepção. Ninguém está esperando em tempo real por um
// upload como se espera por uma resposta de texto.
const TIMEOUT_UPLOAD_MS = 90_000

// Código da Meta para "fora da janela de 24h". Documentado porque o número, e
// não a mensagem, é o que se pode comparar com segurança.
const CODIGO_FORA_DA_JANELA = 131047

// Cache de connection por canal. TTL curto: o phone_number_id praticamente não
// muda, mas um cache eterno obrigaria a reiniciar o app depois de corrigir uma
// configuração errada — que é justamente quando se está com pressa.
const TTL_CACHE_MS = 60_000

interface ConexaoResolvida {
  phoneNumberId: string
  expiraEm: number
}

export class JanelaAtendimentoFechadaError extends Error {
  readonly code = 'WABA_JANELA_FECHADA'
  constructor(readonly destino: string) {
    super(
      'A janela de 24 horas de atendimento fechou para este contato. '
      + 'A Meta só aceita template aprovado fora dela.',
    )
    this.name = 'JanelaAtendimentoFechadaError'
  }
}

export class MetaWabaProvider implements MessagingProvider {
  private readonly cache = new Map<string, ConexaoResolvida>()

  // Recebe o cliente Supabase porque a connection é um dado de banco. Nas
  // chamadas de worker/webhook é o service role — não há sessão de usuário.
  constructor(private readonly supabase: SupabaseClient) {}

  async sendMessage(
    channel: Channel,
    input: ProviderSendInput,
  ): Promise<ProviderSendResult> {
    const phoneNumberId = await this.resolverPhoneNumberId(channel)

    const corpo = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: soDigitos(input.to),
      type: 'text',
      text: {
        // A Meta renderiza links por conta própria; a prévia rouba espaço e
        // atrapalha numa mensagem que enumera horários.
        preview_url: false,
        body: input.body ?? '',
      },
      ...(input.replyToId ? { context: { message_id: input.replyToId } } : {}),
    }

    const json = await this.chamar(`/${phoneNumberId}/messages`, corpo, input.to)

    // O id devolvido pela Meta é o que amarra o webhook de status (sent →
    // delivered → read) à mensagem no nosso banco. Sem ele, o status nunca
    // encontra a linha — daí ser erro e não um valor vazio.
    const externalId = json?.messages?.[0]?.id
    if (!externalId) {
      throw new ProviderError(
        'meta_waba',
        new Error(`resposta 200 sem messages[0].id: ${JSON.stringify(json).slice(0, 200)}`),
      )
    }

    return {
      externalId,
      // 'sent' e não 'delivered': a Meta ACEITOU o envio. A entrega real chega
      // depois, pelo webhook de status. Registrar 'delivered' aqui seria
      // afirmar o que ainda não se sabe.
      status: 'sent',
      sentAt: new Date().toISOString(),
    }
  }

  // --------------------------------------------------------------------------
  // Mídia
  //
  // POR QUE POR MEDIA ID, E NÃO POR URL
  //
  // A Graph API aceita as duas formas: `{"image":{"link":"https://..."}}` ou
  // `{"image":{"id":"<media-id>"}}`. A primeira exige que o arquivo esteja
  // acessível pela internet SEM autenticação, porque quem busca é a Meta.
  //
  // Para esta clínica isso significaria bucket público com áudio de mãe
  // descrevendo crise do filho e laudo neuropediátrico servidos a quem souber
  // o path. O media ID evita isso inteiro: nós entregamos os bytes, a Meta
  // devolve um identificador, e o arquivo nunca precisa ser alcançável de fora.
  //
  // É por isso que o desenho do repo de referência (que sobe para bucket
  // público e manda o link) não foi copiado.
  // --------------------------------------------------------------------------

  async sendMedia(
    channel: Channel,
    input: ProviderSendInput,
  ): Promise<ProviderSendResult> {
    if (!input.mediaId) {
      throw new ProviderError(
        'meta_waba',
        new Error('sendMedia exige mediaId — chame uploadMedia antes.'),
      )
    }

    const phoneNumberId = await this.resolverPhoneNumberId(channel)
    const tipo = tipoDeMidiaMeta(input.messageType)

    // A Meta aceita legenda em imagem, vídeo e documento; em ÁUDIO não. Mandar
    // `caption` num áudio faz a chamada inteira ser recusada — por isso o campo
    // é montado por tipo, e não espalhado em todos.
    const midia: Record<string, unknown> = { id: input.mediaId }
    if (tipo !== 'audio' && input.caption) midia.caption = input.caption
    // `filename` só existe em documento, e é o que o WhatsApp mostra na bolha.
    // Sem ele o destinatário recebe um nome gerado pela Meta e não sabe o que é.
    if (tipo === 'document' && input.fileName) midia.filename = input.fileName

    const corpo = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: soDigitos(input.to),
      type: tipo,
      [tipo]: midia,
      ...(input.replyToId ? { context: { message_id: input.replyToId } } : {}),
    }

    const json = await this.chamar(`/${phoneNumberId}/messages`, corpo, input.to)

    const externalId = json?.messages?.[0]?.id
    if (!externalId) {
      throw new ProviderError(
        'meta_waba',
        new Error(`resposta 200 sem messages[0].id: ${JSON.stringify(json).slice(0, 200)}`),
      )
    }

    return { externalId, status: 'sent', sentAt: new Date().toISOString() }
  }

  // Entrega os bytes e recebe o media ID (válido por 30 dias na Meta).
  //
  // Não passa por `chamar()`: aquele método serializa JSON e fixa o
  // Content-Type. Aqui o corpo é multipart, e o boundary precisa ser gerado
  // pelo runtime — definir o header à mão produz um boundary que não bate com
  // o corpo e a Meta recusa com uma mensagem que não ajuda ninguém.
  async uploadMedia(
    channel: Channel,
    arquivo: { bytes: ArrayBuffer; mimeType: string; fileName: string },
  ): Promise<ProviderUploadResult> {
    const phoneNumberId = await this.resolverPhoneNumberId(channel)
    const token = this.token()

    const form = new FormData()
    form.append('messaging_product', 'whatsapp')
    form.append('type', arquivo.mimeType)
    form.append(
      'file',
      new Blob([arquivo.bytes], { type: arquivo.mimeType }),
      arquivo.fileName,
    )

    let resposta: Response
    try {
      resposta = await fetch(`${BASE_URL}/${phoneNumberId}/media`, {
        method: 'POST',
        // Sem Content-Type: o fetch o define com o boundary correto.
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_UPLOAD_MS),
        cache: 'no-store',
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new ProviderError(
          'meta_waba',
          new Error(`o upload não completou em ${TIMEOUT_UPLOAD_MS}ms`),
        )
      }
      throw new ProviderError('meta_waba', err)
    }

    const texto = await resposta.text()
    if (!resposta.ok) {
      throw new ProviderError(
        'meta_waba',
        new Error(`HTTP ${resposta.status} no upload: ${extrairErroMeta(texto).mensagem}`),
      )
    }

    const id = (JSON.parse(texto) as { id?: string }).id
    if (!id) {
      throw new ProviderError(
        'meta_waba',
        new Error(`upload aceito mas sem id: ${texto.slice(0, 200)}`),
      )
    }
    return { externalId: id }
  }

  // Duas idas: o id vira URL, a URL vira bytes. As duas exigem o token.
  //
  // A URL intermediária vale 5 MINUTOS, o que é a razão de este método existir
  // em vez de a gente guardar a URL no banco e deixar o navegador buscar: ela
  // expiraria antes de alguém abrir a conversa, e nem com ela válida o
  // navegador conseguiria — o download exige o Authorization.
  async baixarMedia(
    channel: Channel,
    mediaId: string,
  ): Promise<{ bytes: ArrayBuffer; mimeType: string; fileSize: number }> {
    const token = this.token()

    // O phone_number_id não é obrigatório aqui, mas a Meta o usa para
    // desambiguar quando o app atende vários números.
    const phoneNumberId = await this.resolverPhoneNumberId(channel)
    const meta = await this.chamar(
      `/${mediaId}?phone_number_id=${encodeURIComponent(phoneNumberId)}`,
      null,
      '',
    )

    const url = meta?.url
    if (typeof url !== 'string' || !url) {
      throw new ProviderError(
        'meta_waba',
        new Error(`mídia ${mediaId} sem url na resposta — provavelmente expirou.`),
      )
    }

    let resposta: Response
    try {
      resposta = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TIMEOUT_UPLOAD_MS),
        cache: 'no-store',
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new ProviderError(
          'meta_waba',
          new Error(`o download não completou em ${TIMEOUT_UPLOAD_MS}ms`),
        )
      }
      throw new ProviderError('meta_waba', err)
    }

    if (!resposta.ok) {
      throw new ProviderError(
        'meta_waba',
        new Error(`HTTP ${resposta.status} ao baixar a mídia ${mediaId}`),
      )
    }

    const bytes = await resposta.arrayBuffer()
    return {
      bytes,
      // O mime_type da Graph é mais confiável que o Content-Type do CDN, que
      // às vezes volta como application/octet-stream.
      mimeType: typeof meta?.mime_type === 'string'
        ? meta.mime_type
        : (resposta.headers.get('content-type') ?? 'application/octet-stream'),
      fileSize: bytes.byteLength,
    }
  }

  // Uma leitura do número na Graph API. Serve para /api/central/health dizer se
  // a credencial ainda vale — o token de 24h expira calado, e "a atendente
  // parou de responder" é um sintoma caro de diagnosticar sem isso.
  async getStatus(channel: Channel): Promise<ChannelStatus> {
    try {
      const phoneNumberId = await this.resolverPhoneNumberId(channel)
      await this.chamar(`/${phoneNumberId}`, null, '')
      return 'active'
    } catch {
      return 'disconnected'
    }
  }

  // A normalização vive em arquivo próprio: é pura, e um parser puro é
  // testável com payload real capturado, sem rede e sem banco.
  async processWebhook(raw: unknown): Promise<NormalizedIncomingMessage> {
    return normalizarMensagemMeta(raw)
  }

  // --------------------------------------------------------------------------

  private async resolverPhoneNumberId(channel: Channel): Promise<string> {
    const emCache = this.cache.get(channel.id)
    if (emCache && emCache.expiraEm > Date.now()) return emCache.phoneNumberId

    const { data, error } = await this.supabase
      .schema('central')
      .from('channel_connections')
      .select('provider_metadata')
      .eq('channel_id', channel.id)
      .maybeSingle()

    if (error) {
      throw new ProviderError('meta_waba', error)
    }

    const metadata = (data?.provider_metadata ?? {}) as { phone_number_id?: unknown }
    const phoneNumberId = metadata.phone_number_id

    if (typeof phoneNumberId !== 'string' || !phoneNumberId) {
      throw new ProviderError(
        'meta_waba',
        new Error(
          `canal ${channel.id} sem phone_number_id em channel_connections.`
          + 'provider_metadata. Rode a migration de seed do canal.',
        ),
      )
    }

    this.cache.set(channel.id, {
      phoneNumberId,
      expiraEm: Date.now() + TTL_CACHE_MS,
    })

    return phoneNumberId
  }

  // O token, ou um erro que diz onde defini-lo. Extraído de `chamar` porque o
  // upload e o download da mídia não passam por lá — o primeiro é multipart, o
  // segundo busca um CDN fora da Graph.
  private token(): string {
    const token = (process.env.META_WABA_TOKEN ?? '').trim()
    if (!token) {
      throw new ProviderError(
        'meta_waba',
        new Error(
          'META_WABA_TOKEN não está definida. Defina-a como variável de '
          + 'RUNTIME no Coolify (nunca como ARG do Dockerfile).',
        ),
      )
    }
    return token
  }

  // Uma ida à Graph API. Mesma forma de voz/elevenlabs.ts: timeout explícito,
  // sem cache, erro tipado, e a classificação vinda do CORPO e não do status.
  private async chamar(
    caminho: string,
    corpo: unknown | null,
    destino: string,
  ): Promise<Record<string, any>> {
    const token = this.token()

    let resposta: Response
    try {
      resposta = await fetch(`${BASE_URL}${caminho}`, {
        method: corpo === null ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(corpo === null ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(corpo === null ? {} : { body: JSON.stringify(corpo) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new ProviderError(
          'meta_waba',
          new Error(`a Meta não respondeu em ${TIMEOUT_MS}ms`),
        )
      }
      throw new ProviderError('meta_waba', err)
    }

    const texto = await resposta.text()

    if (!resposta.ok) {
      // A CLASSIFICAÇÃO VEM DO CÓDIGO NO CORPO, NÃO DO STATUS HTTP. A Meta
      // devolve 400 tanto para "fora da janela de 24h" (regra de negócio, não
      // retentável) quanto para "token expirado" (configuração). Ramificar pelo
      // status faria os dois virarem a mesma coisa — e a fila retentaria uma
      // recusa definitiva até esgotar as tentativas. É a mesma lição que a
      // integração da ElevenLabs já tinha registrado.
      const erro = extrairErroMeta(texto)

      if (erro.codigo === CODIGO_FORA_DA_JANELA) {
        throw new JanelaAtendimentoFechadaError(destino)
      }

      throw new ProviderError(
        'meta_waba',
        new Error(`HTTP ${resposta.status}: ${erro.mensagem}`),
      )
    }

    try {
      return JSON.parse(texto) as Record<string, any>
    } catch {
      throw new ProviderError(
        'meta_waba',
        new Error(`resposta 200 ilegível: ${texto.slice(0, 200)}`),
      )
    }
  }
}

// O formato de erro da Meta é `{"error":{"message":"...","code":131047,
// "error_data":{"details":"..."}}}`. `details` costuma ser mais específico que
// `message` e é o que efetivamente diz o que corrigir.
function extrairErroMeta(corpo: string): { codigo: number | null; mensagem: string } {
  try {
    const json = JSON.parse(corpo) as {
      error?: {
        message?: string
        code?: number
        error_data?: { details?: string }
      }
    }
    const erro = json.error
    if (erro) {
      const partes = [erro.message, erro.error_data?.details].filter(Boolean)
      return {
        codigo: typeof erro.code === 'number' ? erro.code : null,
        mensagem: partes.join(' — ') || corpo.slice(0, 300),
      }
    }
  } catch {
    // não é JSON — cai no recorte
  }
  return { codigo: null, mensagem: corpo.slice(0, 300) }
}

// O `message_type` do nosso schema para o campo que a Graph API espera.
//
// São quase iguais, e a exceção é a que importa: 'sticker' existe no nosso
// enum (o webhook o normaliza) mas enviar figurinha exige WebP com restrições
// próprias que não vamos produzir. Cai em 'document', que sempre funciona —
// degradar para um tipo que entrega é melhor que recusar o envio.
function tipoDeMidiaMeta(messageType: string): 'image' | 'audio' | 'video' | 'document' {
  switch (messageType) {
    case 'image': return 'image'
    case 'audio': return 'audio'
    case 'video': return 'video'
    default:      return 'document'
  }
}

// A Meta rejeita `+`, espaço e parêntese no campo `to`. `display_phone` do
// contato vem de fonte humana e frequentemente formatado.
function soDigitos(numero: string): string {
  return numero.replace(/\D/g, '')
}
