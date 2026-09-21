// Verifica o provider da Meta e o normalizador de payload, com `fetch` e
// Supabase dublês. Não gasta cota, não precisa de token real, não toca banco:
//
//   npx tsx --conditions react-server modules/atendimento/providers/meta-waba.test.mts
//
// O que se prova, e por que cada item importa:
//
//   1. O CORPO DO ENVIO tem o shape que a Graph API exige, e o telefone vai só
//      com dígitos — a Meta rejeita `+`, espaço e parêntese, e display_phone
//      vem de fonte humana, frequentemente formatado.
//
//   2. A CLASSIFICAÇÃO VEM DO CÓDIGO NO CORPO, NÃO DO STATUS. A Meta devolve
//      400 tanto para "fora da janela de 24h" (regra de negócio, definitiva)
//      quanto para "token expirado" (configuração). Se os dois virarem o mesmo
//      erro, a fila retenta uma recusa que nunca vai mudar até esgotar as
//      tentativas — e o responsável fica sem resposta.
//
//   3. NENHUMA MENSAGEM É DESCARTADA. Todo tipo — áudio, figurinha, botão, um
//      tipo que a Meta inventar amanhã — vira uma linha com body legível. Uma
//      mensagem filtrada aqui sumiria do histórico da clínica sem rastro.
//
//   4. O TIMESTAMP é epoch em SEGUNDOS. Tratá-lo como ms daria 1970.
//
// Sem framework, como os outros testes do módulo.

import { MetaWabaProvider, JanelaAtendimentoFechadaError } from './meta-waba.provider.js'
import { normalizarMensagemMeta } from './meta-waba.normalizar.js'
import { ProviderError } from '../types/errors.types.js'
import type { Channel } from '../types/central.types.js'

let falhas = 0
function checar(condicao: boolean, descricao: string, extra?: unknown) {
  if (condicao) {
    console.log(`  ok   ${descricao}`)
  } else {
    falhas++
    console.error(`  FALHA ${descricao}`)
    if (extra !== undefined) console.error('        ', extra)
  }
}

async function capturar(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn()
    return null
  } catch (err) {
    return err
  }
}

// ----------------------------------------------------------------------------
// Dublês
// ----------------------------------------------------------------------------
const fetchOriginal = globalThis.fetch
let ultimaChamada: { url: string; corpo: any; headers: any } | null = null

function chamadaFeita() {
  if (!ultimaChamada) throw new Error('nenhuma chamada capturada')
  return ultimaChamada
}

function fingirMeta(status: number, corpo: unknown) {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    ultimaChamada = {
      url: String(url),
      corpo: init?.body ? JSON.parse(String(init.body)) : null,
      headers: init?.headers,
    }
    const texto = typeof corpo === 'string' ? corpo : JSON.stringify(corpo)
    return new Response(texto, { status })
  }) as typeof globalThis.fetch
}

// Supabase dublê: devolve a connection pedida.
function supabaseCom(metadata: unknown) {
  return {
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            async maybeSingle() {
              return { data: metadata === null ? null : { provider_metadata: metadata }, error: null }
            },
          }),
        }),
      }),
    }),
  } as any
}

const CANAL = { id: 'canal-1', provider: 'meta_waba' } as unknown as Channel
const ACEITE_OK = { messages: [{ id: 'wamid.ENVIADO001' }] }

process.env.META_WABA_TOKEN = 'token-de-teste'

// ----------------------------------------------------------------------------
console.log('\n1. corpo do envio')

{
  const p = new MetaWabaProvider(supabaseCom({ phone_number_id: 'PHONE123' }))
  fingirMeta(200, ACEITE_OK)
  const r = await p.sendMessage(CANAL, { to: '+55 (11) 98888-7777', body: 'Bom dia!', messageType: 'text' })

  const c = chamadaFeita()
  checar(c.url.includes('/PHONE123/messages'), 'usa o phone_number_id da channel_connections', c.url)
  checar(c.url.includes('graph.facebook.com'), 'aponta para a Graph API')
  checar(c.corpo.messaging_product === 'whatsapp', 'messaging_product obrigatório')
  checar(c.corpo.to === '5511988887777',
    'telefone vai SÓ COM DÍGITOS (a Meta rejeita +, espaço e parêntese)', c.corpo.to)
  checar(c.corpo.text?.body === 'Bom dia!', 'corpo da mensagem')
  checar(c.corpo.text?.preview_url === false, 'preview_url desligado')
  checar((c.headers as any).Authorization === 'Bearer token-de-teste', 'token no header')
  checar(!('context' in c.corpo), 'sem replyToId, a chave context é omitida')

  checar(r.externalId === 'wamid.ENVIADO001', 'devolve o id da Meta (é o que amarra o webhook de status)')
  checar(r.status === 'sent',
    "status 'sent' e não 'delivered' — a Meta ACEITOU; a entrega chega depois pelo webhook")
  checar(typeof r.sentAt === 'string', 'sentAt preenchido')
}

{
  const p = new MetaWabaProvider(supabaseCom({ phone_number_id: 'PHONE123' }))
  fingirMeta(200, ACEITE_OK)
  await p.sendMessage(CANAL, { to: '5511988887777', body: 'oi', messageType: 'text', replyToId: 'wamid.ANTERIOR' })
  checar(chamadaFeita().corpo.context?.message_id === 'wamid.ANTERIOR', 'replyToId vira context.message_id')
}

// ----------------------------------------------------------------------------
console.log('\n2. classificação de erro pelo CÓDIGO, não pelo status')

{
  const p = new MetaWabaProvider(supabaseCom({ phone_number_id: 'PHONE123' }))
  // 400 com 131047 = fora da janela de 24h.
  fingirMeta(400, { error: { message: 'Re-engagement message', code: 131047 } })
  const e = await capturar(() => p.sendMessage(CANAL, { to: '5511988887777', body: 'oi', messageType: 'text' }))
  checar(e instanceof JanelaAtendimentoFechadaError,
    'código 131047 → JanelaAtendimentoFechadaError (regra de negócio, NÃO retentável)', e)
}

{
  const p = new MetaWabaProvider(supabaseCom({ phone_number_id: 'PHONE123' }))
  // MESMO status 400, código diferente = token expirado.
  fingirMeta(400, { error: { message: 'Session has expired', code: 190 } })
  const e = await capturar(() => p.sendMessage(CANAL, { to: '5511988887777', body: 'oi', messageType: 'text' }))
  checar(e instanceof ProviderError && !(e instanceof JanelaAtendimentoFechadaError),
    'MESMO 400 com código 190 → ProviderError comum (ramificar pelo status faria os dois virarem a mesma coisa)', e)
  checar(String((e as Error).message).includes('190') || String((e as Error).message).includes('expired'),
    'a mensagem da Meta chega íntegra ao log')
}

{
  const p = new MetaWabaProvider(supabaseCom({ phone_number_id: 'PHONE123' }))
  fingirMeta(400, { error: { message: 'genérico', code: 100, error_data: { details: 'o detalhe específico' } } })
  const e = await capturar(() => p.sendMessage(CANAL, { to: '5511988887777', body: 'oi', messageType: 'text' }))
  checar(String((e as Error).message).includes('o detalhe específico'),
    'error_data.details entra na mensagem — costuma ser o que diz o que corrigir')
}

{
  const p = new MetaWabaProvider(supabaseCom({ phone_number_id: 'PHONE123' }))
  fingirMeta(200, { nao_tem: 'messages' })
  const e = await capturar(() => p.sendMessage(CANAL, { to: '5511988887777', body: 'oi', messageType: 'text' }))
  checar(e instanceof ProviderError,
    '200 sem messages[0].id lança — sem esse id o webhook de status nunca acha a mensagem', e)
}

// ----------------------------------------------------------------------------
console.log('\n3. configuração ausente')

{
  const p = new MetaWabaProvider(supabaseCom({}))
  fingirMeta(200, ACEITE_OK)
  const e = await capturar(() => p.sendMessage(CANAL, { to: '5511988887777', body: 'oi', messageType: 'text' }))
  checar(e instanceof ProviderError && String((e as Error).message).includes('phone_number_id'),
    'connection sem phone_number_id lança dizendo o que falta', e)
}

{
  const salvo = process.env.META_WABA_TOKEN
  delete process.env.META_WABA_TOKEN
  const p = new MetaWabaProvider(supabaseCom({ phone_number_id: 'PHONE123' }))
  let tocouRede = false
  globalThis.fetch = (async () => { tocouRede = true; return new Response('{}') }) as typeof globalThis.fetch
  const e = await capturar(() => p.sendMessage(CANAL, { to: '5511988887777', body: 'oi', messageType: 'text' }))
  checar(e instanceof ProviderError && String((e as Error).message).includes('META_WABA_TOKEN'),
    'sem META_WABA_TOKEN lança apontando a env', e)
  checar(!tocouRede, 'não tenta a rede sem token')
  process.env.META_WABA_TOKEN = salvo
}

// ----------------------------------------------------------------------------
console.log('\n3b. mídia: envio por media ID, nunca por URL pública')

{
  // Sem mediaId não há o que enviar, e a falha precisa dizer o que falta —
  // "chame uploadMedia antes" é acionável, um 400 da Meta não é.
  const p = new MetaWabaProvider(supabaseCom({ phone_number_id: 'PHONE123' }))
  let tocouRede = false
  globalThis.fetch = (async () => { tocouRede = true; return new Response('{}') }) as typeof globalThis.fetch
  const e = await capturar(() => p.sendMedia(CANAL, { to: '5511988887777', messageType: 'image' }))
  checar(e instanceof ProviderError && String((e as Error).message).includes('uploadMedia'),
    'sendMedia sem mediaId aponta o uploadMedia que falta', e)
  checar(!tocouRede, 'não gasta chamada à Meta sem mediaId')
}

{
  // O corpo montado é o contrato com a Graph API. O que se prova aqui é que a
  // mídia vai por `id` — se um dia alguém trocar por `link`, o bucket teria que
  // virar público e o áudio de paciente ficaria servível a quem souber o path.
  const p = new MetaWabaProvider(supabaseCom({ phone_number_id: 'PHONE123' }))
  let enviado: any = null
  globalThis.fetch = (async (_u: any, init: any) => {
    enviado = JSON.parse(init.body)
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.MEDIA' }] }))
  }) as typeof globalThis.fetch

  const r = await p.sendMedia(CANAL, {
    to: '+55 (11) 98888-7777', messageType: 'image',
    mediaId: 'MEDIA_ID_1', caption: 'o laudo dele',
  })

  checar(enviado?.type === 'image', 'type é o da mídia, não "text"', enviado?.type)
  checar(enviado?.image?.id === 'MEDIA_ID_1', 'a mídia vai por ID', enviado?.image)
  checar(enviado?.image?.link === undefined,
    'NUNCA por link: link exigiria bucket público com dado de paciente', enviado?.image)
  checar(enviado?.image?.caption === 'o laudo dele', 'legenda acompanha a imagem')
  checar(enviado?.to === '5511988887777', 'o destino é normalizado para só dígitos', enviado?.to)
  checar(r.externalId === 'wamid.MEDIA' && r.status === 'sent', 'devolve o id da Meta e status sent', r)
}

{
  // Áudio com legenda: a Meta RECUSA a chamada inteira se `caption` vier num
  // áudio. O filtro é por tipo, e não geral, porque imagem e documento aceitam.
  const p = new MetaWabaProvider(supabaseCom({ phone_number_id: 'PHONE123' }))
  let enviado: any = null
  globalThis.fetch = (async (_u: any, init: any) => {
    enviado = JSON.parse(init.body)
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.A' }] }))
  }) as typeof globalThis.fetch

  await p.sendMedia(CANAL, {
    to: '5511988887777', messageType: 'audio', mediaId: 'M2', caption: 'escuta isso',
  })
  checar(enviado?.audio?.caption === undefined,
    'áudio NÃO leva legenda — a Meta recusaria o envio inteiro', enviado?.audio)
}

{
  // `filename` só existe em documento, e é o que o destinatário vê na bolha.
  // Sem ele a Meta inventa um nome e ninguém sabe o que recebeu.
  const p = new MetaWabaProvider(supabaseCom({ phone_number_id: 'PHONE123' }))
  let enviado: any = null
  globalThis.fetch = (async (_u: any, init: any) => {
    enviado = JSON.parse(init.body)
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.D' }] }))
  }) as typeof globalThis.fetch

  await p.sendMedia(CANAL, {
    to: '5511988887777', messageType: 'document', mediaId: 'M3',
    fileName: 'laudo.pdf', caption: 'segue',
  })
  checar(enviado?.document?.filename === 'laudo.pdf', 'documento leva o nome do arquivo', enviado?.document)
  checar(enviado?.document?.caption === 'segue', 'documento também aceita legenda')
}

{
  // Figurinha não é enviável como sticker (exige WebP com restrições próprias).
  // Degradar para documento entrega o arquivo; recusar não entregaria nada.
  const p = new MetaWabaProvider(supabaseCom({ phone_number_id: 'PHONE123' }))
  let enviado: any = null
  globalThis.fetch = (async (_u: any, init: any) => {
    enviado = JSON.parse(init.body)
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.S' }] }))
  }) as typeof globalThis.fetch

  await p.sendMedia(CANAL, { to: '5511988887777', messageType: 'sticker', mediaId: 'M4' })
  checar(enviado?.type === 'document', 'tipo desconhecido degrada para documento', enviado?.type)
}

{
  // O upload é multipart e NÃO pode declarar Content-Type à mão: o boundary é
  // gerado pelo runtime, e um header fixo produziria um boundary que não bate
  // com o corpo — a Meta recusa com uma mensagem que não ajuda ninguém.
  const p = new MetaWabaProvider(supabaseCom({ phone_number_id: 'PHONE123' }))
  let init: any = null
  let url = ''
  globalThis.fetch = (async (u: any, i: any) => {
    url = String(u); init = i
    return new Response(JSON.stringify({ id: 'MEDIA_NOVO' }))
  }) as typeof globalThis.fetch

  const r = await p.uploadMedia(CANAL, {
    bytes: new TextEncoder().encode('conteudo').buffer as ArrayBuffer,
    mimeType: 'application/pdf',
    fileName: 'laudo.pdf',
  })

  checar(r.externalId === 'MEDIA_NOVO', 'devolve o media ID', r)
  checar(url.endsWith('/PHONE123/media'), 'usa o endpoint de mídia do número', url)
  checar(init?.body instanceof FormData, 'o corpo é multipart')
  checar(
    !Object.keys(init?.headers ?? {}).some(h => h.toLowerCase() === 'content-type'),
    'não define Content-Type à mão — o boundary é do runtime',
    init?.headers,
  )
  checar(init?.headers?.Authorization === 'Bearer token-de-teste', 'o upload leva o token')
}

// ----------------------------------------------------------------------------
console.log('\n4. cache de connection')

{
  let consultas = 0
  const supabase = {
    schema: () => ({ from: () => ({ select: () => ({ eq: () => ({
      async maybeSingle() { consultas++; return { data: { provider_metadata: { phone_number_id: 'P1' } }, error: null } },
    }) }) }) }),
  } as any
  const p = new MetaWabaProvider(supabase)
  fingirMeta(200, ACEITE_OK)
  await p.sendMessage(CANAL, { to: '5511988887777', body: 'a', messageType: 'text' })
  await p.sendMessage(CANAL, { to: '5511988887777', body: 'b', messageType: 'text' })
  checar(consultas === 1, 'a connection é consultada uma vez e reusada do cache', consultas)
}

// ----------------------------------------------------------------------------
console.log('\n5. normalização: nenhuma mensagem é descartada')

const base = { id: 'wamid.1', from: '5511988887777', timestamp: '1756600000' }

{
  const n = normalizarMensagemMeta({ ...base, type: 'text', text: { body: 'quero marcar' } })
  checar(n.body === 'quero marcar', 'texto simples')
  checar(n.messageType === 'text', 'tipo text')
  checar(n.externalMessageId === 'wamid.1', 'id preservado (é a chave de dedup)')
  checar(n.from === '5511988887777', 'from preservado')
  checar(n.sentAt === new Date(1756600000 * 1000).toISOString(),
    'timestamp é epoch em SEGUNDOS — tratá-lo como ms daria 1970', n.sentAt)
}

{
  const n = normalizarMensagemMeta({ ...base, type: 'text', text: { body: 'x' }, context: { id: 'wamid.ANTERIOR' } })
  checar(n.replyToExternalId === 'wamid.ANTERIOR', 'mensagem citada vira replyToExternalId')
}

for (const [rotulo, msg, esperado, tipoEsperado] of [
  ['áudio de voz', { type: 'audio', audio: { id: 'MID1', voice: true, mime_type: 'audio/ogg' } }, '[áudio de voz]', 'audio'],
  ['áudio anexado', { type: 'audio', audio: { id: 'MID1', voice: false } }, '[áudio]', 'audio'],
  ['imagem sem legenda', { type: 'image', image: { id: 'MID2' } }, '[imagem]', 'image'],
  ['figurinha', { type: 'sticker', sticker: { id: 'MID3' } }, '[figurinha]', 'image'],
  ['localização', { type: 'location', location: { latitude: -23, longitude: -46, name: 'Clínica' } }, '[localização: Clínica]', 'location'],
  ['reação', { type: 'reaction', reaction: { emoji: '👍', message_id: 'w' } }, '[reagiu 👍]', 'reaction'],
  ['tipo novo da Meta', { type: 'tipo_que_ainda_nao_existe' }, '[mensagem do tipo tipo_que_ainda_nao_existe]', 'other'],
] as const) {
  const n = normalizarMensagemMeta({ ...base, ...(msg as object) })
  checar(n.body === esperado, `${rotulo} → body legível, nunca vazio`, n.body)
  checar(n.messageType === tipoEsperado, `${rotulo} → tipo ${tipoEsperado}`, n.messageType)
}

{
  const n = normalizarMensagemMeta({ ...base, type: 'image', image: { id: 'MID', caption: 'olha o laudo' } })
  checar(n.body === 'olha o laudo', 'legenda da imagem vira o corpo (é o que a IA precisa ler)')
}

{
  const n = normalizarMensagemMeta({ ...base, type: 'document', document: { id: 'MID', filename: 'laudo.pdf' } })
  checar(n.body === '[documento: laudo.pdf]', 'documento sem legenda mostra o nome do arquivo', n.body)
}

{
  const n = normalizarMensagemMeta({ ...base, type: 'button', button: { text: 'Confirmar', payload: 'sim' } })
  checar(n.body === 'Confirmar' && n.messageType === 'text',
    'botão de template vira texto — foi o que a pessoa tocou')
}

{
  const n = normalizarMensagemMeta({ ...base, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: '1', title: 'Terça 9h' } } })
  checar(n.body === 'Terça 9h', 'resposta interativa vira texto', n.body)
}

{
  const n = normalizarMensagemMeta({ ...base, type: 'unsupported', errors: [{ code: 131051, title: 'Tipo não suportado' }] })
  checar(n.body === '[mensagem não suportada: Tipo não suportado]',
    'o erro da própria Meta é mais útil que texto genérico nosso', n.body)
}

{
  const n = normalizarMensagemMeta({ ...base, type: 'text', text: { body: '   ' } })
  checar(n.body === '[mensagem de texto vazia]',
    'texto só de espaços vira marcador — body vazio deixaria o modelo mudo', n.body)
}

// ----------------------------------------------------------------------------
console.log('\n6. anexos: o id da mídia é guardado')

{
  const n = normalizarMensagemMeta({ ...base, type: 'audio', audio: { id: 'MEDIA123', mime_type: 'audio/ogg' } })
  checar(n.attachments?.length === 1, 'um anexo')
  checar(n.attachments?.[0]?.externalUrl === 'MEDIA123',
    'guarda o ID da mídia — a Meta expira o arquivo em 30 dias e o id é a única forma de pedi-lo')
  checar(n.attachments?.[0]?.fileType === 'audio/ogg', 'mime type preservado')
}

{
  const n = normalizarMensagemMeta({ ...base, type: 'text', text: { body: 'oi' } })
  checar(n.attachments === undefined, 'texto puro não gera anexo')
}

// ----------------------------------------------------------------------------
console.log('\n7. identidade ausente lança (sem id não há dedup)')

{
  let erro: unknown = null
  try { normalizarMensagemMeta({ from: '55119', type: 'text' }) } catch (e) { erro = e }
  checar(erro instanceof Error && String((erro as Error).message).includes('id'),
    'sem id lança — sem dedup a reentrega da Meta viraria resposta dobrada')
}

{
  let erro: unknown = null
  try { normalizarMensagemMeta({ id: 'wamid.1', type: 'text' }) } catch (e) { erro = e }
  checar(erro instanceof Error && String((erro as Error).message).includes('from'),
    'sem from lança — não haveria como saber de quem é')
}

globalThis.fetch = fetchOriginal

// ----------------------------------------------------------------------------
console.log(
  falhas === 0
    ? '\nTodas as asserções passaram.\n'
    : `\n${falhas} asserção(ões) falharam.\n`,
)
process.exit(falhas === 0 ? 0 : 1)
