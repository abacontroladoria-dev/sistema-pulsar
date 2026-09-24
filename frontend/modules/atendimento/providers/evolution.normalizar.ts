/* eslint-disable @typescript-eslint/no-explicit-any -- payload externo do Baileys/Evolution, sem tipos publicados; cada campo é lido com ?. e checagem de tipo */
import type { NormalizedIncomingMessage } from '../types/central.types'
import { digitosDoJid } from '../utils/telefone-br'

// ============================================================================
// Normalização do webhook da Evolution API → eventos do Pulsar
//
// Função PURA, como meta-waba.normalizar.ts: sem rede, sem banco, sem env. É o
// que permite testá-la contra payloads reais capturados.
//
// O formato da Evolution muda entre versões (v1 mandava `data.messages[]` e
// status numérico; v2 manda `data` único e status por nome). Tudo é opcional no
// tipo e os dois formatos são aceitos: é dado externo, e um `??` é mais barato
// que uma mensagem perdida por TypeError.
//
// A MESMA REGRA DA META: mensagem de conversa individual nunca some calada. O
// que é descartado de propósito (grupo, status, broadcast) volta como
// `ignorado` com o motivo, e a rota grava esse motivo no log do webhook.
// ============================================================================

export type EstadoConexaoEvolution = 'open' | 'connecting' | 'close'

export type EventoEvolution =
  | {
      tipo: 'mensagem'
      instance: string
      fromMe: boolean
      // Só dígitos, como o WhatsApp identifica o contato. Não é "corrigido" —
      // ver utils/telefone-br.ts.
      telefone: string
      // `pushName` é o nome de perfil de QUEM MANDOU. Em mensagem nossa
      // (fromMe) é o nome do próprio número da clínica, e não serve para
      // batizar o contato — daí vir nulo nesse caso.
      nomePerfil: string | null
      mensagem: NormalizedIncomingMessage
    }
  | { tipo: 'status'; instance: string; externalId: string; status: string }
  | { tipo: 'conexao'; instance: string; estado: EstadoConexaoEvolution }
  | { tipo: 'ignorado'; instance: string; motivo: string }

interface PayloadEvolution {
  event?: string
  instance?: string
  data?: unknown
}

interface ChaveMensagem {
  remoteJid?: string
  remoteJidAlt?: string
  senderPn?: string
  fromMe?: boolean
  id?: string
}

interface DadosMensagem {
  key?: ChaveMensagem
  pushName?: string
  message?: Record<string, any>
  messageType?: string
  messageTimestamp?: number | string | { low?: number }
}

// Status numérico do Baileys (v1 e alguns eventos da v2).
const STATUS_NUMERICO: Record<number, string> = {
  0: 'ERROR',
  1: 'PENDING',
  2: 'SERVER_ACK',
  3: 'DELIVERY_ACK',
  4: 'READ',
  5: 'PLAYED',
}

// Chaves que carregam binário embutido (miniatura, o próprio arquivo quando o
// webhook vem com base64). Tiradas antes de guardar a referência da mídia: o
// que precisa sobreviver é a CHAVE para pedir o arquivo, não kilobytes de base64
// numa coluna de texto.
const CHAVES_BINARIAS = new Set(['jpegThumbnail', 'thumbnail', 'base64', 'thumbnailDirectPath'])

/**
 * Converte UMA entrega do webhook em zero ou mais eventos. Nunca lança: payload
 * que não se entende vira `ignorado` com o motivo.
 */
export function normalizarWebhookEvolution(raw: unknown): EventoEvolution[] {
  const p = (raw ?? {}) as PayloadEvolution
  const instance = typeof p.instance === 'string' ? p.instance : ''
  const evento = (p.event ?? '').toLowerCase().replace(/_/g, '.')

  switch (evento) {
    case 'messages.upsert':
    case 'send.message':
      return listaDeDados(p.data).map(d => normalizarMensagem(instance, d as DadosMensagem))

    case 'messages.update':
      return listaDeDados(p.data).map(d => normalizarStatus(instance, d))

    case 'connection.update':
      return [normalizarConexao(instance, p.data)]

    default:
      return [{ tipo: 'ignorado', instance, motivo: `evento ${p.event ?? '(sem nome)'} não tratado` }]
  }
}

// v2: `data` é o objeto. v1: `data.messages[]` ou `data` já é array.
function listaDeDados(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  const comLista = data as { messages?: unknown[] } | null
  if (Array.isArray(comLista?.messages)) return comLista!.messages!
  return data ? [data] : []
}

function normalizarMensagem(instance: string, d: DadosMensagem): EventoEvolution {
  const key = d.key ?? {}
  const jid = key.remoteJid ?? ''

  if (!key.id) return { tipo: 'ignorado', instance, motivo: 'mensagem sem key.id' }
  if (jid.endsWith('@g.us')) return { tipo: 'ignorado', instance, motivo: 'mensagem de grupo' }
  if (jid === 'status@broadcast') return { tipo: 'ignorado', instance, motivo: 'status do WhatsApp' }
  if (jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) {
    return { tipo: 'ignorado', instance, motivo: 'lista de transmissão/canal' }
  }

  // `@lid` é o identificador anônimo do WhatsApp novo: não é telefone. As
  // versões recentes da Evolution mandam o telefone ao lado, em
  // `remoteJidAlt`/`senderPn`. Sem ele não há como achar o contato — e criar um
  // contato cujo "telefone" é um LID geraria um número para o qual não se
  // consegue responder.
  let jidTelefone = jid
  if (jid.endsWith('@lid')) {
    jidTelefone = key.remoteJidAlt ?? key.senderPn ?? ''
    if (!jidTelefone) {
      return { tipo: 'ignorado', instance, motivo: 'contato @lid sem telefone alternativo' }
    }
  }

  const telefone = digitosDoJid(jidTelefone)
  if (!telefone) return { tipo: 'ignorado', instance, motivo: `jid sem telefone: ${jid}` }

  const conteudo = desembrulhar(d.message ?? {})

  // Edição e apagamento chegam como mensagens de protocolo. Não são conteúdo
  // novo; tratá-las como mensagem criaria uma bolha "[mensagem do tipo ...]"
  // a cada edição.
  if (conteudo.protocolMessage || conteudo.editedMessage) {
    return { tipo: 'ignorado', instance, motivo: 'edição/apagamento (protocolMessage)' }
  }

  const fromMe = key.fromMe === true
  const { corpo, tipo, midia, nomeArquivo, mime, citada } = interpretar(conteudo)

  const mensagem: NormalizedIncomingMessage = {
    externalMessageId: key.id,
    from: telefone,
    body: corpo,
    messageType: tipo,
    sentAt: instante(d.messageTimestamp),
    replyToExternalId: citada,
    attachments: midia
      ? [{
          // A referência para pedir o arquivo depois (getBase64FromMediaMessage):
          // a chave e a mensagem SEM os binários embutidos.
          externalUrl: JSON.stringify({ key: limparChave(key), message: semBinarios(conteudo) }),
          fileType: mime,
          fileName: nomeArquivo,
        }]
      : undefined,
  }

  return {
    tipo: 'mensagem',
    instance,
    fromMe,
    telefone,
    nomePerfil: !fromMe && d.pushName?.trim() ? d.pushName.trim() : null,
    mensagem,
  }
}

function normalizarStatus(instance: string, raw: unknown): EventoEvolution {
  const d = (raw ?? {}) as {
    keyId?: string
    key?: { id?: string }
    status?: string | number
    update?: { status?: string | number }
  }
  const externalId = d.keyId ?? d.key?.id
  const bruto = d.status ?? d.update?.status

  if (!externalId || bruto === undefined || bruto === null) {
    return { tipo: 'ignorado', instance, motivo: 'messages.update sem id ou status' }
  }

  const status = typeof bruto === 'number' ? (STATUS_NUMERICO[bruto] ?? 'ERROR') : String(bruto)
  return { tipo: 'status', instance, externalId, status }
}

function normalizarConexao(instance: string, raw: unknown): EventoEvolution {
  const estado = (raw as { state?: string } | null)?.state
  if (estado === 'open' || estado === 'connecting' || estado === 'close') {
    return { tipo: 'conexao', instance, estado }
  }
  return { tipo: 'ignorado', instance, motivo: `connection.update com estado ${estado ?? '(vazio)'}` }
}

// Mensagem temporária e de visualização única vêm embrulhadas em outra
// mensagem. O conteúdo de verdade está uma camada abaixo.
function desembrulhar(m: Record<string, any>): Record<string, any> {
  let atual = m
  for (let i = 0; i < 3; i++) {
    const dentro =
      atual.ephemeralMessage?.message
      ?? atual.viewOnceMessage?.message
      ?? atual.viewOnceMessageV2?.message
      ?? atual.viewOnceMessageV2Extension?.message
      ?? atual.documentWithCaptionMessage?.message
    if (!dentro) break
    atual = dentro
  }
  return atual
}

function interpretar(m: Record<string, any>): {
  corpo: string
  tipo: string
  midia: boolean
  nomeArquivo?: string
  mime?: string
  citada?: string
} {
  const citada = primeiroContexto(m)

  if (typeof m.conversation === 'string') {
    return { corpo: m.conversation.trim() || '[mensagem de texto vazia]', tipo: 'text', midia: false, citada }
  }
  if (m.extendedTextMessage) {
    return {
      corpo: String(m.extendedTextMessage.text ?? '').trim() || '[mensagem de texto vazia]',
      tipo: 'text', midia: false, citada,
    }
  }
  if (m.imageMessage) {
    return {
      corpo: m.imageMessage.caption?.trim() || '[imagem]',
      tipo: 'image', midia: true, mime: m.imageMessage.mimetype, citada,
    }
  }
  if (m.videoMessage) {
    return {
      corpo: m.videoMessage.caption?.trim() || '[vídeo]',
      tipo: 'video', midia: true, mime: m.videoMessage.mimetype, citada,
    }
  }
  if (m.audioMessage) {
    return {
      corpo: m.audioMessage.ptt ? '[áudio de voz]' : '[áudio]',
      tipo: 'audio', midia: true, mime: m.audioMessage.mimetype, citada,
    }
  }
  if (m.documentMessage) {
    const nome = m.documentMessage.fileName ?? m.documentMessage.title
    return {
      corpo: m.documentMessage.caption?.trim() || (nome ? `[documento: ${nome}]` : '[documento]'),
      tipo: 'document', midia: true, nomeArquivo: nome, mime: m.documentMessage.mimetype, citada,
    }
  }
  if (m.stickerMessage) {
    return { corpo: '[figurinha]', tipo: 'image', midia: true, mime: m.stickerMessage.mimetype, citada }
  }
  if (m.locationMessage || m.liveLocationMessage) {
    const loc = m.locationMessage ?? m.liveLocationMessage
    const nome = loc.name ?? loc.address
    return { corpo: nome ? `[localização: ${nome}]` : '[localização]', tipo: 'location', midia: false, citada }
  }
  if (m.contactMessage || m.contactsArrayMessage) {
    return { corpo: '[contato compartilhado]', tipo: 'other', midia: false, citada }
  }
  if (m.reactionMessage) {
    return {
      corpo: `[reagiu ${m.reactionMessage.text ?? ''}]`.trim(),
      tipo: 'reaction', midia: false,
      citada: m.reactionMessage.key?.id ?? citada,
    }
  }
  if (m.pollCreationMessage || m.pollCreationMessageV3) {
    return { corpo: '[enquete]', tipo: 'other', midia: false, citada }
  }

  const tipoCru = Object.keys(m).find(k => k !== 'messageContextInfo') ?? 'desconhecido'
  return { corpo: `[mensagem do tipo ${tipoCru}]`, tipo: 'other', midia: false, citada }
}

function primeiroContexto(m: Record<string, any>): string | undefined {
  for (const valor of Object.values(m)) {
    const id = (valor as { contextInfo?: { stanzaId?: string } } | null)?.contextInfo?.stanzaId
    if (typeof id === 'string' && id) return id
  }
  return undefined
}

// Epoch em SEGUNDOS (número, string ou o Long do protobuf serializado).
function instante(ts: DadosMensagem['messageTimestamp']): string | undefined {
  const n = typeof ts === 'object' && ts !== null ? ts.low : Number(ts)
  if (!n || !Number.isFinite(n)) return undefined
  return new Date(n * 1000).toISOString()
}

function limparChave(key: ChaveMensagem): ChaveMensagem {
  return { remoteJid: key.remoteJid, fromMe: key.fromMe, id: key.id }
}

function semBinarios(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(semBinarios)
  if (valor && typeof valor === 'object') {
    const saida: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(valor)) {
      if (CHAVES_BINARIAS.has(k)) continue
      saida[k] = semBinarios(v)
    }
    return saida
  }
  return valor
}
