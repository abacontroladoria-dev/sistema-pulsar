import type { AnuncioDaMensagem, NormalizedIncomingMessage } from '../types/central.types'

// ============================================================================
// Normalização do payload da Meta → NormalizedIncomingMessage
//
// Função PURA, em arquivo próprio: sem rede, sem banco, sem env. É o que
// permite testá-la contra payloads reais capturados, que é a única forma
// honesta de verificar um parser de formato externo.
//
// A REGRA QUE GOVERNA O ARQUIVO: NADA É DESCARTADO EM SILÊNCIO.
//
// Toda mensagem que chega vira uma linha em central.messages, mesmo quando é de
// um tipo que ainda não sabemos tratar. Um áudio que não conseguimos transcrever
// ainda precisa aparecer na conversa da Central com "[áudio]" — para a
// recepcionista ver que alguém mandou algo e responder. Filtrar aqui faria a
// mensagem sumir do histórico da clínica sem deixar rastro, e o responsável
// ficaria sem resposta sem ninguém saber por quê.
//
// Por isso `body` nunca é vazio: tipos sem texto ganham um marcador legível.
// ============================================================================

// O que a Meta manda em `messages[].type`. Fechado no que tratamos hoje; o
// resto cai em 'other' com marcador, nunca em erro.
type TipoMeta =
  | 'text' | 'audio' | 'image' | 'video' | 'document' | 'sticker'
  | 'location' | 'contacts' | 'button' | 'interactive' | 'reaction' | 'order'
  | 'system' | 'unsupported'

interface MensagemMeta {
  id?: string
  from?: string
  timestamp?: string
  type?: TipoMeta | string
  text?: { body?: string }
  // Botão de template (`button`) e botão/lista de mensagem interativa
  // (`interactive`) chegam em formatos diferentes, mas para a conversa os dois
  // são "a pessoa escolheu esta opção" — viram texto.
  button?: { text?: string; payload?: string }
  interactive?: {
    type?: string
    button_reply?: { id?: string; title?: string }
    list_reply?: { id?: string; title?: string; description?: string }
  }
  audio?: MidiaMeta
  image?: MidiaMeta & { caption?: string }
  video?: MidiaMeta & { caption?: string }
  document?: MidiaMeta & { caption?: string; filename?: string }
  sticker?: MidiaMeta
  location?: { latitude?: number; longitude?: number; name?: string; address?: string }
  reaction?: { message_id?: string; emoji?: string }
  errors?: { code?: number; title?: string; message?: string }[]
  context?: { id?: string }
  // Clique num anúncio Click-to-WhatsApp: vem na primeira mensagem que o
  // clique gera. `source_type` é 'ad' ou 'post'.
  referral?: {
    source_url?: string
    source_id?: string
    source_type?: string
    headline?: string
    body?: string
    ctwa_clid?: string
  }
}

interface MidiaMeta {
  id?: string
  mime_type?: string
  sha256?: string
  voice?: boolean
}

/**
 * Converte uma mensagem crua da Meta na forma que `MessageService.receive()`
 * espera. Lança apenas quando falta identidade — sem `id` não há como
 * deduplicar, e sem dedup a reentrega da Meta vira resposta dobrada.
 */
export function normalizarMensagemMeta(raw: unknown): NormalizedIncomingMessage {
  const m = (raw ?? {}) as MensagemMeta

  if (!m.id) {
    throw new Error('mensagem da Meta sem `id`: impossível deduplicar')
  }
  if (!m.from) {
    throw new Error(`mensagem ${m.id} sem \`from\`: impossível identificar o contato`)
  }

  const { corpo, tipo } = interpretarConteudo(m)

  return {
    externalMessageId: m.id,
    from: m.from,
    body: corpo,
    messageType: tipo,
    // O timestamp da Meta é epoch em SEGUNDOS, string. `new Date(x)` com o
    // número em segundos daria 1970 — daí o × 1000. Ausente, quem grava usa
    // now(), que é melhor que uma data errada.
    sentAt: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : undefined,
    // `context.id` é a mensagem citada. Amarra a resposta ao que ela responde,
    // e é o que permite entender "sim" quando vem citando uma pergunta antiga.
    // Na reação o alvo não vem em `context`, e sim em `reaction.message_id`.
    replyToExternalId: m.context?.id ?? m.reaction?.message_id,
    attachments: extrairAnexos(m),
    anuncio: extrairAnuncio(m),
  }
}

// ----------------------------------------------------------------------------
// Anúncio de origem (referral). Sem ad_id nem ctwa_clid não há o que atribuir.
// ----------------------------------------------------------------------------
function extrairAnuncio(m: MensagemMeta): AnuncioDaMensagem | undefined {
  const r = m.referral
  if (!r) return undefined
  const adId = r.source_id ? String(r.source_id) : null
  const ctwaClid = r.ctwa_clid ?? null
  if (!adId && !ctwaClid) return undefined
  const sourceType = r.source_type ?? null
  return {
    ad_id: adId,
    ctwa_clid: ctwaClid,
    titulo: r.headline?.trim() || null,
    url: r.source_url ?? null,
    source_type: sourceType,
    plataforma: null,
    pago: sourceType !== 'post',
  }
}

// ----------------------------------------------------------------------------
// Conteúdo textual + tipo interno.
//
// O `body` é o que a IA vai ler e o que aparece na Central. Para tipos sem
// texto ele é um marcador entre colchetes — legível por humano e inequívoco
// para o modelo, que assim pode responder "recebi seu áudio, mas ainda não
// consigo ouvir; pode escrever?" em vez de ficar mudo diante de um body vazio.
// ----------------------------------------------------------------------------
function interpretarConteudo(m: MensagemMeta): { corpo: string; tipo: string } {
  switch (m.type) {
    case 'text':
      return { corpo: m.text?.body?.trim() || '[mensagem de texto vazia]', tipo: 'text' }

    case 'button':
      // Template com botão: o título é o que a pessoa viu e tocou.
      return { corpo: m.button?.text?.trim() || '[botão sem rótulo]', tipo: 'text' }

    case 'interactive': {
      const titulo =
        m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title
      return { corpo: titulo?.trim() || '[opção selecionada]', tipo: 'text' }
    }

    case 'audio':
      // `voice: true` distingue o áudio gravado na hora de um arquivo de música
      // anexado. Para a atendente, os dois são "não consigo ler isto ainda".
      return { corpo: m.audio?.voice ? '[áudio de voz]' : '[áudio]', tipo: 'audio' }

    case 'image':
      return { corpo: m.image?.caption?.trim() || '[imagem]', tipo: 'image' }

    case 'video':
      return { corpo: m.video?.caption?.trim() || '[vídeo]', tipo: 'video' }

    case 'document':
      return {
        corpo: m.document?.caption?.trim()
          || (m.document?.filename ? `[documento: ${m.document.filename}]` : '[documento]'),
        tipo: 'document',
      }

    case 'sticker':
      return { corpo: '[figurinha]', tipo: 'image' }

    case 'location': {
      const nome = m.location?.name ?? m.location?.address
      return { corpo: nome ? `[localização: ${nome}]` : '[localização]', tipo: 'location' }
    }

    case 'contacts':
      return { corpo: '[contato compartilhado]', tipo: 'other' }

    case 'reaction':
      // Reação não merece turno da IA (responder a um 👍 com uma frase é ruído),
      // mas precisa existir no histórico. O worker decide ignorá-la; o registro
      // fica.
      return { corpo: `[reagiu ${m.reaction?.emoji ?? ''}]`.trim(), tipo: 'reaction' }

    case 'order':
      return { corpo: '[pedido]', tipo: 'other' }

    case 'unsupported': {
      // A própria Meta avisando que não conseguiu processar. A mensagem do erro
      // dela é mais útil que qualquer texto nosso.
      const detalhe = m.errors?.[0]?.title ?? m.errors?.[0]?.message
      return {
        corpo: detalhe ? `[mensagem não suportada: ${detalhe}]` : '[mensagem não suportada]',
        tipo: 'other',
      }
    }

    default:
      // Tipo novo no catálogo da Meta. Registrar o nome cru é o que permite
      // descobrir depois o que apareceu, em vez de só ver "[desconhecido]".
      return { corpo: `[mensagem do tipo ${m.type ?? 'desconhecido'}]`, tipo: 'other' }
  }
}

// ----------------------------------------------------------------------------
// Anexos
//
// A Meta NÃO manda a mídia: manda um `id` que precisa ser trocado por uma URL
// temporária numa segunda chamada. Guardamos o id como `externalUrl` — não é
// uma URL, e o campo mente um pouco, mas é a identidade que permite baixar o
// arquivo depois, quando o download de mídia for implementado.
//
// Sem isso, o áudio de hoje seria irrecuperável amanhã: a Meta expira a mídia
// em 30 dias e o id é a única forma de pedi-la.
// ----------------------------------------------------------------------------
function extrairAnexos(m: MensagemMeta): NormalizedIncomingMessage['attachments'] {
  const midia = m.audio ?? m.image ?? m.video ?? m.document ?? m.sticker
  if (!midia?.id) return undefined

  return [{
    externalUrl: midia.id,
    fileType: midia.mime_type,
    fileName: m.document?.filename,
  }]
}
