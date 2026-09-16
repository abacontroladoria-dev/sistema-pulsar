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
//   6. FAILED não ganha tique de enviado.
//
// Sem framework, como os outros testes do módulo.

import {
  mapStatus,
  mapDirection,
  mapFromType,
  toUIMessage,
  toUIConversation,
  rotuloTipoContato,
} from './centralToNina.js'
import type { Conversation, Message, Contact } from '@/modules/atendimento/types/central.types'

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
    last_message_at: '2026-09-01T13:32:42Z', resolved_at: null, archived_at: null,
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

const semNome = toUIConversation(conv(), contato({ name: null }), [])
eq(semNome.contactName, '5521999185733', 'name null cai no telefone')

const semNada = toUIConversation(conv(), contato({ name: null, display_phone: null }), [])
eq(semNada.contactName, 'Contato sem nome', 'sem nome e sem telefone → rótulo explícito')

const semContato = toUIConversation(conv(), null, [])
eq(semContato.contactName, 'Contato sem nome', 'contato ausente não quebra')
eq(semContato.contactPhone, '', 'telefone ausente → string vazia')

eq(toUIConversation(conv(), contato({ avatar_url: null }), []).contactAvatar, '',
   'avatar null → vazio (a UI decide desenhar iniciais)')

eq(toUIConversation(conv(), contato(), []).lastMessage, 'Sem mensagens',
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

eq(mapStatus(conv({ status: 'open',     ai_mode: 'off' })), 'human',  'open → human')
eq(mapStatus(conv({ status: 'assigned', ai_mode: 'off' })), 'human',  'assigned → human')
eq(mapStatus(conv({ status: 'waiting',  ai_mode: 'off' })), 'paused', 'waiting → paused')
eq(mapStatus(conv({ status: 'resolved', ai_mode: 'off' })), 'paused', 'resolved → paused')
eq(mapStatus(conv({ status: 'archived', ai_mode: 'off' })), 'paused', 'archived → paused')

// 'nina' sai de ai_mode, não de status — a badge violeta afirma que a IA está
// conduzindo, e só ai_mode='autonomous' justifica essa afirmação.
eq(mapStatus(conv({ status: 'open', ai_mode: 'autonomous' })), 'nina',
   'autonomous → nina, mesmo com status open')
eq(mapStatus(conv({ status: 'open', ai_mode: 'assisted' })), 'human',
   'assisted NÃO é nina — a resposta ainda passa por humano')

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
])
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
const c = toUIConversation(conv(), contato(), [])
eq(c.unreadCount, 0, 'unreadCount sempre 0 (não existe no schema)')
// `tags` EXISTE no schema (TEXT[] em conversations e contacts). Fica vazio aqui
// porque as tags do produto são do contato e quem as mostra é o painel de
// detalhamento, lendo o `central` cru — a lista de conversas não as desenha.
eq(c.tags.length, 0, 'tags vazio: a lista de conversas não desenha tags')
// Prova de que é decisão, e não repasse: mesmo com tags nos dois lados, o
// adapter não as propaga.
eq(
  toUIConversation(conv({ tags: ['urgente'] }), contato({ tags: ['convenio'] }), []).tags.length,
  0,
  'não propaga tags nem da conversa nem do contato',
)

// ---------------------------------------------------------------------------
console.log(
  falhas === 0
    ? '\nTodos os testes passaram.'
    : `\n${falhas} teste(s) FALHARAM.`
)
process.exit(falhas === 0 ? 0 : 1)
