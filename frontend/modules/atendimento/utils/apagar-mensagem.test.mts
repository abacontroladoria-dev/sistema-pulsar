// Verifica quando "apagar" tira a mensagem também do WhatsApp do contato.
//
//   npx tsx modules/atendimento/utils/apagar-mensagem.test.mts
//
// O caso que mais importa é o FALSO POSITIVO: dizer "apagada para todos" de uma
// mensagem que o contato continua lendo (da Maia, do próprio contato, sem id do
// WhatsApp ou velha demais). Por isso quase todo teste aqui é de "não".
//
// Sem framework, como os outros testes do módulo.

import { apagaParaTodos, PRAZO_APAGAR_PARA_TODOS_MS } from './apagar-mensagem.js'

let falhas = 0
function eq<T>(obtido: T, esperado: T, nome: string) {
  const ok = obtido === esperado
  if (!ok) falhas++
  console.log(`  ${ok ? 'ok  ' : 'FALHA'} ${nome} (recebido: ${JSON.stringify(obtido)})`)
}

const agora = Date.parse('2026-10-02T12:00:00Z')
const base = {
  direction:           'outbound' as const,
  provider:            'evolution' as const,
  external_message_id: '3EB0ABC',
  sent_at:             '2026-10-02T11:00:00Z',
  created_at:          '2026-10-02T10:59:58Z',
}

eq(apagaParaTodos(base, agora), true, 'nossa, Evolution, com id e recente = para todos')
eq(apagaParaTodos({ ...base, direction: 'inbound' }, agora), false, 'mensagem do contato nunca sai do celular dele')
eq(apagaParaTodos({ ...base, provider: 'meta_waba' }, agora), false, 'número da Maia (Meta) não tem apagar')
eq(apagaParaTodos({ ...base, external_message_id: null }, agora), false, 'sem id do WhatsApp (falha/pendente) não há o que apagar lá')

const velha = new Date(agora - PRAZO_APAGAR_PARA_TODOS_MS - 1000).toISOString()
eq(apagaParaTodos({ ...base, sent_at: velha }, agora), false, 'fora do prazo do WhatsApp só some do Pulsar')

eq(apagaParaTodos({ ...base, sent_at: null, created_at: '2026-10-02T11:30:00Z' }, agora), true, 'sem sent_at, vale o created_at')
eq(apagaParaTodos({ ...base, sent_at: 'lixo' }, agora), false, 'data ilegível não promete apagar para todos')

if (falhas > 0) {
  console.error(`\n${falhas} teste(s) falharam.`)
  process.exit(1)
}
console.log('\nTodos os testes passaram.')
