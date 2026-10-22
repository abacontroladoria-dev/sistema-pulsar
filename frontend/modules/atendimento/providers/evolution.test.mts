// Verifica o normalizador do webhook da Evolution e a regra do 9º dígito.
// Puro: sem rede, sem banco, sem env.
//
//   npx tsx modules/atendimento/providers/evolution.test.mts
//
// O que se prova, e por que importa:
//
//   1. GRUPO, STATUS E BROADCAST NÃO VIRAM CONVERSA — e voltam como `ignorado`
//      com motivo, para o log do webhook dizer por que a mensagem não apareceu.
//   2. `@lid` SEM TELEFONE É IGNORADO. Criar contato com um LID no lugar do
//      telefone geraria alguém para quem não se consegue responder.
//   3. MÍDIA GUARDA A REFERÊNCIA SEM BINÁRIO. A miniatura em base64 não pode ir
//      para `external_url`; a chave para pedir o arquivo, sim.
//   4. fromMe NÃO BATIZA O CONTATO. O pushName de uma mensagem nossa é o nome
//      do número da clínica.
//   5. STATUS numérico (v1) e por nome (v2) caem no mesmo vocabulário.
//   6. 9º DÍGITO: as duas variantes do celular brasileiro, nada para fixo/exterior.
//
// Sem framework, como os outros testes do módulo.

import { normalizarWebhookEvolution } from './evolution.normalizar.js'
import { variantesBr, digitosDoJid } from '../utils/telefone-br.js'

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

function upsert(data: unknown) {
  return { event: 'messages.upsert', instance: 'org_abc_mkt_1a2b3c', data }
}

console.log('texto simples (v2)')
{
  const [e] = normalizarWebhookEvolution(upsert({
    key: { remoteJid: '5511987654321@s.whatsapp.net', fromMe: false, id: 'ABC123' },
    pushName: 'Maria Souza',
    message: { conversation: 'Olá, bom dia' },
    messageTimestamp: 1758700000,
  }))
  checar(e?.tipo === 'mensagem', 'vira mensagem', e)
  if (e?.tipo === 'mensagem') {
    checar(e.telefone === '5511987654321', 'telefone só dígitos')
    checar(e.nomePerfil === 'Maria Souza', 'nome de perfil vem do pushName')
    checar(e.mensagem.body === 'Olá, bom dia', 'corpo')
    checar(e.mensagem.messageType === 'text', 'tipo text')
    checar(e.mensagem.externalMessageId === 'ABC123', 'id externo')
    checar(e.mensagem.sentAt === new Date(1758700000 * 1000).toISOString(), 'timestamp em segundos')
  }
}

console.log('texto estendido com citação')
{
  const [e] = normalizarWebhookEvolution(upsert({
    key: { remoteJid: '5511987654321@s.whatsapp.net', fromMe: false, id: 'R1' },
    message: { extendedTextMessage: { text: 'sim', contextInfo: { stanzaId: 'PERGUNTA1' } } },
  }))
  checar(e?.tipo === 'mensagem' && e.mensagem.replyToExternalId === 'PERGUNTA1', 'citação vira replyToExternalId', e)
}

console.log('v1: data.messages[]')
{
  const eventos = normalizarWebhookEvolution(upsert({
    messages: [
      { key: { remoteJid: '5511987654321@s.whatsapp.net', id: 'V1A' }, message: { conversation: 'a' } },
      { key: { remoteJid: '5511987654321@s.whatsapp.net', id: 'V1B' }, message: { conversation: 'b' } },
    ],
  }))
  checar(eventos.length === 2 && eventos.every(e => e.tipo === 'mensagem'), 'duas mensagens', eventos)
}

console.log('descartes com motivo')
{
  const grupo = normalizarWebhookEvolution(upsert({
    key: { remoteJid: '120363000000000000@g.us', id: 'G1' }, message: { conversation: 'oi grupo' },
  }))[0]
  checar(grupo?.tipo === 'ignorado' && /grupo/.test(grupo.motivo), 'grupo ignorado', grupo)

  const status = normalizarWebhookEvolution(upsert({
    key: { remoteJid: 'status@broadcast', id: 'S1' }, message: { imageMessage: {} },
  }))[0]
  checar(status?.tipo === 'ignorado', 'status do WhatsApp ignorado', status)

  const semId = normalizarWebhookEvolution(upsert({
    key: { remoteJid: '5511987654321@s.whatsapp.net' }, message: { conversation: 'x' },
  }))[0]
  checar(semId?.tipo === 'ignorado', 'sem key.id ignorado', semId)

  const edicao = normalizarWebhookEvolution(upsert({
    key: { remoteJid: '5511987654321@s.whatsapp.net', id: 'E1' },
    message: { protocolMessage: { type: 14 } },
  }))[0]
  checar(edicao?.tipo === 'ignorado', 'edição (protocolMessage) ignorada', edicao)

  // Payload real (22/10, 5521920043824): a pessoa editou a mensagem anterior.
  const edicaoCifrada = normalizarWebhookEvolution(upsert({
    key: { remoteJid: '5521920043824@s.whatsapp.net', id: '3AAEB3065720C1EC29F5' },
    message: { secretEncryptedMessage: { secretEncType: 2, encIv: {}, encPayload: {}, targetMessageKey: { id: '3AAF8A479CD61B7A6446' } } },
    messageType: 'secretEncryptedMessage',
  }))[0]
  checar(edicaoCifrada?.tipo === 'ignorado', 'edição cifrada (secretEncryptedMessage) ignorada', edicaoCifrada)

  const desconhecido = normalizarWebhookEvolution({ event: 'chats.update', instance: 'x', data: {} })[0]
  checar(desconhecido?.tipo === 'ignorado', 'evento não tratado ignorado', desconhecido)
}

console.log('contato compartilhado')
{
  // vCard real (22/10, 5521920043824), descrição encurtada.
  const [e] = normalizarWebhookEvolution(upsert({
    key: { remoteJid: '5521920043824@s.whatsapp.net', fromMe: false, id: '3A16B904BD14255252D1' },
    message: {
      contactMessage: {
        displayName: 'UniversoABA',
        vcard: 'BEGIN:VCARD\nVERSION:3.0\nN:;UniversoABA;;;\nFN:UniversoABA\nX-WA-BIZ-NAME:Universo ABA\nORG:UniversoABA;\nTEL;type=CELL;type=VOICE;waid=5521991913429:+55 21 99191-3429\nEND:VCARD',
      },
    },
    messageType: 'contactMessage',
  }))
  checar(e?.tipo === 'mensagem' && e.mensagem.body === '[contato compartilhado: UniversoABA · +55 21 99191-3429]',
    'cartão vira nome + telefone no corpo', e?.tipo === 'mensagem' ? e.mensagem.body : e)
  checar(e?.tipo === 'mensagem' && e.mensagem.messageType === 'contact', 'tipo contact (a tela desenha o cartão)')

  const [varios] = normalizarWebhookEvolution(upsert({
    key: { remoteJid: '5511987654321@s.whatsapp.net', id: 'CA1' },
    message: {
      contactsArrayMessage: {
        contacts: [
          { displayName: 'Ana', vcard: 'BEGIN:VCARD\nFN:Ana\nitem1.TEL;waid=5511911112222:+55 11 91111-2222\nEND:VCARD' },
          { displayName: 'Bia', vcard: 'BEGIN:VCARD\nFN:Bia\nTEL;waid=5511933334444:\nEND:VCARD' },
        ],
      },
    },
  }))
  checar(varios?.tipo === 'mensagem'
    && varios.mensagem.body === '[contatos compartilhados: Ana · +55 11 91111-2222; Bia · +5511933334444]',
    'vários cartões; grupo item1. e TEL só com waid', varios?.tipo === 'mensagem' ? varios.mensagem.body : varios)
}

console.log('@lid')
{
  const semAlt = normalizarWebhookEvolution(upsert({
    key: { remoteJid: '123456789012345@lid', id: 'L1' }, message: { conversation: 'oi' },
  }))[0]
  checar(semAlt?.tipo === 'ignorado' && /lid/.test(semAlt.motivo), '@lid sem telefone ignorado', semAlt)

  const comAlt = normalizarWebhookEvolution(upsert({
    key: { remoteJid: '123456789012345@lid', remoteJidAlt: '5521912345678@s.whatsapp.net', id: 'L2' },
    message: { conversation: 'oi' },
  }))[0]
  checar(comAlt?.tipo === 'mensagem' && comAlt.telefone === '5521912345678', '@lid com remoteJidAlt usa o telefone', comAlt)
}

console.log('mídia')
{
  const [e] = normalizarWebhookEvolution(upsert({
    key: { remoteJid: '5511987654321@s.whatsapp.net', fromMe: false, id: 'IMG1' },
    message: {
      imageMessage: {
        caption: 'receita', mimetype: 'image/jpeg', url: 'https://mmg.whatsapp.net/x',
        mediaKey: 'chave', jpegThumbnail: 'AAAA'.repeat(500),
      },
      base64: 'BBBB'.repeat(500),
    },
  }))
  checar(e?.tipo === 'mensagem' && e.mensagem.messageType === 'image', 'imagem', e)
  if (e?.tipo === 'mensagem') {
    const ref = e.mensagem.attachments?.[0]?.externalUrl ?? ''
    checar(e.mensagem.body === 'receita', 'legenda vira corpo')
    checar(!ref.includes('AAAA') && !ref.includes('BBBB'), 'referência sem miniatura nem base64', ref.slice(0, 120))
    const parsed = JSON.parse(ref)
    checar(parsed.key?.id === 'IMG1' && parsed.message?.imageMessage?.mediaKey === 'chave', 'referência guarda key e mediaKey')
    checar(e.mensagem.attachments?.[0]?.fileType === 'image/jpeg', 'mime do anexo')
  }

  const [audio] = normalizarWebhookEvolution(upsert({
    key: { remoteJid: '5511987654321@s.whatsapp.net', id: 'AUD1' },
    message: { audioMessage: { ptt: true, mimetype: 'audio/ogg; codecs=opus' } },
  }))
  checar(audio?.tipo === 'mensagem' && audio.mensagem.body === '[áudio de voz]', 'áudio de voz com marcador', audio)

  const [doc] = normalizarWebhookEvolution(upsert({
    key: { remoteJid: '5511987654321@s.whatsapp.net', id: 'DOC1' },
    message: { documentWithCaptionMessage: { message: { documentMessage: { fileName: 'laudo.pdf', mimetype: 'application/pdf' } } } },
  }))
  checar(doc?.tipo === 'mensagem' && doc.mensagem.body === '[documento: laudo.pdf]', 'documento embrulhado', doc)

  const [temp] = normalizarWebhookEvolution(upsert({
    key: { remoteJid: '5511987654321@s.whatsapp.net', id: 'EPH1' },
    message: { ephemeralMessage: { message: { conversation: 'some em 24h' } } },
  }))
  checar(temp?.tipo === 'mensagem' && temp.mensagem.body === 'some em 24h', 'mensagem temporária desembrulhada', temp)
}

console.log('fromMe')
{
  const [e] = normalizarWebhookEvolution(upsert({
    key: { remoteJid: '5511987654321@s.whatsapp.net', fromMe: true, id: 'ME1' },
    pushName: 'Clínica Marketing',
    message: { conversation: 'Olá!' },
  }))
  checar(e?.tipo === 'mensagem' && e.fromMe && e.nomePerfil === null, 'fromMe sem nome de perfil', e)
}

console.log('status de entrega')
{
  const [v2] = normalizarWebhookEvolution({
    event: 'messages.update', instance: 'x', data: { keyId: 'K1', status: 'DELIVERY_ACK' },
  })
  checar(v2?.tipo === 'status' && v2.status === 'DELIVERY_ACK' && v2.externalId === 'K1', 'v2 por nome', v2)

  const [v1] = normalizarWebhookEvolution({
    event: 'MESSAGES_UPDATE', instance: 'x', data: { key: { id: 'K2' }, update: { status: 4 } },
  })
  checar(v1?.tipo === 'status' && v1.status === 'READ', 'v1 numérico + evento em maiúsculas', v1)
}

console.log('conexão')
{
  const [e] = normalizarWebhookEvolution({ event: 'connection.update', instance: 'x', data: { state: 'open' } })
  checar(e?.tipo === 'conexao' && e.estado === 'open', 'open', e)
  const [r] = normalizarWebhookEvolution({ event: 'connection.update', instance: 'x', data: { state: 'refused' } })
  checar(r?.tipo === 'ignorado', 'estado desconhecido ignorado', r)
}

console.log('anúncio (externalAdReply)')
{
  // Texto puro: a Evolution v2 põe o contextInfo em data, ao lado da mensagem.
  const [a] = normalizarWebhookEvolution(upsert({
    key: { remoteJid: '5511987654321@s.whatsapp.net', fromMe: false, id: 'AD1' },
    message: { conversation: 'Olá! Tenho interesse e queria mais informações, por favor.' },
    contextInfo: {
      externalAdReply: {
        title: 'Terapia ABA em Goiânia', sourceType: 'ad', sourceId: '120210000000000001',
        sourceUrl: 'https://fb.me/abc?ctwa_clid=CLID123', mediaType: 'IMAGE',
      },
      entryPointConversionSource: 'ctwa_ad',
    },
  }))
  const an = a?.tipo === 'mensagem' ? a.mensagem.anuncio : undefined
  checar(an?.ad_id === '120210000000000001' && an.pago === true, 'texto puro: ad_id em data.contextInfo', an)
  checar(an?.ctwa_clid === 'CLID123', 'ctwa_clid tirado da sourceUrl', an)
  checar(an?.titulo === 'Terapia ABA em Goiânia', 'título do anúncio', an)

  // Tipo com nó: o contextInfo vem no próprio nó.
  const [b] = normalizarWebhookEvolution(upsert({
    key: { remoteJid: '5511987654321@s.whatsapp.net', fromMe: false, id: 'AD2' },
    message: { extendedTextMessage: { text: 'Oi', contextInfo: { externalAdReply: { sourceId: 999, sourceType: 'AD', ctwaClid: 'C2' } } } },
  }))
  const bn = b?.tipo === 'mensagem' ? b.mensagem.anuncio : undefined
  checar(bn?.ad_id === '999' && bn.ctwa_clid === 'C2' && bn.pago, 'extendedTextMessage: ad_id no nó, número vira texto', bn)

  // Post compartilhado não é mídia paga.
  const [c] = normalizarWebhookEvolution(upsert({
    key: { remoteJid: '5511987654321@s.whatsapp.net', fromMe: false, id: 'AD3' },
    message: { conversation: 'Oi' },
    contextInfo: { externalAdReply: { sourceId: '777', sourceType: 'post' } },
  }))
  const cn = c?.tipo === 'mensagem' ? c.mensagem.anuncio : undefined
  checar(cn?.ad_id === '777' && cn.pago === false, 'post: capturado, mas não pago', cn)

  // Sem identificador nenhum: nada a atribuir.
  const [d] = normalizarWebhookEvolution(upsert({
    key: { remoteJid: '5511987654321@s.whatsapp.net', fromMe: false, id: 'AD4' },
    message: { conversation: 'Oi' },
    contextInfo: { externalAdReply: { title: 'sem id' } },
  }))
  checar(d?.tipo === 'mensagem' && d.mensagem.anuncio === undefined, 'externalAdReply sem id nem clid é ignorado', d)

  // Mensagem comum segue sem anúncio.
  const [e] = normalizarWebhookEvolution(upsert({
    key: { remoteJid: '5511987654321@s.whatsapp.net', fromMe: false, id: 'AD5' },
    message: { conversation: 'Oi' },
  }))
  checar(e?.tipo === 'mensagem' && e.mensagem.anuncio === undefined, 'mensagem comum sem anúncio', e)
}

console.log('9º dígito')
{
  checar(JSON.stringify(variantesBr('551187654321')) === JSON.stringify(['551187654321', '5511987654321']), 'sem 9 → com 9')
  checar(JSON.stringify(variantesBr('5511987654321')) === JSON.stringify(['5511987654321', '551187654321']), 'com 9 → sem 9')
  checar(variantesBr('551133334444').length === 1, 'fixo (começa em 3) não ganha variante')
  checar(variantesBr('14155550100').length === 1, 'número dos EUA não ganha variante')
  checar(digitosDoJid('5511987654321:12@s.whatsapp.net') === '5511987654321', 'sufixo de dispositivo removido')
}

if (falhas > 0) {
  console.error(`\n${falhas} falha(s)`)
  process.exit(1)
}
console.log('\ntudo ok')
