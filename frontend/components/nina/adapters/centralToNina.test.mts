// Verifica a fronteira central → Nina. Função pura: não toca banco, não pede
// rede, não monta componente.
//
//   npx tsx components/nina/adapters/centralToNina.test.mts
//
// O que se prova, e por que cada um importa:
//
//   1. TRADUÇÃO DE VOCABULÁRIO — inbound→incoming, body→content. É a razão de o
//      arquivo existir; se isto quebra, a tela mostra bolha do lado errado.
//   2. NULLABLE NÃO VIRA "null" NA TELA — body, sent_at, avatar_url e name são
//      nullable no banco. Cada um tem um default deliberado.
//   3. RASCUNHO DA IA é distinguido de mensagem enviada. É o teste mais
//      importante do arquivo: confundir os dois faz o operador acreditar que o
//      responsável recebeu uma resposta que nunca saiu.
//   4. 'pending' SOZINHO NÃO É RASCUNHO — existe a janela entre persistir e o
//      provider confirmar. Marcar aquilo como rascunho seria falso positivo.
//   5. STATUS usa dois eixos (status + ai_mode), porque são ortogonais no banco.
//   5b. E o ai_mode é o EFETIVO, com a herança do padrão da clínica resolvida.
//      A coluna crua é NULL na maioria das linhas; lê-la direto marcava como
//      humana toda conversa que a Maia atende por herança.
//   6. FAILED não ganha tique de enviado.
//   8. NÃO LIDAS são uma COMPARAÇÃO com last_read_at, não um contador. O caso
//      que mais importa: a nossa própria resposta nunca acende o não-lido —
//      senão responder deixaria a conversa acesa para sempre.
//   9. ANEXOS — o chip substitui o placeholder '[imagem]' que o webhook grava,
//      mas só quando o corpo é EXATAMENTE o marcador. Legenda escrita pela
//      pessoa sobrevive; apagar texto de gente é pior que deixar o marcador.
//
// Sem framework, como os outros testes do módulo.

import {
  mapStatus,
  mapDirection,
  mapFromType,
  toUIMessage,
  toUIConversation,
  rotuloTipoContato,
  contarNaoLidas,
  temNaoLidas,
  toAnexoUI,
} from './centralToNina.js'
import type {
  Conversation, Message, Contact, MessageAttachment,
} from '@/modules/atendimento/types/central.types'

function anexo(over: Partial<MessageAttachment> = {}): MessageAttachment {
  return {
    id: 'a1', organization_id: 'o1', message_id: 'm1',
    file_name: null, file_type: null, file_size: null,
    storage_path: null, external_url: 'https://lookaside.fb/x',
    storage_status: 'pending', storage_error: null,
    duration_secs: null, thumbnail_path: null,
    created_at: '2026-09-01T13:32:42Z', updated_at: '2026-09-01T13:32:42Z',
    ...over,
  }
}

let falhas = 0
function ok(condicao: boolean, oque: string) {
  if (condicao) {
    console.log(`  ok   ${oque}`)
  } else {
    console.error(`  FALHA ${oque}`)
    falhas++
  }
}
function eq<T>(recebido: T, esperado: T, oque: string) {
  ok(recebido === esperado, `${oque} (recebido: ${JSON.stringify(recebido)})`)
}

// ---------------------------------------------------------------------------
// Fábricas de dublê. Só os campos que o adaptador lê importam; o resto existe
// para satisfazer o tipo.

function msg(over: Partial<Message> = {}): Message {
  return {
    id: 'm1', organization_id: 'o1', conversation_id: 'c1',
    external_message_id: 'wamid.X', direction: 'inbound',
    message_type: 'text', body: 'oi', provider: 'meta_waba',
    sent_by_user_id: null, sent_by_ai: false, reply_to_message_id: null,
    status: 'delivered',
    sent_at: '2026-09-01T13:32:42Z', deleted_at: null,
    created_at: '2026-09-01T13:32:42Z', updated_at: '2026-09-01T13:32:42Z',
    ...over,
  }
}

function conv(over: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1', organization_id: 'o1', inbox_id: 'i1', channel_id: 'ch1',
    contact_id: 'ct1', assigned_user_id: null, status: 'open',
    priority: null, intent: null, sentiment: null, ai_mode: 'off', tags: null,
    last_message_at: '2026-09-01T13:32:42Z', last_read_at: null,
    resolved_at: null, archived_at: null,
    created_at: '2026-09-01T13:00:00Z', updated_at: '2026-09-01T13:32:42Z',
    ...over,
  }
}

function contato(over: Partial<Contact> = {}): Contact {
  return {
    id: 'ct1', organization_id: 'o1', name: 'Caio Vinícius',
    display_phone: '5521999185733', display_email: null,
    contact_type: 'guardian', status: 'active', source: 'whatsapp', tags: null,
    avatar_url: null, is_provisional: false, merged_into_contact_id: null,
    last_interaction_at: null, deleted_at: null,
    created_at: '2026-09-01T13:32:41Z', updated_at: '2026-09-01T13:32:41Z',
    ...over,
  }
}

// ---------------------------------------------------------------------------
console.log('\n1. Tradução de vocabulário')

eq(mapDirection('inbound'),  'incoming', 'inbound → incoming')
eq(mapDirection('outbound'), 'outgoing', 'outbound → outgoing')
eq(toUIMessage(msg({ body: 'Teste após webhook' })).content,
   'Teste após webhook', 'body → content')

eq(mapFromType(msg({ direction: 'inbound' })), 'user',
   'inbound é sempre o contato')
eq(mapFromType(msg({ direction: 'outbound', sent_by_ai: true })), 'nina',
   'outbound + sent_by_ai → nina')
eq(mapFromType(msg({ direction: 'outbound', sent_by_ai: false })), 'human',
   'outbound sem IA → human')
// Inbound nunca é da IA, mesmo que a coluna venha suja.
eq(mapFromType(msg({ direction: 'inbound', sent_by_ai: true })), 'user',
   'inbound vence sent_by_ai')

// ---------------------------------------------------------------------------
console.log('\n2. Nullable não vaza para a tela')

eq(toUIMessage(msg({ body: null })).content, '', 'body null → string vazia')
ok(toUIMessage(msg({ sent_at: null, created_at: '2026-09-01T10:05:00Z' })).timestamp !== '',
   'sent_at null usa created_at')

const semNome = toUIConversation(conv(), contato({ name: null }), [], 'off')
eq(semNome.contactName, '5521999185733', 'name null cai no telefone')

const semNada = toUIConversation(conv(), contato({ name: null, display_phone: null }), [], 'off')
eq(semNada.contactName, 'Contato sem nome', 'sem nome e sem telefone → rótulo explícito')

const semContato = toUIConversation(conv(), null, [], 'off')
eq(semContato.contactName, 'Contato sem nome', 'contato ausente não quebra')
eq(semContato.contactPhone, '', 'telefone ausente → string vazia')

eq(toUIConversation(conv(), contato({ avatar_url: null }), [], 'off').contactAvatar, '',
   'avatar null → vazio (a UI decide desenhar iniciais)')

eq(toUIConversation(conv(), contato(), [], 'off').lastMessage, 'Sem mensagens',
   'conversa sem mensagem não mostra "undefined"')

// ---------------------------------------------------------------------------
console.log('\n3. Rascunho da IA — o teste que mais importa')

const rascunho = toUIMessage(msg({
  direction: 'outbound', sent_by_ai: true,
  status: 'pending', external_message_id: null,
}))
eq(rascunho.isAiDraft, true, 'sent_by_ai + pending + sem id da Meta = rascunho')
ok(rascunho.status !== 'read' && rascunho.status !== 'delivered',
   'rascunho não recebe status de entregue')

const enviadaPelaIa = toUIMessage(msg({
  direction: 'outbound', sent_by_ai: true,
  status: 'delivered', external_message_id: 'wamid.ABC',
}))
eq(enviadaPelaIa.isAiDraft, false, 'IA + entregue + com id da Meta NÃO é rascunho')
eq(enviadaPelaIa.fromType, 'nina', 'mas continua sendo fala da IA')

// ---------------------------------------------------------------------------
console.log('\n4. pending sozinho não é rascunho')

eq(toUIMessage(msg({
  direction: 'outbound', sent_by_ai: false,
  status: 'pending', external_message_id: null,
})).isAiDraft, false, 'pending de humano não é rascunho')

// A janela real: a IA enfileirou, o provider já devolveu id, status ainda não
// atualizou. Não é rascunho — a mensagem saiu.
eq(toUIMessage(msg({
  direction: 'outbound', sent_by_ai: true,
  status: 'pending', external_message_id: 'wamid.JASAIU',
})).isAiDraft, false, 'pending COM id da Meta não é rascunho — já saiu')

// ---------------------------------------------------------------------------
console.log('\n4b. Não confirmada pelo provider (caso real de produção)')

// Linha vista no banco em 01/09: humano enviou, status ficou 'pending', sem
// external_message_id e sem nada na send_queue — o processo morreu entre
// persistir e a Meta responder. Não foi entregue, então não pode exibir tique.
const naoConfirmada = toUIMessage(msg({
  direction: 'outbound', sent_by_ai: false, sent_by_user_id: 'u1',
  status: 'pending', external_message_id: null,
}))
eq(naoConfirmada.emTransito, true, 'pending de humano sem id da Meta = não confirmada')
eq(naoConfirmada.isAiDraft, false, 'e não é rascunho da IA')

// Confirmada não fica marcada como em trânsito.
eq(toUIMessage(msg({
  direction: 'outbound', status: 'delivered', external_message_id: 'wamid.OK',
})).emTransito, false, 'mensagem confirmada não é "em trânsito"')

// Rascunho não é contado como em trânsito — tem sinalização própria.
eq(toUIMessage(msg({
  direction: 'outbound', sent_by_ai: true,
  status: 'pending', external_message_id: null,
})).emTransito, false, 'rascunho não se confunde com em trânsito')

// ---------------------------------------------------------------------------
console.log('\n5. Status por dois eixos')

eq(mapStatus(conv({ status: 'open',     ai_mode: 'off' }), 'off'), 'human',  'open → human')
eq(mapStatus(conv({ status: 'assigned', ai_mode: 'off' }), 'off'), 'human',  'assigned → human')
eq(mapStatus(conv({ status: 'waiting',  ai_mode: 'off' }), 'off'), 'paused', 'waiting → paused')
eq(mapStatus(conv({ status: 'resolved', ai_mode: 'off' }), 'off'), 'paused', 'resolved → paused')
eq(mapStatus(conv({ status: 'archived', ai_mode: 'off' }), 'off'), 'paused', 'archived → paused')

// 'nina' sai de ai_mode, não de status — a badge violeta afirma que a IA está
// conduzindo, e só ai_mode='autonomous' justifica essa afirmação.
eq(mapStatus(conv({ status: 'open', ai_mode: 'autonomous' }), 'off'), 'nina',
   'autonomous → nina, mesmo com status open')
eq(mapStatus(conv({ status: 'open', ai_mode: 'assisted' }), 'off'), 'human',
   'assisted NÃO é nina — a resposta ainda passa por humano')

// ---------------------------------------------------------------------------
console.log('\n5b. Herança do ai_mode — o bug da Kelly')

// `conversations.ai_mode` NULL é o caso da MAIORIA das linhas e significa
// "ninguém decidiu nesta conversa, vale o padrão da clínica" (20260915220000).
// A badge lia a coluna crua: NULL !== 'autonomous', então caía em 'human' e
// contradizia a triagem, que resolve a herança no servidor. A mesma conversa
// aparecia na coluna Maia de /atendimentos e com selo de humano no /inbox.
eq(mapStatus(conv({ status: 'open', ai_mode: null }), 'autonomous'), 'nina',
   'coluna NULL + padrão autonomous → nina (era o bug: dava human)')
eq(mapStatus(conv({ status: 'open', ai_mode: null }), 'off'), 'human',
   'coluna NULL + padrão off → human')
eq(mapStatus(conv({ status: 'open', ai_mode: null }), 'assisted'), 'human',
   'coluna NULL + padrão assisted → human (assisted não é a Maia atendendo)')

// A decisão da conversa VENCE o padrão, nas duas direções. É o que faz a chave
// Maia/Atendente do inbox valer alguma coisa.
eq(mapStatus(conv({ status: 'open', ai_mode: 'off' }), 'autonomous'), 'human',
   'desligar na conversa vence o padrão autonomous')
eq(mapStatus(conv({ status: 'open', ai_mode: 'autonomous' }), 'off'), 'nina',
   'ligar na conversa vence o padrão off')

// A herança não ressuscita conversa encerrada: quem decide 'paused' é o status,
// e ele é consultado depois do modo só quando o modo não é autonomous. Uma
// arquivada com padrão autonomous continua sendo tratada como Maia pela badge —
// a triagem resolve isso na caixa 'encerradas', que vence tudo (ver caixas.ts).
eq(mapStatus(conv({ status: 'archived', ai_mode: null }), 'off'), 'paused',
   'arquivada com padrão off → paused')

// O adapter inteiro propaga a herança, não só mapStatus.
eq(toUIConversation(conv({ status: 'open', ai_mode: null }), contato(), [], 'autonomous').status,
   'nina', 'toUIConversation repassa o padrão para a badge')

// ---------------------------------------------------------------------------
console.log('\n6. failed não parece enviada')

const falhou = toUIMessage(msg({ direction: 'outbound', status: 'failed' }))
eq(falhou.failed, true, 'failed marcado')
ok(falhou.status !== 'delivered' && falhou.status !== 'read',
   'failed não recebe status de entregue')

// ---------------------------------------------------------------------------
console.log('\n7. Ordem e rótulo de tipo')

const comHistorico = toUIConversation(conv(), contato(), [
  msg({ id: 'm1', body: 'primeira' }),
  msg({ id: 'm2', body: 'última' }),
], 'off')
eq(comHistorico.messages.length, 2, 'duas mensagens')
eq(comHistorico.lastMessage, 'última', 'lastMessage é a ÚLTIMA do array')

eq(rotuloTipoContato(contato({ contact_type: 'guardian' })), 'Responsável',
   'guardian → Responsável')
eq(rotuloTipoContato(contato({ contact_type: 'lead' })), 'Primeiro contato',
   'lead → Primeiro contato')
eq(rotuloTipoContato(contato({ is_provisional: true })), 'Responsável · não confirmado',
   'provisório é sinalizado')
eq(rotuloTipoContato(null), 'Contato', 'sem contato não quebra')

// Campos sem origem no banco: zero e vazio, nunca inventados.
const c = toUIConversation(conv(), contato(), [], 'off')
// Na LISTA o histórico chega vazio de propósito — sem mensagens, não há o que
// contar, e o número honesto é 0. Quem acende o ponto lá é `naoLida`, que sai
// das colunas da conversa. Ver o bloco 8.
eq(c.unreadCount, 0, 'sem histórico carregado, unreadCount é 0')
// `tags` EXISTE no schema (TEXT[] em conversations e contacts). Fica vazio aqui
// porque as tags do produto são do contato e quem as mostra é o painel de
// detalhamento, lendo o `central` cru — a lista de conversas não as desenha.
eq(c.tags.length, 0, 'tags vazio: a lista de conversas não desenha tags')
// Prova de que é decisão, e não repasse: mesmo com tags nos dois lados, o
// adapter não as propaga.
eq(
  toUIConversation(conv({ tags: ['urgente'] }), contato({ tags: ['convenio'] }), [], 'off').tags.length,
  0,
  'não propaga tags nem da conversa nem do contato',
)

// ---------------------------------------------------------------------------
console.log('\n8. Não lidas (marca d\'água, não contador)')

const T13 = '2026-09-01T13:00:00Z'
const T14 = '2026-09-01T14:00:00Z'
const T15 = '2026-09-01T15:00:00Z'

// Só mensagem do CONTATO conta. A nossa própria resposta, que é mais nova que
// qualquer marca, nunca pode acender o não-lido — senão responder deixaria a
// conversa acesa para sempre.
eq(
  contarNaoLidas(
    [msg({ direction: 'inbound', sent_at: T15 }), msg({ direction: 'outbound', sent_at: T15 })],
    T14,
  ),
  1,
  'só inbound conta como não lida',
)

eq(contarNaoLidas([msg({ sent_at: T13 })], T14), 0, 'mensagem anterior à marca não conta')
eq(contarNaoLidas([msg({ sent_at: T15 })], T14), 1, 'mensagem posterior à marca conta')

// NULL = ninguém abriu. É o estado de toda conversa logo após a migration (que
// não faz backfill de propósito), e nele TUDO é não lido.
eq(contarNaoLidas([msg({ sent_at: T13 }), msg({ sent_at: T15 })], null), 2,
  'sem marca, toda mensagem do contato é não lida')

// `sent_at` nullable: cai no created_at em vez de ser descartada.
eq(
  contarNaoLidas([msg({ sent_at: null, created_at: T15 })], T14),
  1,
  'sent_at nulo usa created_at',
)

// A pergunta binária da lista, que não precisa de histórico.
ok(temNaoLidas(conv({ last_message_at: T15, last_read_at: T14 })), 'mensagem depois da leitura')
ok(!temNaoLidas(conv({ last_message_at: T13, last_read_at: T14 })), 'leitura depois da mensagem')
ok(temNaoLidas(conv({ last_message_at: T13, last_read_at: null })), 'nunca lida, com mensagem')
ok(!temNaoLidas(conv({ last_message_at: null, last_read_at: null })),
  'conversa sem mensagem nenhuma não é não lida')

// ---------------------------------------------------------------------------
console.log('\n9. Anexos: o chip diz o que o placeholder escondia')

// O MIME manda sobre o message_type — é mais específico e a Meta o informa com
// mais consistência.
eq(toAnexoUI(anexo({ file_type: 'image/jpeg' }), 'document').rotulo, 'Imagem',
  'MIME vence o message_type')
eq(toAnexoUI(anexo({ file_type: 'application/pdf' }), 'document').rotulo, 'Documento', 'PDF')
// Linha antiga sem file_type: o message_type é a rede de segurança.
eq(toAnexoUI(anexo(), 'audio').rotulo, 'Áudio', 'sem MIME, usa o message_type')

// Duração ganha do tamanho: "12s" diz ao atendente se vale parar para ouvir.
eq(toAnexoUI(anexo({ duration_secs: 12, file_size: 34_000 }), 'audio').detalhe, '12s',
  'duração vence o tamanho')
eq(toAnexoUI(anexo({ file_size: 1_572_864 }), 'document').detalhe, '1,5 MB', 'MB com vírgula')
eq(toAnexoUI(anexo({ file_size: 34_000 }), 'document').detalhe, '33 KB', 'abaixo de 1 MB vira KB')
eq(toAnexoUI(anexo(), 'image').detalhe, null, 'sem duração nem tamanho, sem detalhe')

// Só 'stored' é exibível. 'pending' é o estado de TODO anexo em produção hoje.
ok(!toAnexoUI(anexo({ storage_status: 'pending' }), 'image').disponivel, 'pending não é disponível')
ok(!toAnexoUI(anexo({ storage_status: 'failed' }), 'image').disponivel, 'failed não é disponível')
ok(toAnexoUI(anexo({ storage_status: 'stored' }), 'image').disponivel, 'stored é disponível')

// O placeholder do webhook sai quando o chip diz a mesma coisa — repetir
// "[imagem]" acima de um chip escrito "Imagem" é ruído.
const comAnexo = toUIMessage(msg({
  message_type: 'image', body: '[imagem]', attachments: [anexo({ file_type: 'image/jpeg' })],
}))
eq(comAnexo.content, '', 'placeholder de anexo não vira texto na bolha')
eq(comAnexo.anexos.length, 1, 'o anexo chega à bolha')

eq(
  toUIMessage(msg({ message_type: 'document', body: '[documento: laudo.pdf]', attachments: [anexo()] })).content,
  '',
  'placeholder com nome de arquivo também sai',
)

// Legenda de verdade SOBREVIVE. Em meta-waba.normalizar.ts a legenda vence o
// placeholder, então um corpo que não é só o marcador foi escrito por gente — e
// apagar pedaço de mensagem de gente é pior que deixar um marcador na tela.
eq(
  toUIMessage(msg({ message_type: 'image', body: 'olha o exame dele', attachments: [anexo()] })).content,
  'olha o exame dele',
  'legenda do contato não é apagada',
)
// Mesmo caso limite: texto que CONTÉM o marcador mas não é só ele.
eq(
  toUIMessage(msg({ message_type: 'image', body: 'segue [imagem] do laudo', attachments: [anexo()] })).content,
  'segue [imagem] do laudo',
  'marcador no meio da frase não dispara a limpeza',
)

// Mensagem sem anexo nenhum não passa pela limpeza — se passasse, alguém que
// escrevesse literalmente "[imagem]" teria a mensagem apagada.
eq(
  toUIMessage(msg({ body: '[imagem]', attachments: [] })).content,
  '[imagem]',
  'sem anexo, o texto fica intacto',
)

// ---------------------------------------------------------------------------
console.log(
  falhas === 0
    ? '\nTodos os testes passaram.'
    : `\n${falhas} teste(s) FALHARAM.`
)
process.exit(falhas === 0 ? 0 : 1)
