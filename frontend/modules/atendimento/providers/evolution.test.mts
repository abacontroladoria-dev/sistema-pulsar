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

  const desconhecido = normalizarWebhookEvolution({ event: 'chats.update', instance: 'x', data: {} })[0]
  checar(desconhecido?.tipo === 'ignorado', 'evento não tratado ignorado', desconhecido)
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
